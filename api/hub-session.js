export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const authorization = req.headers.authorization || "";
  if (!/^Bearer\s+.+$/i.test(authorization)) return res.status(401).json({ error: "Medha Hub token required" });
  try {
    const upstream = await fetch("https://medha-clockin.vercel.app/api/hub-session", { method: "POST", headers: { Authorization: authorization } });
    const body = await upstream.text();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.status(upstream.status).send(body);
  } catch {
    res.status(502).json({ error: "Could not verify Medha Hub launch" });
  }
}
