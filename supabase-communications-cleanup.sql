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
-- Preview first (see exactly what will go):
--
--   select c.cid, c.id, c.participant_ids,
--          (select count(*) from public.medha_communications_messages m
--            where m.cid = c.cid) as message_count
--   from public.medha_communications_conversations c
--   where c.kind = 'direct'
--     and coalesce(array_length(c.participant_ids, 1), 0) < 2;
-- ============================================================

begin;

-- 1. Repair one-participant threads where the history shows who the other
--    person is: the old client saved only the recipient, so a message from
--    anyone else identifies the missing member. Fix these instead of
--    deleting them, so real history is never lost.
update public.medha_communications_conversations c
   set participant_ids = (
     select array_agg(distinct p order by p)
       from unnest(c.participant_ids || array_agg_senders.senders) p
   )
  from (
    select m.cid, array_agg(distinct m.sender_id) as senders
      from public.medha_communications_messages m
     group by m.cid
  ) array_agg_senders
 where array_agg_senders.cid = c.cid
   and c.kind = 'direct'
   and coalesce(array_length(c.participant_ids, 1), 0) < 2
   and not (array_agg_senders.senders <@ c.participant_ids);

-- 2. Whatever is still a one-participant direct thread is either a
--    deliberate self-chat (its only sender is that same person) or an
--    unusable stub. Delete only the stubs; messages cascade via cid.
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

commit;

-- Verify: every remaining direct thread has 2+ participants and messages.
--   select c.cid, c.id, c.participant_ids, c.last_message,
--          (select count(*) from public.medha_communications_messages m
--            where m.cid = c.cid) as message_count
--   from public.medha_communications_conversations c
--   order by c.updated_at desc;
