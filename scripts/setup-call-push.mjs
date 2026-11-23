// One-time setup: lets Stream ring phones for Spaces calls when Medha Hub is closed.
//
//   node scripts/setup-call-push.mjs <activities.env> [firebase-service-account.json]
//
// <activities.env>  output of `npx vercel env pull` in medha mobile/backend/activities
//                   (holds APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY, reused for VoIP).
// The Firebase JSON is optional; without it only the iPhone (VoIP) provider is created.
// Stream credentials come from this repo's .env.local. No secret is printed.
import fs from "node:fs";
import { StreamChat } from "stream-chat";

const parseEnv = file => Object.fromEntries(fs.readFileSync(file, "utf8").split("\n")
  .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
  .map(([, k, v]) => [k, v.replace(/^"|"$/g, "").replace(/\\n/g, "\n")]));

const [envFile, firebaseFile] = process.argv.slice(2);
if (!envFile) { console.error("Usage: node scripts/setup-call-push.mjs <activities.env> [firebase.json]"); process.exit(1); }
const local = parseEnv(new URL("../.env.local", import.meta.url));
const act = parseEnv(envFile);
const client = StreamChat.getInstance(local.STREAM_API_KEY, local.STREAM_API_SECRET);

if (!act.APNS_KEY_ID || !act.APNS_TEAM_ID || !act.APNS_PRIVATE_KEY) throw new Error("APNS_* values missing in " + envFile);
await client.upsertPushProvider({
  name: "medha-apn", type: "apn",
  apn_auth_key: act.APNS_PRIVATE_KEY, apn_key_id: act.APNS_KEY_ID, apn_team_id: act.APNS_TEAM_ID,
  apn_topic: "com.medha.hub.voip", apn_development: false,
});
console.log("✓ medha-apn (iPhone VoIP) created");

if (firebaseFile) {
  const json = fs.readFileSync(firebaseFile, "utf8");
  if (JSON.parse(json).project_id !== "medhaclockin") throw new Error("Service account is not for Firebase project medhaclockin");
  await client.upsertPushProvider({ name: "medha-fcm", type: "firebase", firebase_credentials: json });
  console.log("✓ medha-fcm (Android) created");
} else {
  console.log("• medha-fcm skipped (no Firebase JSON given)");
}

const { push_providers } = await client.listPushProviders();
console.log("Stream push providers:", push_providers.map(p => `${p.name} (${p.type})`).join(", "));
