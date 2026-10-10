-- Synthetic dev data only. Messages need a real relationship; run after pairing in a DEV project:
-- insert into messages(relationship_id,created_by,body,category)
-- select id,admin_user_id,b,c from relationships, (values
--  ('A little reminder that someone is cheering for you.','romance'),
--  ('You''ve done enough for this moment. Take a breath.','self_care'),
--  ('One step at a time. You don''t have to do everything at once.','encouragement')) v(b,c) limit 3;
select 1;
