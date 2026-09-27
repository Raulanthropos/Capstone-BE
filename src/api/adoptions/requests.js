import { parsePage, uuidPattern } from "./validation.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { adoptionRequests, dogs, users } from "../../db/schema.ts";
import { authenticationRequired, requireUser } from "../../lib/auth/requireUser.js";


const requestFields = {
  _id: adoptionRequests.id,
  dogId: adoptionRequests.dogId,
  status: adoptionRequests.status,
  createdAt: adoptionRequests.createdAt,
  updatedAt: adoptionRequests.updatedAt,
};

export function createAdoptionRequestsRouter(database, accessTokens) {
  const router = express.Router();
  const authenticate = requireUser(database, accessTokens);

  router.post("/", authenticate, async (req, res, next) => {
    if (!req.is("application/json")) {
      return res.status(415).json({ message: "Use application/json." });
    }
    const body = req.body;
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 ||
        typeof body.dogId !== "string" || !uuidPattern.test(body.dogId) ||
        Object.keys(req.query).length !== 0) {
      return res.status(400).json({ message: "Provide only dogId, as a UUID, in the JSON body." });
    }

    try {
      const request = await database.transaction(async (tx) => {
        // Recheck and keep the account present until its request is committed.
        const [user] = await tx.select({ id: users.id }).from(users)
          .where(eq(users.id, req.user._id)).limit(1).for("share");
        if (!user) throw Object.assign(new Error("Account no longer exists."), { status: 401 });

        // Locking the dog serializes submissions with changes to its availability.
        const [dog] = await tx.select({ id: dogs.id, isAdopted: dogs.isAdopted }).from(dogs)
          .where(eq(dogs.id, body.dogId)).limit(1).for("update");
        if (!dog) throw Object.assign(new Error("Dog not found."), { status: 404 });
        if (dog.isAdopted) {
          throw Object.assign(new Error("This dog is no longer available for adoption."), { status: 409 });
        }

        const id = randomUUID();
        await tx.insert(adoptionRequests).values({ id, userId: user.id, dogId: dog.id, status: "pending" });
        const [created] = await tx.select(requestFields).from(adoptionRequests)
          .where(eq(adoptionRequests.id, id)).limit(1);
        return created;
      });
      res.status(201).json(request);
    } catch (error) {
      if (error.status === 401) return authenticationRequired(res);
      if ((error.cause?.code || error.code) === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "You have already requested adoption of this dog." });
      }
      next(error);
    }
  });

  router.get("/me", authenticate, async (req, res, next) => {
    let page;
    try {
      page = parsePage(req.query);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    try {
      const requests = await database.select(requestFields).from(adoptionRequests)
        .where(eq(adoptionRequests.userId, req.user._id))
        .orderBy(desc(adoptionRequests.createdAt), desc(adoptionRequests.id))
        .limit(page.limit).offset(page.offset);
      res.json(requests);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
