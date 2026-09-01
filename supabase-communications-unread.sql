-- ============================================================
-- Medha Space — unread state that follows the user, not the device.
--
-- SAFE TO RUN NOW.
--
-- Unread was tracked only in the browser tab, so opening a chat on a
-- phone left it still bold on a laptop. A per-user last_read_at makes the
-- state belong to the person: read it on any device and it is read
-- everywhere, and it never comes back for those messages.
-- ============================================================

alter table public.medha_communications_user_conversations
  add column if not exists last_read_at timestamptz not null default now();

-- Anything already in the database counts as read, so nobody logs in to a
-- wall of false unread badges.
update public.medha_communications_user_conversations set last_read_at = now();

create index if not exists medha_user_conversations_read_idx
  on public.medha_communications_user_conversations(user_id, cid, last_read_at);

-- The sidebar view carries the marker so one read answers everything.
-- Dropped first: a replace cannot reorder or insert columns.
drop view if exists public.medha_communications_my_conversations;
create view public.medha_communications_my_conversations as
  select uc.user_id,
         c.cid,
         c.id           as conversation_key,
         c.kind,
         c.title,
         c.participant_ids,
         c.last_message,
         c.updated_at,
         uc.last_read_at
  from public.medha_communications_user_conversations uc
  join public.medha_communications_conversations c on c.cid = uc.cid;

-- Verify:
--   select user_id, cid, last_read_at
--     from public.medha_communications_user_conversations order by cid;
