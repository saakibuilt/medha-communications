/* GIF search proxy.

   The API key stays on the server: sending it to the browser would publish
   it to every visitor. Tenor is used because its content is moderated by
   default (contentfilter=medium) and it returns small preview URLs that a
   grid can load without pulling multi-megabyte originals.

   Set TENOR_API_KEY in the project environment. Without it the endpoint
   reports 503 and the picker tells the user GIF search is unavailable
   rather than failing silently. */
const ENDPOINT = "https://tenor.googleapis.com/v2";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const key = process.env.TENOR_API_KEY;
  if (!key) return res.status(503).json({ error: "GIF search is not configured" });

  const query = String(req.query?.q || "").trim().slice(0, 100);
  const limit = Math.min(Number(req.query?.limit) || 24, 50);
  /* An empty query shows what is trending, so the picker is never a blank
     box waiting for input. */
  const path = query ? "search" : "featured";
  const params = new URLSearchParams({
    key,
    limit: String(limit),
    contentfilter: "medium",
    media_filter: "tinygif,gif",
    client_key: "medha_space",
  });
  if (query) params.set("q", query);

  try {
    const response = await fetch(`${ENDPOINT}/${path}?${params}`);
    if (!response.ok) throw Error(`Tenor responded ${response.status}`);
    const body = await response.json();
    const results = (body.results || []).map((item) => ({
      id: String(item.id || ""),
      description: String(item.content_description || "GIF").slice(0, 120),
      /* preview is what the grid renders; url is what gets sent. */
      preview: item.media_formats?.tinygif?.url || item.media_formats?.gif?.url || "",
      url: item.media_formats?.gif?.url || item.media_formats?.tinygif?.url || "",
      width: item.media_formats?.gif?.dims?.[0] || null,
      height: item.media_formats?.gif?.dims?.[1] || null,
    })).filter((item) => item.preview && item.url);
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({ results });
  } catch (error) {
    return res.status(502).json({ error: error.message || "GIF search failed" });
  }
}
