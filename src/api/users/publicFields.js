import { users } from "../../db/schema.ts";

// Preserve the frontend contract without ever selecting a password hash.
export const publicUserFields = {
  _id: users.id,
  name: users.name,
  surname: users.surname,
  age: users.age,
  email: users.email,
  picture: users.picture,
  role: users.role,
  description: users.description,
};
