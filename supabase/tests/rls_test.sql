-- pgTAP test file for Supabase CLI (supabase test db)
begin;
select plan(7);

-- 1. Check tables exist
select has_table('profiles', 'profiles table should exist');
select has_table('relationships', 'relationships table should exist');
select has_table('messages', 'messages table should exist');
select has_table('schedules', 'schedules table should exist');
select has_table('inbox_items', 'inbox_items table should exist');
select has_table('preferences', 'preferences table should exist');
select has_table('deletion_requests', 'deletion_requests table should exist');

select * from finish();
rollback;
