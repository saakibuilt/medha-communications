# Medha Space — setup

## Current access model

The browser talks to Supabase directly with the anon key, and the tables
are open (`using (true)`).

> ⚠️ **Known limitation.** The anon key ships in `app.js`, so anyone who
> opens devtools on the site can read every conversation between every
> employee and insert messages as any `sender_id`. This is long-standing
> behaviour, not something introduced recently, but it is worth closing.

## SQL, in order

```
supabase-communications-migration.sql   # merges duplicate direct threads
supabase-communications-compact.sql     # compact storage
supabase-communications-rollback.sql    # only if you hit an RLS error
```

`supabase-communications-rollback.sql` fixes:

```
new row violates row-level security policy
for table "medha_communications_conversations"
```

That error means restrictive policies were applied while the app still
used the anon key, so every request arrived unauthenticated.

Steps 1–2 and the app deploy must go out together — the schema and the
client change at the same time.

## Closing the privacy gap later

Two workable routes. Both need one setup step that has to happen once.

**A. Verified API (recommended).** Restore `api/space.js` from commit
`ee9654f` — it verifies each caller's Firebase ID token and queries
Supabase with the service-role key, scoping every read and write to that
uid. Authorization is covered by tests in that commit.

Needs `SUPABASE_SERVICE_ROLE_KEY` in the `medha-communications` Vercel
project:

```bash
vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

The value is the same one `medha-activities`, `files storage` and
`clockin` already use (Supabase → Settings → API → `service_role`). Vercel
Shared Environment Variables would avoid the copy, but that is a Pro
feature and this team is on Hobby, so each project keeps its own.

**B. Firebase third-party auth.** Register Firebase (project
`medhaclockin`) under Supabase → Authentication → Third Party Auth, then
apply per-participant policies keyed on the verified uid. No service-role
key involved, but it does need the dashboard step.
