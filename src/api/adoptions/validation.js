export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePage(query) {
  if (Object.entries(query).some(([key, value]) =>
    !["limit", "offset"].includes(key) || typeof value !== "string")) {
    throw new Error("Use only limit and offset, with one value per parameter.");
  }
  const { limit = "100", offset = "0" } = query;
  if (!/^[1-9]\d*$/.test(limit) || Number(limit) > 100) {
    throw new Error("Limit must be an integer between 1 and 100.");
  }
  if (!/^(0|[1-9]\d*)$/.test(offset) || Number(offset) > 100000) {
    throw new Error("Offset must be an integer between 0 and 100000.");
  }
  return { limit: Number(limit), offset: Number(offset) };
}
