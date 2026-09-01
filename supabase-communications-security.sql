-- ============================================================
-- Medha Space — conversation privacy.
--
-- SAFE TO RUN NOW. No Firebase or Supabase dashboard setup needed.
--
-- How access works:
--   The browser never queries these tables. It calls /api/space, which
--   verifies the caller's Firebase ID token, derives their uid, and then
--   queries Supabase with the SERVICE ROLE key, scoping every read and
--   write to that uid.
--
--   Service role bypasses RLS by design. So the job of the policies below
--   is simply to deny everyone else: the anon key that ships in the
--   browser can no longer read or write conversation data at all.
--
-- Required: set SUPABASE_SERVICE_ROLE_KEY in the Vercel project
-- (Settings > Environment Variables) BEFORE running this file, or the app
-- loses access to its own data.
--
-- Rollback is at the bottom.
-- ============================================================

alter table public.medha_communications_conversations       enable row level security;
alter table public.medha_communications_messages            enable row level security;
alter table public.medha_communications_user_conversations  enable row level security;
alter table public.medha_communications_presence            enable row level security;
alter table public.medha_communications_meetings            enable row level security;

-- Drop every permissive policy from the original schema.
drop policy if exists "communications conversations all" on public.medha_communications_conversations;
drop policy if exists "conversations select own"         on public.medha_communications_conversations;
drop policy if exists "conversations insert own"         on public.medha_communications_conversations;
drop policy if exists "conversations update own"         on public.medha_communications_conversations;

drop policy if exists "communications messages all"  on public.medha_communications_messages;
drop policy if exists "messages select own"          on public.medha_communications_messages;
drop policy if exists "messages insert own"          on public.medha_communications_messages;
drop policy if exists "messages update reactions"    on public.medha_communications_messages;
drop policy if exists "messages delete own"          on public.medha_communications_messages;

drop policy if exists "communications user chats all" on public.medha_communications_user_chats;
drop policy if exists "user conversations own"        on public.medha_communications_user_conversations;

drop policy if exists "communications presence all" on public.medha_communications_presence;
drop policy if exists "presence read"               on public.medha_communications_presence;
drop policy if exists "presence write own"          on public.medha_communications_presence;

drop policy if exists "communications meetings all"  on public.medha_communications_meetings;
drop policy if exists "meetings select involved"     on public.medha_communications_meetings;
drop policy if exists "meetings insert own"          on public.medha_communications_meetings;
drop policy if exists "meetings modify own"          on public.medha_communications_meetings;
drop policy if exists "meetings delete own"          on public.medha_communications_meetings;

-- With RLS enabled and no policy present, anon and authenticated are denied
-- every operation. Service role still has full access, which is what
-- /api/space uses after it has verified who is calling.
revoke all on public.medha_communications_conversations      from anon, authenticated;
revoke all on public.medha_communications_messages           from anon, authenticated;
revoke all on public.medha_communications_user_conversations from anon, authenticated;
revoke all on public.medha_communications_presence           from anon, authenticated;
revoke all on public.medha_communications_meetings           from anon, authenticated;

-- The sidebar view is read only through the API, so lock it down too.
revoke all on public.medha_communications_my_conversations from anon, authenticated;
alter view public.medha_communications_my_conversations set (security_invoker = true);

-- Messages stay append-only apart from reactions, so a bug or a stray
-- service-role call cannot silently rewrite history.
create or replace function public.medha_communications_message_immutable() returns trigger
language plpgsql as $$
begin
  if new.sender_id <> old.sender_id or new.cid <> old.cid
     or new.body <> old.body or new.created_at <> old.created_at then
    raise exception 'Only reactions may be updated on a message';
  end if;
  return new;
end; $$;
drop trigger if exists medha_communications_message_immutable_trigger on public.medha_communications_messages;
create trigger medha_communications_message_immutable_trigger
  before update on public.medha_communications_messages
  for each row execute function public.medha_communications_message_immutable();

-- ---------- attachments bucket ----------
-- Uploads still go straight from the browser with the anon key, so keep
-- this bucket readable. Files are addressed by an unguessable uuid path.
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

-- ============================================================
-- ROLLBACK — restores the previous open behaviour if anything breaks.
-- ============================================================
-- grant all on public.medha_communications_conversations      to anon, authenticated;
-- grant all on public.medha_communications_messages           to anon, authenticated;
-- grant all on public.medha_communications_user_conversations to anon, authenticated;
-- grant all on public.medha_communications_presence           to anon, authenticated;
-- grant all on public.medha_communications_meetings           to anon, authenticated;
-- grant all on public.medha_communications_my_conversations   to anon, authenticated;
-- create policy "communications conversations all" on public.medha_communications_conversations for all using (true) with check (true);
-- create policy "communications messages all"      on public.medha_communications_messages      for all using (true) with check (true);
-- create policy "user conversations own"           on public.medha_communications_user_conversations for all using (true) with check (true);
-- create policy "communications presence all"      on public.medha_communications_presence      for all using (true) with check (true);
-- create policy "communications meetings all"      on public.medha_communications_meetings      for all using (true) with check (true);
