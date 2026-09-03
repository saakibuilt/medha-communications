/* GIF search proxy (Giphy).

   The API key stays on the server: putting it in the page would publish it
   to every visitor, and anyone could then spend the quota.

   Keys are read from the environment, newline/comma separated in priority
   order, and tried in turn. A key that is rate limited (429) or rejected
   (401/403) falls through to the next one, so one exhausted key does not
   take GIF search down. Everything else is returned as-is - retrying a
   genuine bad request against three keys would just be three failures. */
const ENDPOINT = "https://api.giphy.com/v1/gifs";

function apiKeys() {
  return String(process.env.GIPHY_API_KEYS || process.env.GIPHY_API_KEY || "")
    .split(/[\s,]+/)
    .map((key) => key.trim())
    .filter(Boolean);
}

/* rating=pg-13 and the messaging bundle keep results appropriate for a
   workplace chat and sized for a picker rather than full-resolution files. */
function buildUrl(key, query, limit) {
  const params = new URLSearchParams({
    api_key: key,
    limit: String(limit),
    rating: "pg-13",
    bundle: "messaging_non_clips",
  });
  if (query) params.set("q", query);
  return `${ENDPOINT}/${query ? "search" : "trending"}?${params}`;
}

function normalise(body) {
  return (body.data || [])
    .map((item) => {
      const images = item.images || {};
      return {
        id: String(item.id || ""),
        description: String(item.title || "GIF").slice(0, 120),
        /* A downsampled still for the grid; the full GIF only when sent. */
        preview:
          images.fixed_width_downsampled?.url ||
          images.fixed_width_small?.url ||
          images.fixed_width?.url ||
          "",
        url: images.fixed_width?.url || images.original?.url || "",
        width: Number(images.fixed_width?.width) || null,
        height: Number(images.fixed_width?.height) || null,
      };
    })
    .filter((item) => item.preview && item.url);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const keys = apiKeys();
  if (!keys.length) return res.status(503).json({ error: "GIF search is not configured" });

  const query = String(req.query?.q || "").trim().slice(0, 100);
  const limit = Math.min(Number(req.query?.limit) || 24, 50);

  let lastError = "GIF search failed";
  for (const key of keys) {
    try {
      const response = await fetch(buildUrl(key, query, limit));
      /* Only a quota or auth problem is worth another key. */
      if (response.status === 429 || response.status === 401 || response.status === 403) {
        lastError = `Giphy responded ${response.status}`;
        continue;
      }
      if (!response.ok) {
        lastError = `Giphy responded ${response.status}`;
        break;
      }
      const body = await response.json();
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(200).json({ results: normalise(body) });
    } catch (error) {
      lastError = error.message || "GIF search failed";
    }
  }
  return res.status(502).json({ error: lastError });
}
