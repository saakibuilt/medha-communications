# Medha Space — access model

The browser holds no key that can read conversations.

```
browser ──Firebase ID token──▶ /api/space ──service-role key──▶ Supabase
                                    │
                            verifies the token,
                            derives the uid, and
                            scopes every query to it
```

`/api/space` verifies each request against Google's Identity Toolkit, so
there is nothing to register in the Supabase dashboard and no Firebase
third-party auth provider to configure.

## One-time setup

**1. Add the service-role key to Vercel** (required — the API returns 503
without it):

Vercel → project `medha-communications` → Settings → Environment Variables

| Name | Value | Environments |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` secret | Production, Preview, Development |

Or from the CLI:

```bash
vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

This key bypasses RLS. It must never appear in client code or in git.

**2. Run the SQL, in this order**, in the Supabase SQL editor:

```
supabase-communications-migration.sql   # merges duplicate threads
supabase-communications-compact.sql     # compact storage
supabase-communications-security.sql    # revokes anon access
```

**3. Deploy.** Step 2 and the deploy must go out together — the schema and
the client change at the same time.

## Verifying

After deploying, in the browser console on the live site:

```js
await fetch('https://nnvyfeckimnjvmeneiro.supabase.co/rest/v1/medha_communications_messages?select=*', {
  headers: { apikey: 'sb_publishable_H-o5HRFu3lCq5E9Hf1s3uA_Hi_LaMnY' }
}).then(r => r.status)
```

Expect `401` or `403`. A `200` means the anon key can still read messages
and step 2 did not apply.

## If something breaks

`supabase-communications-security.sql` ends with a commented rollback block
that restores the previous open policies.
