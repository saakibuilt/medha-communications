/* Warehouse entries for Space's "Share from Medha apps" picker.

   Warehouse keeps its data in its own Supabase project behind its own API,
   which sends no CORS headers, so Space reads it server-to-server here. The
   caller must be a signed-in, active Medha user whose role may open Warehouse
   - the same app_visibility rule Medha Hub applies to its tiles. Delivered
   entries are left out; each entry comes back as a summary plus its part
   numbers (for part-number search), not the full rows. */
const SUPABASE_URL = "https://nnvyfeckimnjvmeneiro.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_H-o5HRFu3lCq5E9Hf1s3uA_Hi_LaMnY";
const FIREBASE_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyDhyDoFRrCXXEkoQ3i6wpqmNd8Po6p_KIw";
const WAREHOUSE_ENTRIES = "https://medha-warehouse.vercel.app/api/entries";
// Warehouse's own grouping (SHIPMENT_PAGE_STATUSES in its frontend): these are
// on the Shipments page; delivered/completed entries are left out entirely.
const SHIPMENT_STATUSES = new Set(["shipment", "shipped", "scheduled"]);
const DELIVERED_STATUSES = new Set(["deliveries", "delivered"]);

// Same column detection Warehouse uses (lib/supabase.js columnRoles).
function columnRoles(columns) {
  const find = pattern => columns.findIndex(column => pattern.test(String(column)));
  let code = find(/(?:part|item|material).*(?:no|number|code)|\bcode\b/i);
  let name = find(/desc|(?:item|material).*name/i);
  let quantity = find(/qty|quant/i);
  if (code < 0) code = 0;
  if (name < 0) name = Math.min(1, columns.length - 1);
  if (quantity < 0) quantity = columns.length - 1;
  return { code, name, quantity };
}
// [partNumber, description, quantity] per row, so the picker can search by
// part number and show which part matched.
function entryParts(entry) {
  const columns = Array.isArray(entry.columns) ? entry.columns : [];
  const roles = columnRoles(columns);
  return (Array.isArray(entry.rows) ? entry.rows : []).slice(0, 500).map(values => {
    const row = Array.isArray(values) ? values : [];
    return [row[roles.code], row[roles.name], row[roles.quantity]].map(value => String(value ?? "").trim().slice(0, 120));
  }).filter(([code, name]) => code || name);
}

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
    const open = (Array.isArray(entries) ? entries : []).filter(entry => {
      const status = String(entry.status || "stock").trim().toLowerCase();
      return !entry.completedAt && !DELIVERED_STATUSES.has(status);
    });
    return res.status(200).json({
      entries: open.slice(0, 600).map(entry => {
        const status = String(entry.status || "stock").trim().toLowerCase();
        return {
          id: String(entry.id),
          title: entry.title || "Untitled entry",
          kind: entry.kind || "",
          // Warehouse calls the tag the entry's warehouse location.
          location: entry.tag || "",
          status,
          group: SHIPMENT_STATUSES.has(status) ? "shipments" : "stock",
          customer: entry.customerName || "",
          shipmentId: entry.shipmentId || "",
          createdAt: entry.createdAt || "",
          rows: Array.isArray(entry.rows) ? entry.rows.length : 0,
          parts: entryParts(entry),
        };
      }),
    });
  } catch {
    return res.status(502).json({ error: "Warehouse entries could not be loaded" });
  }
}
