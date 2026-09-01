-- ============================================================
-- Medha Space — remove orphaned conversations.
--
-- SAFE TO RUN NOW. Run this in the Supabase SQL editor.
--
-- The old client generated a random UUID per conversation and sometimes
-- wrote participant_ids with only ONE member (the recipient, missing the
-- sender). Those rows are unreachable stubs: nobody can reply in them and
-- they clutter the sidebar as nameless "Conversation" entries.
--
-- This deletes direct conversations that cannot function - fewer than two
-- participants - and rebuilds membership from participant_ids so the
-- sidebar shows only real threads.
--
-- Preview first (see every row and what will happen to it):
--
--   select c.cid, c.id, c.kind, c.participant_ids,
--          (select count(*) from public.medha_communications_messages m
--            where m.cid = c.cid) as message_count,
--          (select array_agg(distinct m.sender_id)
--             from public.medha_communications_messages m
--            where m.cid = c.cid
--              and m.sender_id <> all (c.participant_ids)) as outside_senders
--   from public.medha_communications_conversations c
--   order by c.cid;
--
--   A row with one participant and exactly one outside sender is repaired.
--   A row with one participant and two or more outside senders is deleted.
--   A row with no messages is deleted. Everything else is left as it is.
-- ============================================================

begin;

-- 1. Repair one-participant threads, but ONLY when the history points to
--    exactly one other person. The old client saved just the recipient, so
--    a single distinct outside sender identifies the missing member.
--
--    If a stub somehow carries messages from more than one other person we
--    do NOT guess: merging them would build a 3-way "direct" thread and
--    show each of them the others' messages. Those are left alone for
--    step 2 to remove.
update public.medha_communications_conversations c
   set participant_ids = (
     select array_agg(distinct p order by p)
       from unnest(c.participant_ids || outside.senders) p
   )
  from (
    select m.cid, array_agg(distinct m.sender_id) as senders
      from public.medha_communications_messages m
      join public.medha_communications_conversations cc on cc.cid = m.cid
     where m.sender_id <> all (cc.participant_ids)
     group by m.cid
    having count(distinct m.sender_id) = 1
  ) outside
 where outside.cid = c.cid
   and c.kind = 'direct'
   and coalesce(array_length(c.participant_ids, 1), 0) = 1;

-- 2. Anything still holding fewer than two participants while carrying
--    messages from an outsider cannot be represented as a direct chat.
--    Delete it; messages cascade via the cid foreign key.
delete from public.medha_communications_conversations c
  where c.kind = 'direct'
    and coalesce(array_length(c.participant_ids, 1), 0) < 2
    and exists (
      select 1 from public.medha_communications_messages m
       where m.cid = c.cid and m.sender_id <> all (c.participant_ids)
    );
delete from public.medha_communications_conversations c
  where c.kind = 'direct'
    and coalesce(array_length(c.participant_ids, 1), 0) = 0;

-- 2b. A direct thread must never hold more than two people. Any such row
--     is corrupt: it would show three or more people each other's
--     messages. Flag it rather than silently reshaping it.
do $$
declare bad int;
begin
  select count(*) into bad
    from public.medha_communications_conversations
   where kind = 'direct' and array_length(participant_ids, 1) > 2;
  if bad > 0 then
    raise exception
      'Aborting: % direct conversation(s) have more than 2 participants. Inspect them before continuing.', bad;
  end if;
end $$;

-- 3. Clear membership rows whose conversation is gone, or whose user is no
--    longer a participant.
delete from public.medha_communications_user_conversations uc
  where not exists (
    select 1 from public.medha_communications_conversations c
     where c.cid = uc.cid
       and uc.user_id = any (c.participant_ids)
  );

-- 4. Make sure every participant has a membership row.
insert into public.medha_communications_user_conversations(user_id, cid)
  select distinct participant, c.cid
    from public.medha_communications_conversations c
    cross join lateral unnest(c.participant_ids) participant
   where participant is not null and participant <> ''
  on conflict do nothing;

-- 5. Drop messages that lost their conversation.
delete from public.medha_communications_messages m
  where not exists (
    select 1 from public.medha_communications_conversations c where c.cid = m.cid
  );

-- 6. Refresh each thread's preview from its newest message, so the sidebar
--    text matches what is actually in the thread.
update public.medha_communications_conversations c
   set last_message = coalesce(latest.body, ''),
       updated_at   = coalesce(latest.created_at, c.updated_at)
  from (
    select distinct on (cid) cid, body, created_at
      from public.medha_communications_messages
     order by cid, created_at desc, id desc
  ) latest
 where latest.cid = c.cid;

-- 7. A direct thread with no messages was never actually started.
delete from public.medha_communications_conversations c
  where c.kind = 'direct'
    and not exists (
      select 1 from public.medha_communications_messages m where m.cid = c.cid
    );

-- 8. Stop the whole class of problem at the database level: a direct
--    conversation must have exactly two distinct participants (or one, for
--    a self-chat). This makes a 3-way "direct" thread impossible, so no
--    future bug can leak one person's messages into another's chat.
alter table public.medha_communications_conversations
  drop constraint if exists medha_direct_pair_only;
alter table public.medha_communications_conversations
  add constraint medha_direct_pair_only check (
    kind <> 'direct' or coalesce(array_length(participant_ids, 1), 0) between 1 and 2
  );

commit;

-- Verify: every remaining direct thread has 2+ participants and messages.
--   select c.cid, c.id, c.participant_ids, c.last_message,
--          (select count(*) from public.medha_communications_messages m
--            where m.cid = c.cid) as message_count
--   from public.medha_communications_conversations c
--   order by c.updated_at desc;
