/* AI reply drafting for Medha Communications.

   Cloudflare Workers AI, same account and token the Medha Hub email
   summaries use (CF_ACCOUNT_ID / CF_API_TOKEN Supabase secrets). The
   credentials never reach the browser, which is the whole reason this runs
   as an edge function instead of a fetch from app.js. */

const ALLOWED_ORIGINS = new Set([
  "https://medha-communications.vercel.app",
  "http://localhost:3000",
  "http://localhost:5000",
]);

const text = (value: unknown) => String(value ?? "");

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://medha-communications.vercel.app",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

/* When Cloudflare rate-limits, work out when the quota comes back so the
   composer can say so instead of failing vaguely. Mirrors the Hub. */
function aiResetAt(response: Response) {
  const retryAfter = Number(response.headers.get("retry-after") || 0);
  const resetHeader = response.headers.get("ratelimit-reset") || response.headers.get("x-ratelimit-reset");
  let resetAt = retryAfter > 0 ? new Date(Date.now() + retryAfter * 1000) : null;
  if (!resetAt && resetHeader) {
    const value = Number(resetHeader);
    resetAt = Number.isFinite(value) ? new Date(value > 1e12 ? value : value * 1000) : new Date(resetHeader);
  }
  if (!resetAt || Number.isNaN(resetAt.getTime())) {
    resetAt = new Date();
    resetAt.setUTCHours(24, 0, 0, 0);
  }
  return resetAt.toISOString();
}

/* The unanswered messages, oldest first, plus a little earlier context so
   the model knows what the conversation was about. */
function buildTranscript(payload: Record<string, unknown>) {
  const asTurns = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .map((item) => {
        const turn = item as Record<string, unknown>;
        const body = text(turn.text).replace(/\s+/g, " ").trim();
        if (!body) return "";
        return `${text(turn.from) || "Them"}: ${body.slice(0, 800)}`;
      })
      .filter(Boolean);

    /* The background never goes in the user turn. A small model answers what
     it is handed, so context sitting alongside the pending messages got
     answered too - the draft kept bringing up matters settled several
     messages earlier. Background belongs in the system prompt as
     description; the user turn carries only what must be replied to. */
  const context = asTurns(payload.context).slice(-4);
  const pending = asTurns(payload.pending);
  return {
    background: context.join("\n"),
    transcript: pending.join("\n").slice(0, 5000),
    pendingCount: pending.length,
  };
}

function systemPrompt(pendingCount: number, me: string, them: string, background: string) {
  const plural = pendingCount > 1
    ? `They sent ${pendingCount} messages in a row and none of them has been answered yet. Your reply must address every one of them, in the order they were sent, in a single flowing message - do not answer only the last one and do not number them like a list.`
    : "Address that one message directly.";
  return `You are drafting a reply that ${me || "the user"} will send to ${them || "a colleague"} in a workplace chat at Medha, an Indian education non-profit.

${plural}

Voice: professional but casual - the way a competent colleague actually types in a work chat. Warm, direct, contractions are fine. Not stiff or corporate, not slangy, no emoji unless the incoming messages used them.

Rules:
- Reply ONLY to what the user turn contains. Every other topic is closed; raising one is the single worst thing you can do here.
- Do not report on, confirm, or claim to have checked anything that was not asked in the user turn. If a message is not a question, a short acknowledgement is the whole reply.
- Never claim something is already done, already checked, already reviewed, or already working. You cannot know that. When asked to look at something, say you will look at it - future tense, not past.
- Write ONLY the message body. No greeting line like "Hi <name>," unless the conversation clearly opens that way, no sign-off, no subject, no quotation marks around the whole thing, no preamble such as "Here is a reply".
- One short sentence per message you are replying to, at most. Chat length, not email length.
- Answer what was actually asked. Confirm what you can confirm, and where a real answer depends on information you do not have, say plainly what you will do or when you will follow up.
- Never invent facts, dates, numbers, names, file contents, or commitments that are not supported by the conversation.
- If they asked several things, cover each briefly rather than picking one.
- Match the language of the incoming messages.
${background ? `
For understanding only, here is what was said earlier. It is CLOSED - every one of these was already answered and dealt with. Never reply to it, never mention it, never raise any topic that appears only here.
${background}
` : ""}
The user turn contains the ${pendingCount === 1 ? "one message" : `${pendingCount} messages`} you are replying to. Reply to ${pendingCount === 1 ? "it" : "them"} and to nothing else.`;
}

async function draftReply(payload: Record<string, unknown>) {
  const accountId = Deno.env.get("CF_ACCOUNT_ID");
  const token = Deno.env.get("CF_API_TOKEN");
  if (!accountId || !token) return { error: "AI replies are not configured yet." };

  const { transcript, pendingCount, background } = buildTranscript(payload);
  if (!pendingCount) return { error: "There are no new messages to reply to." };

  try {
    const model = "@cf/meta/llama-3.1-8b-instruct";
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        max_tokens: 300,
        temperature: 0.6,
        messages: [
          { role: "system", content: systemPrompt(pendingCount, text(payload.me), text(payload.them), background) },
          { role: "user", content: transcript },
        ],
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.success) {
      const cloudflareError = JSON.stringify(json?.errors || json).toLowerCase();
      if (response.status === 429 || /(daily|quota|limit|neurons|rate.?limit)/.test(cloudflareError)) {
        return { error: "AI daily free-tier limit has been exhausted.", code: "AI_DAILY_LIMIT", resetAt: aiResetAt(response) };
      }
      return { error: "A reply could not be drafted right now." };
    }
    /* Small models like to wrap the answer in quotes or lead with "Here's a
       reply:" no matter how firmly the prompt says not to. Strip both. */
    let reply = text(json.result?.response).trim();
    reply = reply.replace(/^(here(?:'s| is)[^:\n]*:|reply:|draft:)\s*/i, "").trim();
    if (reply.length > 1 && /^["'“”]/.test(reply) && /["'“”]$/.test(reply)) reply = reply.slice(1, -1).trim();
    return reply ? { reply, pendingCount } : { error: "No reply was produced." };
  } catch {
    return { error: "The AI service could not be reached." };
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  const headers = cors(origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST only." }), { status: 405, headers });

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400, headers });
  }

  const result = await draftReply(payload);
  return new Response(JSON.stringify(result), { status: result.error ? 200 : 200, headers });
});
