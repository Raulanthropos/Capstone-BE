const defaultOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://woof-paws-raulanthropos.vercel.app",
  "https://woof-paws.vercel.app",
];

export function getAllowedOrigins(env = process.env) {
  const origins = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : defaultOrigins.filter((origin) => env.NODE_ENV !== "production" || origin.startsWith("https://"));
  if (!origins.length) throw new Error("CORS_ORIGINS must contain at least one origin.");
  for (const origin of origins) {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
      throw new Error("CORS_ORIGINS must contain exact origins without paths or trailing slashes.");
    }
  }
  return [...new Set(origins)];
}

export const allowedOrigins = getAllowedOrigins();
