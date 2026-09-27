import { eq } from "drizzle-orm";
import { notifications, users } from "../../db/schema.ts";

export async function notifyAdmins(tx, requestId, kind, excludeUserId) {
  const admins = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  const recipients = admins.filter((user) => user.id !== excludeUserId);
  if (recipients.length) await tx.insert(notifications).values(recipients.map((user) => ({
    userId: user.id, requestId, kind, audience: "admin",
  })));
  return recipients.map((user) => user.id);
}

export async function notifyApplicant(tx, request, kind) {
  await tx.insert(notifications).values({
    userId: request.userId, requestId: request.id, kind, audience: "user",
  });
  return request.userId;
}

// The database has already committed. A disconnected socket must never turn a
// successful write into an HTTP error. Clients also refresh on reconnect.
export function publishInboxChanged(publish, userIds) {
  try { publish([...new Set(userIds)]); }
  catch { console.error("Realtime refresh could not be published."); }
}
