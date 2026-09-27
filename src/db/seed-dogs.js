import { stat } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { dogs, dogImages } from "./schema.ts";

// Fixed IDs identify demo records across runs; none of these describe real listings.
export const demoDogs = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    imageId: "00000000-0000-4000-8000-000000000201",
    imageFile: "luna.jpg",
    name: "Luna", breed: "Husky", age: 3, gender: "female", weight: 21.5,
    location: "Athens", isNeutered: true,
    description: "Demo profile: Luna is an energetic companion who enjoys long walks and outdoor adventures.",
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    imageId: "00000000-0000-4000-8000-000000000202",
    imageFile: "milo.jpg",
    name: "Milo", breed: "Beagle", age: 0.8, gender: "male", weight: 8.25,
    location: "Thessaloniki", isNeutered: false,
    description: "Demo profile: Milo is a curious young dog who loves exploring new scents and playing.",
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    imageId: "00000000-0000-4000-8000-000000000203",
    imageFile: "rocky.jpg",
    name: "Rocky", breed: "Corgi", age: 5, gender: "male", weight: 12.5,
    location: "Patras", isNeutered: true,
    description: "Demo profile: Rocky is a friendly companion who enjoys gentle walks and spending time with people.",
  },
];

// The caller owns the transaction so this can also be used in rollback-only tests.
export async function insertDemoDogs(database, records = demoDogs) {
  const prepared = await Promise.all(records.map(async ({ imageId, imageFile, ...dog }) => {
    const file = await stat(new URL("../../public/demo-dogs/" + imageFile, import.meta.url));
    return {
      dog,
      image: {
        id: imageId, dogId: dog.id, url: "/demo-dogs/" + imageFile,
        fileName: imageFile, size: file.size, type: "image/jpeg", position: 0,
      },
    };
  }));

  for (const { dog, image } of prepared) {
    // A no-op on conflicts keeps any edits made to an existing dog or its photo.
    await database.insert(dogs).values(dog)
      .onDuplicateKeyUpdate({ set: { id: sql`${dogs.id}` } });
    await database.insert(dogImages).values(image)
      .onDuplicateKeyUpdate({ set: { id: sql`${dogImages.id}` } });
  }
}
