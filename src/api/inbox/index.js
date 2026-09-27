import express from "express";
import { and, count, desc, eq, inArray, isNull, lt, max } from "drizzle-orm";
import { adoptionRequests, dogs, messages, notifications, users } from "../../db/schema.ts";
import { requireUser } from "../../lib/auth/requireUser.js";
import { parsePage, uuidPattern } from "../adoptions/validation.js";
import { notifyAdmins, notifyApplicant, publishInboxChanged } from "../../lib/inbox/notifications.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
function readPage(query) {
  try { return parsePage(query); }
  catch (error) { throw fail(400, error.message); }
}
const messageFields = {
  _id: messages.id, requestId: messages.requestId, senderId: messages.senderId,
  clientMessageId: messages.clientMessageId, body: messages.body, createdAt: messages.createdAt,
  senderName: users.name, senderSurname: users.surname,
};
const conversationFields = {
  _id: adoptionRequests.id, status: adoptionRequests.status, createdAt: adoptionRequests.createdAt,
  userId: adoptionRequests.userId, applicantName: users.name, applicantSurname: users.surname,
  dogId: dogs.id, dogName: dogs.name,
};
function conversationQuery(database) {
  return database.select(conversationFields).from(adoptionRequests)
    .innerJoin(users, eq(adoptionRequests.userId, users.id))
    .innerJoin(dogs, eq(adoptionRequests.dogId, dogs.id));
}
async function conversation(database, id, user) {
  if (!uuidPattern.test(id)) throw fail(400, "Provide a valid conversation UUID.");
  const [row] = await conversationQuery(database).where(and(
    eq(adoptionRequests.id, id),
    user.role === "admin" ? undefined : eq(adoptionRequests.userId, user._id)
  )).limit(1);
  if (!row) throw fail(404, "Conversation not found.");
  return row;
}
function notificationScope(user) {
  return and(eq(notifications.userId, user._id),
    user.role === "admin" ? undefined : eq(notifications.audience, "user"));
}
function jsonBody(req, keys) {
  if (!req.is("application/json")) throw fail(415, "Use application/json.");
  if (!req.body || Array.isArray(req.body) ||
      Object.keys(req.body).sort().join(",") !== [...keys].sort().join(",") ||
      Object.keys(req.query).length) throw fail(400, "Invalid request fields.");
}
const notificationTitle = (kind, dog) => ({
  adoption_created: "New adoption request for " + dog + ".",
  adoption_approved: "Your adoption request for " + dog + " was approved.",
  adoption_rejected: "Your adoption request for " + dog + " was declined.",
  message: "New message about " + dog + ".",
})[kind];

export function createInboxRouter(database, accessTokens, onInboxChanged = () => {}) {
  const router = express.Router();
  router.use(requireUser(database, accessTokens));

  router.get("/conversations", async (req, res, next) => {
    try {
      const page = readPage(req.query);
      const scope = req.user.role === "admin" ? undefined : eq(adoptionRequests.userId, req.user._id);
      const items = await conversationQuery(database).where(scope)
        .orderBy(desc(adoptionRequests.createdAt), desc(adoptionRequests.id)).limit(page.limit).offset(page.offset);
      const [{ total }] = await database.select({ total: count() }).from(adoptionRequests).where(scope);
      const latest = items.length ? await database.select({ id: max(messages.id) }).from(messages)
        .where(inArray(messages.requestId, items.map((item) => item._id))).groupBy(messages.requestId) : [];
      const previews = latest.length ? await database.select({
        requestId: messages.requestId, body: messages.body, createdAt: messages.createdAt,
      }).from(messages).where(inArray(messages.id, latest.map((item) => item.id))) : [];
      res.json({ items: items.map((item) => ({ ...item, lastMessage: previews.find((message) => message.requestId === item._id) || null })),
        total, limit: page.limit, offset: page.offset });
    } catch (error) { next(error); }
  });

  router.get("/conversations/:requestId", async (req, res, next) => {
    try { res.json(await conversation(database, req.params.requestId, req.user)); }
    catch (error) { next(error); }
  });

  router.get("/conversations/:requestId/messages", async (req, res, next) => {
    try {
      const item = await conversation(database, req.params.requestId, req.user);
      const { beforeId, limit = "50", ...extra } = req.query;
      if (Object.keys(extra).length || typeof limit !== "string" || !/^[1-9]\d*$/.test(limit) ||
          Number(limit) > 100 || (beforeId !== undefined && (typeof beforeId !== "string" ||
          !/^[1-9]\d*$/.test(beforeId) || !Number.isSafeInteger(Number(beforeId))))) {
        throw fail(400, "Use limit 1-100 and an optional positive beforeId.");
      }
      const rows = await database.select(messageFields).from(messages).innerJoin(users, eq(messages.senderId, users.id))
        .where(and(eq(messages.requestId, item._id), beforeId ? lt(messages.id, Number(beforeId)) : undefined))
        .orderBy(desc(messages.id)).limit(Number(limit) + 1);
      const hasMore = rows.length > Number(limit);
      const items = rows.slice(0, Number(limit)).reverse();
      res.json({ items, hasMore, nextBeforeId: hasMore ? items[0]._id : null });
    } catch (error) { next(error); }
  });

  // A modest per-account limit for this single-process local deployment.
  const sendWindows = new Map();
  router.post("/conversations/:requestId/messages", async (req, res, next) => {
    try {
      jsonBody(req, ["body", "clientMessageId"]);
      if (!uuidPattern.test(req.params.requestId) || typeof req.body.clientMessageId !== "string" ||
          !uuidPattern.test(req.body.clientMessageId) || typeof req.body.body !== "string" ||
          !req.body.body.trim() || Array.from(req.body.body.trim()).length > 2000) {
        throw fail(400, "A message needs text (1-2000 characters) and a clientMessageId UUID.");
      }
      const now = Date.now();
      for (const [id, entry] of sendWindows) if (entry.until <= now) sendWindows.delete(id);
      const entry = sendWindows.get(req.user._id) || { count: 0, until: now + 60_000 };
      if (entry.count >= 60) {
        res.set("Retry-After", String(Math.ceil((entry.until - now) / 1000)));
        throw fail(429, "Too many messages. Please wait a minute and try again.");
      }
      entry.count += 1;
      sendWindows.set(req.user._id, entry);
      const result = await database.transaction(async (tx) => {
        const [sender] = await tx.select({ _id: users.id, role: users.role }).from(users)
          .where(eq(users.id, req.user._id)).limit(1).for("share");
        if (!sender) throw fail(401, "Please log in again.");
        const [request] = await tx.select().from(adoptionRequests)
          .where(eq(adoptionRequests.id, req.params.requestId)).limit(1).for("update");
        if (!request || (sender.role !== "admin" && request.userId !== sender._id)) throw fail(404, "Conversation not found.");
        const [existing] = await tx.select(messageFields).from(messages).innerJoin(users, eq(messages.senderId, users.id))
          .where(and(eq(messages.senderId, sender._id), eq(messages.clientMessageId, req.body.clientMessageId))).limit(1);
        if (existing) {
          if (existing.requestId !== request.id || existing.body !== req.body.body.trim()) {
            throw fail(409, "This message identifier was already used for different content.");
          }
          return { message: existing, recipients: [], created: false };
        }
        const [inserted] = await tx.insert(messages).values({
          requestId: request.id, senderId: sender._id,
          clientMessageId: req.body.clientMessageId, body: req.body.body.trim(),
        });
        const [message] = await tx.select(messageFields).from(messages).innerJoin(users, eq(messages.senderId, users.id))
          .where(eq(messages.id, inserted.insertId)).limit(1);
        const recipients = await notifyAdmins(tx, request.id, "message", sender._id);
        if (request.userId !== sender._id) recipients.push(await notifyApplicant(tx, request, "message"));
        return { message, recipients: [...recipients, sender._id], created: true };
      });
      publishInboxChanged(onInboxChanged, result.recipients);
      res.status(result.created ? 201 : 200).json(result.message);
    } catch (error) { next(error); }
  });

  router.get("/notifications", async (req, res, next) => {
    try {
      const page = readPage(req.query);
      const scope = notificationScope(req.user);
      const items = await database.select({
        _id: notifications.id, requestId: notifications.requestId, kind: notifications.kind,
        readAt: notifications.readAt, createdAt: notifications.createdAt, dogName: dogs.name,
      }).from(notifications).innerJoin(adoptionRequests, eq(notifications.requestId, adoptionRequests.id))
        .innerJoin(dogs, eq(adoptionRequests.dogId, dogs.id)).where(scope)
        .orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(page.limit).offset(page.offset);
      const [{ unread }] = await database.select({ unread: count() }).from(notifications)
        .where(and(scope, isNull(notifications.readAt)));
      const [{ total }] = await database.select({ total: count() }).from(notifications).where(scope);
      res.json({ items: items.map((item) => ({ ...item, title: notificationTitle(item.kind, item.dogName) })),
        unread, total, limit: page.limit, offset: page.offset });
    } catch (error) { next(error); }
  });

  router.patch("/notifications/:id/read", async (req, res, next) => {
    try {
      jsonBody(req, []);
      if (!uuidPattern.test(req.params.id)) throw fail(400, "Provide a valid notification UUID.");
      const scope = and(notificationScope(req.user), eq(notifications.id, req.params.id));
      const [item] = await database.select({ id: notifications.id }).from(notifications).where(scope).limit(1);
      if (!item) throw fail(404, "Notification not found.");
      await database.update(notifications).set({ readAt: new Date() }).where(and(scope, isNull(notifications.readAt)));
      publishInboxChanged(onInboxChanged, [req.user._id]);
      res.json({ _id: item.id, read: true });
    } catch (error) { next(error); }
  });

  router.post("/notifications/read-all", async (req, res, next) => {
    try {
      jsonBody(req, []);
      await database.update(notifications).set({ readAt: new Date() })
        .where(and(notificationScope(req.user), isNull(notifications.readAt)));
      publishInboxChanged(onInboxChanged, [req.user._id]);
      res.json({ read: true });
    } catch (error) { next(error); }
  });
  return router;
}
