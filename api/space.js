/* Medha Space data API.
 *
 * The browser never holds a key that can read other people's conversations.
 * Every request carries the caller's Firebase ID token; this function verifies
 * it, derives the uid, and then talks to Supabase with the service-role key,
 * scoping every query to that uid. RLS stays strict and the anon key is not
 * used for conversation data at all, so nothing has to be registered in the
 * Supabase dashboard.
 */
const SUPABASE_URL = process.env.SUPABASE_URL || "https://nnvyfeckimnjvmeneiro.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyDhyDoFRrCXXEkoQ3i6wpqmNd8Po6p_KIw";
const MAX_BODY = 4000;

/* Verify the Firebase ID token and return its uid.
   Uses the public Identity Toolkit endpoint, so no admin SDK or service
   account is needed here. */
async function uidFromToken(idToken) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) }
  );
  if (!r.ok) return null;
  const data = await r.json();
  const user = data?.users?.[0];
  if (!user?.localId) return null;
  if (user.disabled) return null;
  return String(user.localId);
}

async function sb(path, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw Object.assign(new Error(detail.slice(0, 300) || `Supabase ${r.status}`), { status: r.status });
  }
  if (r.status === 204) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

const enc = encodeURIComponent;

/* Is this user a member of this conversation? Every read and write below
   goes through here, so one user can never touch another's thread. */
async function assertMember(uid, cid) {
  const rows = await sb(
    `medha_communications_user_conversations?user_id=eq.${enc(uid)}&cid=eq.${enc(cid)}&select=cid`
  );
  if (!rows?.length) throw Object.assign(new Error("Not your conversation"), { status: 403 });
}

const handlers = {
  /* Sidebar: this user's conversations, one read. */
  async conversations(uid) {
    return await sb(
      `medha_communications_my_conversations?user_id=eq.${enc(uid)}` +
        `&select=cid,conversation_key,kind,title,participant_ids,last_message,updated_at&order=updated_at.desc`
    );
  },

  /* Employee directory - names only, for the chat list and new-chat picker. */
  async directory() {
    return await sb("users?select=id,full_name,email,department,role&is_active=eq.true&order=full_name.asc");
  },

  /* One thread's messages, newest-first page. */
  async messages(uid, { cid, offset = 0, limit = 25 }) {
    await assertMember(uid, cid);
    const size = Math.min(Number(limit) || 25, 100);
    return await sb(
      `medha_communications_messages?cid=eq.${enc(cid)}` +
        `&select=id,cid,sender_id,body,attachments,reactions,created_at` +
        `&order=created_at.desc,id.desc&offset=${Number(offset) || 0}&limit=${size}`
    );
  },

  /* Open (or create) the direct thread between the caller and one other
     person. The id is derived from both uids, so both sides land on the
     same row and the caller cannot invent a thread they are not part of. */
  async openDirect(uid, { withUserId }) {
    const other = String(withUserId || "");
    if (!other) throw Object.assign(new Error("withUserId required"), { status: 400 });
    const pair = [uid, other].sort();
    const key = `dm_${pair[0]}__${pair[1]}`;
    const existing = await sb(
      `medha_communications_conversations?id=eq.${enc(key)}&select=cid,id,last_message,updated_at`
    );
    if (existing?.length) return existing[0];
    const created = await sb("medha_communications_conversations", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ id: key, title: "", kind: "direct", participant_ids: pair }),
    });
    if (created?.length) return created[0];
    const again = await sb(`medha_communications_conversations?id=eq.${enc(key)}&select=cid,id,last_message,updated_at`);
    if (!again?.length) throw Object.assign(new Error("Could not open that conversation"), { status: 500 });
    return again[0];
  },

  /* Send. sender_id is taken from the verified token, never from the body,
     so a caller cannot post as somebody else. */
  async send(uid, { cid, body, attachments }) {
    await assertMember(uid, cid);
    const text = String(body || "").trim();
    if (!text) throw Object.assign(new Error("Message is empty"), { status: 400 });
    if (text.length > MAX_BODY)
      throw Object.assign(new Error(`Message is too long (${MAX_BODY} characters maximum)`), { status: 400 });
    const rows = await sb("medha_communications_messages", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        cid,
        sender_id: uid,
        body: text,
        attachments: Array.isArray(attachments) ? attachments : [],
      }),
    });
    return rows?.[0] || null;
  },

  /* New messages across this user's threads, for the ping and unread counts. */
  async incoming(uid, { since }) {
    const mine = await sb(`medha_communications_user_conversations?user_id=eq.${enc(uid)}&select=cid`);
    const ids = (mine || []).map((r) => r.cid);
    if (!ids.length) return [];
    return await sb(
      `medha_communications_messages?cid=in.(${ids.join(",")})` +
        `&sender_id=neq.${enc(uid)}&created_at=gt.${enc(since || new Date().toISOString())}` +
        `&select=id,cid,sender_id,body,created_at&order=created_at.asc`
    );
  },

  /* React. Only participants, and the trigger keeps one reaction key. */
  async react(uid, { cid, messageId, reactions }) {
    await assertMember(uid, cid);
    await sb(`medha_communications_messages?id=eq.${enc(messageId)}&cid=eq.${enc(cid)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ reactions: reactions || {} }),
    });
    return { ok: true };
  },

  /* Leave a conversation: removes only the caller's membership row. */
  async leave(uid, { cid }) {
    await assertMember(uid, cid);
    await sb(`medha_communications_user_conversations?user_id=eq.${enc(uid)}&cid=eq.${enc(cid)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    return { ok: true };
  },

  /* Presence heartbeat. */
  async presence(uid, { isOpen, peerId }) {
    await sb("medha_communications_presence", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: uid, is_open: !!isOpen, last_seen: new Date().toISOString() }),
    });
    if (!peerId) return { peer: null };
    const rows = await sb(
      `medha_communications_presence?user_id=eq.${enc(peerId)}&select=user_id,is_open,last_seen`
    );
    return { peer: rows?.[0] || null };
  },

  /* Calendar meetings the caller created or was invited to. */
  async meetings(uid) {
    return await sb(
      `medha_communications_meetings?or=(created_by.eq.${enc(uid)},invitee_ids.cs.{${enc(uid)}})` +
        `&select=id,title,start_at,end_at,location,invitee_ids,created_by&order=start_at.asc`
    );
  },

  async createMeeting(uid, { title, startAt, endAt, location, inviteeIds }) {
    if (!title || !startAt || !endAt) throw Object.assign(new Error("Title, start and end are required"), { status: 400 });
    if (new Date(endAt) <= new Date(startAt))
      throw Object.assign(new Error("End time must be after start time"), { status: 400 });
    const rows = await sb("medha_communications_meetings", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        title: String(title).slice(0, 160),
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        location: location || null,
        invitee_ids: Array.isArray(inviteeIds) ? inviteeIds : [],
        created_by: uid,
      }),
    });
    return rows?.[0] || null;
  },

  async updateMeeting(uid, { id, title, startAt, endAt, location, inviteeIds }) {
    const owned = await sb(`medha_communications_meetings?id=eq.${enc(id)}&created_by=eq.${enc(uid)}&select=id`);
    if (!owned?.length) throw Object.assign(new Error("Not your meeting"), { status: 403 });
    await sb(`medha_communications_meetings?id=eq.${enc(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        title: String(title).slice(0, 160),
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        location: location || null,
        invitee_ids: Array.isArray(inviteeIds) ? inviteeIds : [],
      }),
    });
    return { ok: true };
  },
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  if (!SERVICE_KEY) return res.status(503).json({ error: "Space API is not configured" });

  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!match) return res.status(401).json({ error: "Sign in to Medha Hub" });

  let uid;
  try {
    uid = await uidFromToken(match[1]);
  } catch {
    return res.status(502).json({ error: "Could not verify your session" });
  }
  if (!uid) return res.status(401).json({ error: "Your session has expired. Reopen Space from Medha Hub." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const action = handlers[body.action];
  if (!action) return res.status(400).json({ error: "Unknown action" });

  try {
    const data = await action(uid, body);
    return res.status(200).json({ data });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ error: error.message || "Request failed" });
  }
}
