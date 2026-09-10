export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allowedOrigins = new Set([
    "https://medha-hub.web.app",
    "https://medha-hub.firebaseapp.com",
    "https://medha-communications.vercel.app"
  ]);
  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const authorization = req.headers.authorization || "";
  if (!/^Bearer\s+.+$/i.test(authorization)) return res.status(401).json({ error: "Medha Hub token required" });
  try {
    const upstream = await fetch("https://medha-clockin.vercel.app/api/hub-session", { method: "POST", headers: { Authorization: authorization } });
    const body = await upstream.text();
    res.status(upstream.status).send(body);
  } catch {
    res.status(502).json({ error: "Could not verify Medha Hub launch" });
  }
}
