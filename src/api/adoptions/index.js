import express from "express";
import { notifyApplicant, publishInboxChanged } from "../../lib/inbox/notifications.js";
import { and, asc, count, eq } from "drizzle-orm";
import { adoptionRequests, dogs, users } from "../../db/schema.ts";
import { authenticationRequired, requireUser } from "../../lib/auth/requireUser.js";
import { parsePage, uuidPattern } from "./validation.js";

const httpError = (status, message) => Object.assign(new Error(message), { status });
const adminFields = {
  _id: adoptionRequests.id,
  status: adoptionRequests.status,
  createdAt: adoptionRequests.createdAt,
  updatedAt: adoptionRequests.updatedAt,
  reviewedAt: adoptionRequests.reviewedAt,
  reviewedBy: adoptionRequests.reviewedBy,
  user: {
    _id: users.id, name: users.name, surname: users.surname, email: users.email,
    age: users.age, description: users.description,
  },
  dog: {
    _id: dogs.id, name: dogs.name, breed: dogs.breed, age: dogs.age,
    gender: dogs.gender, weight: dogs.weight, description: dogs.description,
    location: dogs.location, isAdopted: dogs.isAdopted,
  },
};

export function createAdoptionReviewRouter(database, accessTokens, onInboxChanged = () => {}) {
  const router = express.Router();
  const authenticate = requireUser(database, accessTokens);
  const adminOnly = (req, res, next) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Administrator access required." });
    }
    next();
  };

  router.get("/", authenticate, adminOnly, async (req, res, next) => {
    let page;
    let status;
    try {
      const { status: filter = "pending", ...pagination } = req.query;
      if (typeof filter !== "string" || !["pending", "approved", "rejected", "all"].includes(filter)) {
        throw new Error("Status must be pending, approved, rejected or all.");
      }
      status = filter;
      page = parsePage(pagination);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    try {
      const condition = status === "all" ? undefined : eq(adoptionRequests.status, status);
      const items = await database.select(adminFields).from(adoptionRequests)
        .innerJoin(users, eq(adoptionRequests.userId, users.id))
        .innerJoin(dogs, eq(adoptionRequests.dogId, dogs.id))
        .where(condition).orderBy(asc(adoptionRequests.createdAt), asc(adoptionRequests.id))
        .limit(page.limit).offset(page.offset);
      const [{ total }] = await database.select({ total: count() }).from(adoptionRequests).where(condition);
      res.json({ items, total, limit: page.limit, offset: page.offset });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:requestId", authenticate, adminOnly, async (req, res, next) => {
    if (!req.is("application/json")) {
      return res.status(415).json({ message: "Use application/json." });
    }
    if (!uuidPattern.test(req.params.requestId) || !req.body || Array.isArray(req.body) ||
        Object.keys(req.body).length !== 1 || !["approved", "rejected"].includes(req.body.status) ||
        Object.keys(req.query).length !== 0) {
      return res.status(400).json({ message: "Provide a valid request UUID and only status: approved or rejected." });
    }

    try {
      const { result, recipients } = await database.transaction(async (tx) => {
        // Match submission's lock order: account, dog, then request.
        const [admin] = await tx.select({ id: users.id, role: users.role }).from(users)
          .where(eq(users.id, req.user._id)).limit(1).for("share");
        if (!admin) throw httpError(401, "Account no longer exists.");
        if (admin.role !== "admin") throw httpError(403, "Administrator access required.");

        const [lookup] = await tx.select({ dogId: adoptionRequests.dogId }).from(adoptionRequests)
          .where(eq(adoptionRequests.id, req.params.requestId)).limit(1);
        if (!lookup) throw httpError(404, "Adoption request not found.");

        const [dog] = await tx.select({ id: dogs.id, isAdopted: dogs.isAdopted }).from(dogs)
          .where(eq(dogs.id, lookup.dogId)).limit(1).for("update");
        const [request] = await tx.select().from(adoptionRequests)
          .where(eq(adoptionRequests.id, req.params.requestId)).limit(1).for("update");
        if (!request || !dog) throw httpError(404, "Adoption request not found.");
        if (request.status !== "pending") {
          throw httpError(409, "This request has already been reviewed. Refresh the list.");
        }
        if (req.body.status === "approved" && dog.isAdopted) {
          throw httpError(409, "This dog has already been adopted. The request can only be declined.");
        }

        const decision = { status: req.body.status, reviewedBy: admin.id, reviewedAt: new Date() };
        await tx.update(adoptionRequests).set(decision).where(eq(adoptionRequests.id, request.id));
        const recipients = [await notifyApplicant(tx, request, decision.status === "approved" ? "adoption_approved" : "adoption_rejected")];
        let closedRequests = 0;
        if (decision.status === "approved") {
          await tx.update(dogs).set({ isAdopted: true }).where(eq(dogs.id, dog.id));
          const competing = await tx.select().from(adoptionRequests)
            .where(and(eq(adoptionRequests.dogId, dog.id), eq(adoptionRequests.status, "pending"))).for("update");
          const [closed] = await tx.update(adoptionRequests).set({ ...decision, status: "rejected" })
            .where(and(eq(adoptionRequests.dogId, dog.id), eq(adoptionRequests.status, "pending")));
          closedRequests = closed.affectedRows;
          for (const other of competing) recipients.push(await notifyApplicant(tx, other, "adoption_rejected"));
        }
        const [updated] = await tx.select({
          _id: adoptionRequests.id, dogId: adoptionRequests.dogId, status: adoptionRequests.status,
          reviewedBy: adoptionRequests.reviewedBy, reviewedAt: adoptionRequests.reviewedAt,
          updatedAt: adoptionRequests.updatedAt,
        }).from(adoptionRequests).where(eq(adoptionRequests.id, request.id));
        return { result: { ...updated, closedRequests }, recipients };
      });
      publishInboxChanged(onInboxChanged, recipients);
      res.json(result);
    } catch (error) {
      if (error.status === 401) return authenticationRequired(res);
      next(error);
    }
  });

  return router;
}
