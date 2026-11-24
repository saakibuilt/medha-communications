// Stream shows people by their Medha profile name (users.full_name), never an email.
const SUPABASE_URL = "https://nnvyfeckimnjvmeneiro.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_H-o5HRFu3lCq5E9Hf1s3uA_Hi_LaMnY";

export async function medhaNames(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/users?select=id,full_name&id=in.(${list.map(encodeURIComponent).join(",")})`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const rows = r.ok ? await r.json() : [];
    return Object.fromEntries(rows.filter(u => u.full_name && !u.full_name.includes("@")).map(u => [u.id, u.full_name.trim()]));
  } catch { return {}; }
}

/** Profile name, else a non-email fallback, else the part before "@". */
export const displayName = (profile, ...fallbacks) => {
  if (profile) return profile;
  for (const v of fallbacks) { const s = String(v || "").trim(); if (s && !s.includes("@")) return s.slice(0, 80); }
  const email = fallbacks.map(v => String(v || "")).find(v => v.includes("@"));
  return email ? email.split("@")[0] : "Medha user";
};
