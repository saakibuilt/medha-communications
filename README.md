# Medha Communications

Static Vercel app for Medha chat and workspace communications.

## Local development

```sh
npm run dev
```

Open `http://localhost:4173/`.

## Supabase setup

Run `supabase-communications.sql` in the shared Medha Supabase project before using chat persistence. The app uses the existing Medha Firebase sign-in and Supabase REST API.

## Background chat and call notifications

The existing Medha Hub Web Push subscriptions are stored in Supabase and sent by
`https://medha-activities.vercel.app/api/space-push`. Stream does not know about
those subscriptions automatically. Configure a Stream webhook for both Chat and
Video events to call:

```text
https://medha-communications.vercel.app/api/stream-webhook
```

Enable at least `message.new` and `call.ring`. The endpoint verifies the
`X-Signature` with the server-only `STREAM_API_SECRET`, then forwards only the
recipient IDs to the existing Medha Hub push sender. Chat messages remain stored
in Stream; Supabase stores only the push subscriptions.
