/* Warehouse entries for Space's "Share from Medha apps" picker.

   Warehouse keeps its data in its own Supabase project behind its own API,
   which sends no CORS headers, so Space reads it server-to-server here. The
   caller must be a signed-in, active Medha user whose role may open Warehouse
   - the same app_visibility rule Medha Hub applies to its tiles - and only a
   short summary of each entry is returned, never its rows. */
const SUPABASE_URL = "https://nnvyfeckimnjvmeneiro.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_H-o5HRFu3lCq5E9Hf1s3uA_Hi_LaMnY";
const FIREBASE_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyDhyDoFRrCXXEkoQ3i6wpqmNd8Po6p_KIw";
const WAREHOUSE_ENTRIES = "https://medha-warehouse.vercel.app/api/entries";

async function supabase(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.json();
}

function parseSetting(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value) || {}; } catch { return {}; }
  }
  return value || {};
}

// Mirrors Medha Hub's appVisibilityRoleForUser / paintAppVisibility.
function visibilityRole(user) {
  const custom = user?.permissions?.__custom_role;
  if (custom) return custom;
  if (user?.role !== "employee") return user?.role;
  return { full_time: "employee_full", part_time: "employee_part", contract: "contractor", temporary: "temporary" }[user?.employment_type] || "employee";
}
function appAllowed(visibility, app, user) {
  const cfg = visibility?.[app];
  if (!cfg) return true;
  const allows = value => value !== false && value !== "false" && value !== 0;
  const role = visibilityRole(user);
  if (Object.prototype.hasOwnProperty.call(cfg, role)) return allows(cfg[role]);
  if (user?.role && Object.prototype.hasOwnProperty.call(cfg, user.role)) return allows(cfg[user.role]);
  return true;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const idToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!idToken) return res.status(401).json({ error: "Medha authentication required" });
  try {
    const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
    });
    const uid = lookup.ok ? (await lookup.json()).users?.[0]?.localId : null;
    if (!uid) return res.status(401).json({ error: "Medha authentication required" });

    const [users, settings] = await Promise.all([
      supabase(`users?id=eq.${encodeURIComponent(uid)}&select=role,employment_type,permissions,is_active&limit=1`),
      supabase("app_settings?key=eq.app_visibility&select=value"),
    ]);
    const user = users?.[0];
    if (!user || user.is_active === false) return res.status(403).json({ error: "Your Medha account is not active" });
    if (!appAllowed(parseSetting(settings?.[0]?.value), "warehouse", user)) {
      return res.status(403).json({ error: "Your role does not have access to Warehouse" });
    }

    const upstream = await fetch(WAREHOUSE_ENTRIES, { headers: { Accept: "application/json" } });
    if (!upstream.ok) return res.status(502).json({ error: "Warehouse is unavailable right now" });
    const entries = await upstream.json();
    return res.status(200).json({
      entries: (Array.isArray(entries) ? entries : []).slice(0, 400).map(entry => ({
        id: String(entry.id),
        title: entry.title || "Untitled entry",
        kind: entry.kind || "",
        tag: entry.tag || "",
        status: entry.status || "",
        customer: entry.customerName || "",
        shipmentId: entry.shipmentId || "",
        createdAt: entry.createdAt || "",
        rows: Array.isArray(entry.rows) ? entry.rows.length : 0,
      })),
    });
  } catch {
    return res.status(502).json({ error: "Warehouse entries could not be loaded" });
  }
}
