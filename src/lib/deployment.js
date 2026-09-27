export function getHttpSettings(env = process.env) {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }
  const proxy = env.TRUST_PROXY || "0";
  if (!["0", "1"].includes(proxy)) throw new Error("TRUST_PROXY must be 0 or 1.");
  const configuredUrl = env.PUBLIC_API_URL || env.RENDER_EXTERNAL_URL;
  let publicApiUrl;
  if (configuredUrl) {
    const url = new URL(configuredUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash || (production && url.protocol !== "https:")) {
      throw new Error("PUBLIC_API_URL must be an origin URL (HTTPS in production).");
    }
    publicApiUrl = url.origin;
  }
  return {
    port, host: env.API_HOST || (production ? "0.0.0.0" : "127.0.0.1"),
    trustProxy: Number(proxy), publicApiUrl,
  };
}
