-- تست محافظت از جدول user_roles (فهرست سفید ستون‌های قابل‌ویرایش توسط خود کاربر).
-- اجرا: psql "$DB_URL" -v officer='ایمیل یک مسئول فنی تاییدشده' -f supabase/tests/rls_user_roles.sql
\set ON_ERROR_STOP on
select set_config('test.officer', :'officer', false) \gset

begin;
do $$
declare
  em text := current_setting('test.officer');
  rep text := ''; fails int := 0;

  procedure_unused int;
begin
  -- کاربر تازه (pending) که ثبت‌نام می‌کند
  insert into user_roles(email, role) values ('zz-regtest@example.com','pending');
  perform set_config('request.jwt.claims', '{"email":"zz-regtest@example.com","role":"authenticated","sub":"00000000-0000-0000-0000-0000000000aa"}', true);
  set local role authenticated;

  begin
    update user_roles set full_name='t', phone='1', national_code='1', membership_no='1', license_no='1', requested_mine_name='x', contract_no='1', tech_officer_specialty='اکتشاف', department='اکتشاف', preferred_messenger='telegram', messenger_chat_id='1', membership_verified=true where email='zz-regtest@example.com';
    rep := rep || E'OK   | pending user can complete registration\n';
  exception when others then fails := fails + 1; rep := rep || 'FAIL | pending registration => ' || sqlerrm || E'\n'; end;

  begin
    update user_roles set role='admin' where email='zz-regtest@example.com';
    fails := fails + 1; rep := rep || E'FAIL | pending user promoted himself to admin\n';
  exception when others then rep := rep || E'OK   | pending user cannot change role\n'; end;

  begin
    update user_roles set assigned_mines='["x"]'::jsonb where email='zz-regtest@example.com';
    fails := fails + 1; rep := rep || E'FAIL | user assigned mines to himself\n';
  exception when others then rep := rep || E'OK   | user cannot assign mines\n'; end;
  reset role;

  -- مسئول فنی تاییدشده
  perform set_config('request.jwt.claims', json_build_object('email', em, 'role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000000000')::text, true);
  set local role authenticated;

  begin
    update user_roles set full_name=full_name, membership_no=membership_no, phone=phone, push_fcm_token='abc', push_login_enabled=true where email=em;
    rep := rep || E'OK   | approved officer can edit profile/push settings\n';
  exception when others then fails := fails + 1; rep := rep || 'FAIL | approved officer profile => ' || sqlerrm || E'\n'; end;

  begin
    update user_roles set identity_boundary_exempt = true where email=em;
    fails := fails + 1; rep := rep || E'FAIL | officer exempted himself from boundary check\n';
  exception when others then rep := rep || E'OK   | officer cannot set boundary exemption\n'; end;

  begin
    update user_roles set identity_status = 'rejected' where email=em;
    fails := fails + 1; rep := rep || E'FAIL | officer changed own identity status\n';
  exception when others then rep := rep || E'OK   | officer cannot change identity status\n'; end;

  begin
    update user_roles set department = 'اکتشاف' where email=em;
    fails := fails + 1; rep := rep || E'FAIL | approved officer changed department\n';
  exception when others then rep := rep || E'OK   | approved officer cannot change department\n'; end;
  reset role;

  raise notice E'\n%', rep;
  if fails > 0 then raise exception 'user_roles test failed: % check(s)', fails; end if;
end $$;
rollback;
