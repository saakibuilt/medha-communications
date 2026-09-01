-- ============================================================
-- Medha Space — restore open access.
--
-- Run this to fix:
--   "new row violates row-level security policy for
--    table medha_communications_conversations"
--
-- That error means the restrictive policies were applied while the app
-- still talks to Supabase with the anon key, so every request arrives
-- unauthenticated and every policy denies.
--
-- This file puts access back the way it was before that change.
--
-- ⚠️  SECURITY: with these policies in place, the anon key that ships in
--     the browser can read EVERY conversation between EVERY employee, and
--     can insert messages as any sender_id. Anyone who opens devtools on
--     the site can do this. This is the pre-existing behaviour, not a new
--     weakness, but it is worth closing when you can.
--
--     To close it later you need ONE of:
--       a) SUPABASE_SERVICE_ROLE_KEY set in the medha-communications
--          Vercel project, then restore api/space.js (commit ee9654f)
--       b) Firebase registered as a Supabase third-party auth provider,
--          then per-participant policies keyed on the verified uid
-- ============================================================

-- Grant the API roles access again.
grant usage on schema public to anon, authenticated;
grant all on public.medha_communications_conversations      to anon, authenticated;
grant all on public.medha_communications_messages           to anon, authenticated;
grant all on public.medha_communications_presence           to anon, authenticated;
grant all on public.medha_communications_meetings           to anon, authenticated;

do $$
begin
  if to_regclass('public.medha_communications_user_conversations') is not null then
    execute 'grant all on public.medha_communications_user_conversations to anon, authenticated';
  end if;
  if to_regclass('public.medha_communications_user_chats') is not null then
    execute 'grant all on public.medha_communications_user_chats to anon, authenticated';
  end if;
  if to_regclass('public.medha_communications_my_conversations') is not null then
    execute 'grant all on public.medha_communications_my_conversations to anon, authenticated';
  end if;
end $$;

-- Replace the deny-all state with permissive policies.
drop policy if exists "conversations select own" on public.medha_communications_conversations;
drop policy if exists "conversations insert own" on public.medha_communications_conversations;
drop policy if exists "conversations update own" on public.medha_communications_conversations;
drop policy if exists "communications conversations all" on public.medha_communications_conversations;
create policy "communications conversations all" on public.medha_communications_conversations
  for all using (true) with check (true);

drop policy if exists "messages select own"       on public.medha_communications_messages;
drop policy if exists "messages insert own"       on public.medha_communications_messages;
drop policy if exists "messages update reactions" on public.medha_communications_messages;
drop policy if exists "messages delete own"       on public.medha_communications_messages;
drop policy if exists "communications messages all" on public.medha_communications_messages;
create policy "communications messages all" on public.medha_communications_messages
  for all using (true) with check (true);

drop policy if exists "communications presence all" on public.medha_communications_presence;
drop policy if exists "presence read"      on public.medha_communications_presence;
drop policy if exists "presence write own" on public.medha_communications_presence;
create policy "communications presence all" on public.medha_communications_presence
  for all using (true) with check (true);

drop policy if exists "communications meetings all" on public.medha_communications_meetings;
drop policy if exists "meetings select involved" on public.medha_communications_meetings;
drop policy if exists "meetings insert own"      on public.medha_communications_meetings;
drop policy if exists "meetings modify own"      on public.medha_communications_meetings;
drop policy if exists "meetings delete own"      on public.medha_communications_meetings;
create policy "communications meetings all" on public.medha_communications_meetings
  for all using (true) with check (true);

do $$
begin
  if to_regclass('public.medha_communications_user_conversations') is not null then
    execute 'drop policy if exists "user conversations own" on public.medha_communications_user_conversations';
    execute 'create policy "user conversations all" on public.medha_communications_user_conversations for all using (true) with check (true)';
  end if;
  if to_regclass('public.medha_communications_user_chats') is not null then
    execute 'drop policy if exists "user chats own" on public.medha_communications_user_chats';
    execute 'drop policy if exists "communications user chats all" on public.medha_communications_user_chats';
    execute 'create policy "communications user chats all" on public.medha_communications_user_chats for all using (true) with check (true)';
  end if;
end $$;

-- The sidebar view must run with the definer's rights again so the anon
-- key can read through it.
do $$
begin
  if to_regclass('public.medha_communications_my_conversations') is not null then
    execute 'alter view public.medha_communications_my_conversations set (security_invoker = false)';
  end if;
end $$;

-- Attachments bucket stays public.
insert into storage.buckets (id, name, public)
  values ('medha-communications-files','medha-communications-files',true)
  on conflict (id) do update set public = true;
drop policy if exists "communications files read" on storage.objects;
create policy "communications files read" on storage.objects
  for select using (bucket_id='medha-communications-files');
drop policy if exists "communications files insert" on storage.objects;
create policy "communications files insert" on storage.objects
  for insert with check (bucket_id='medha-communications-files');
drop policy if exists "communications files delete" on storage.objects;
create policy "communications files delete" on storage.objects
  for delete using (bucket_id='medha-communications-files');
