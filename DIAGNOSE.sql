-- ============================================================
-- Run this whole file in the Supabase SQL editor and send me the output.
-- It reports which of the notification steps is actually failing.
-- ============================================================

-- 1. WHICH TRIGGER IS INSTALLED?
--    Look for 'space-push' in the body. If you see
--    'medha_notification_events' instead, the new SQL was never run.
select
  case
    when prosrc like '%api/space-push%'            then 'NEW - sends direct, stores nothing'
    when prosrc like '%medha_notification_events%' then 'OLD - still storing rows'
    else 'UNKNOWN'
  end as installed_trigger_version
from pg_proc
where proname = 'medha_communications_message_notification_trigger';

-- 2. IS THE TRIGGER ACTUALLY ATTACHED TO THE MESSAGES TABLE?
select tgname, tgenabled   -- tgenabled must be 'O'
  from pg_trigger
 where tgrelid = 'public.medha_communications_messages'::regclass
   and not tgisinternal;

-- 3. IS pg_net INSTALLED?  Without it the trigger cannot call out at all.
select extname, extversion from pg_extension where extname = 'pg_net';

-- 4. DOES ANYONE HAVE A PUSH SUBSCRIPTION?
--    THIS IS THE MOST COMMON CAUSE. Zero rows = nothing can ever be
--    delivered, no matter what the trigger does. Each person must open
--    Medha Hub, install it to the home screen, and allow notifications.
select user_uid, count(*) as devices
  from public.medha_push_subscriptions
 group by user_uid;

-- 5. HAS ANYONE TURNED SPACE MESSAGES OFF?
select user_uid, event_type, enabled
  from public.medha_notification_preferences
 where event_type = 'space_message';

-- 6. WHAT HAPPENED TO THE LAST 10 OUTBOUND CALLS?
--    status_code 200 = delivered to the endpoint.
--    404 = /api/space-push not deployed. error_msg = network/DNS problem.
select id, status_code, left(coalesce(error_msg, content::text), 160) as result, created
  from net._http_response
 order by created desc
 limit 10;

-- 7. ARE SPACE NOTIFICATIONS STILL BEING STORED?  Should be 0.
select count(*) as stored_space_notifications
  from public.medha_notification_events
 where event_type = 'space_message';
