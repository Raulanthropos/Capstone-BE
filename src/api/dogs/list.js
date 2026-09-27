import express from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { dogs, dogImages } from "../../db/schema.ts";

const sortColumns = { name: dogs.name, breed: dogs.breed, age: dogs.age, weight: dogs.weight };
const queryKeys = new Set(["sort", "order", "isNeutered", "limit", "offset"]);

function parseQuery(query) {
  if (Object.entries(query).some(([key, value]) => !queryKeys.has(key) || typeof value !== "string")) {
    throw new Error("Use only sort, order, isNeutered, limit and offset, with one value per parameter.");
  }
  const { sort = "name", order = "asc", isNeutered, limit = "100", offset = "0" } = query;
  if (!Object.hasOwn(sortColumns, sort)) throw new Error("Sort must be name, breed, age or weight.");
  if (!["asc", "desc"].includes(order)) throw new Error("Order must be asc or desc.");
  if (isNeutered !== undefined && !["true", "false"].includes(isNeutered)) {
    throw new Error("isNeutered must be true or false.");
  }
  if (!/^[1-9]\d*$/.test(limit) || Number(limit) > 100) {
    throw new Error("Limit must be an integer between 1 and 100.");
  }
  if (!/^(0|[1-9]\d*)$/.test(offset) || Number(offset) > 100000) {
    throw new Error("Offset must be an integer between 0 and 100000.");
  }
  return { sort, order, isNeutered, limit: Number(limit), offset: Number(offset) };
}

const publicDogFields = {
  _id: dogs.id, name: dogs.name, breed: dogs.breed, age: dogs.age,
  gender: dogs.gender, weight: dogs.weight, location: dogs.location,
  description: dogs.description, isAdopted: dogs.isAdopted, isNeutered: dogs.isNeutered,
};

export function createDogListingRouter(database) {
  const router = express.Router();

  router.get("/", async (req, res, next) => {
    let query;
    try {
      query = parseQuery(req.query);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    try {
      const conditions = [eq(dogs.isAdopted, false)];
      if (query.isNeutered !== undefined) {
        conditions.push(eq(dogs.isNeutered, query.isNeutered === "true"));
      }
      const direction = query.order === "desc" ? desc : asc;
      const rows = await database.select(publicDogFields).from(dogs)
        .where(and(...conditions))
        .orderBy(direction(sortColumns[query.sort]), asc(dogs.id))
        .limit(query.limit).offset(query.offset);

      if (rows.length === 0) return res.json([]);

      // Fetch images after paging dogs, so a dog with several photos appears once.
      const images = await database.select({
        _id: dogImages.id, dogId: dogImages.dogId, url: dogImages.url,
        fileName: dogImages.fileName, size: dogImages.size, type: dogImages.type,
      }).from(dogImages).where(inArray(dogImages.dogId, rows.map((dog) => dog._id)))
        .orderBy(asc(dogImages.dogId), asc(dogImages.position));

      const imagesByDog = new Map(rows.map((dog) => [dog._id, []]));
      const apiOrigin = req.protocol + "://" + req.get("host");
      for (const { dogId, ...image } of images) {
        imagesByDog.get(dogId).push({
          ...image,
          // Relative seed paths must resolve against the API, not the frontend.
          url: new URL(image.url, apiOrigin).href,
        });
      }

      res.json(rows.map((dog) => ({ ...dog, images: imagesByDog.get(dog._id) })));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
