-- تست دسترسی (RLS) مسیرهای نوشتن مسئول فنی، با نقش واقعی کاربر و داخل تراکنشی که آخرش برگردانده می‌شود.
-- اجرا:
--   psql "$DB_URL" -v officer='ایمیل مسئول فنی' -v mine='نام معدن اختصاص‌یافته‌اش' -f supabase/tests/rls_tech_officer.sql
-- هر شکستی باعث خروج با خطا می‌شود. هیچ داده‌ای باقی نمی‌ماند.
\set ON_ERROR_STOP on
select set_config('test.officer', :'officer', false), set_config('test.mine', :'mine', false) \gset

begin;
do $$
declare
  em text := current_setting('test.officer');
  mn text := current_setting('test.mine');
  rep text := ''; fails int := 0;
  stmts text[]; s text;
begin
  stmts := array[
    format($f$insert into incident_reports(mine_name, submitted_by) values (%L,%L)$f$, mn, em),
    format($f$insert into corrective_actions(mine_name, department, submitted_by, description) values (%L,'معدن',%L,'t')$f$, mn, em),
    format($f$insert into safety_checklists(mine_name, department, submitted_by) values (%L,'معدن',%L)$f$, mn, em),
    format($f$insert into mine_equipment(mine_name, submitted_by) values (%L,%L)$f$, mn, em),
    format($f$insert into mine_personnel(mine_name, department, submitted_by, full_name) values (%L,'معدن',%L,'t')$f$, mn, em),
    format($f$insert into safety_trainings(mine_name, department, submitted_by, topic) values (%L,'معدن',%L,'t')$f$, mn, em),
    format($f$insert into tech_reports(mine_name, submitted_by) values (%L,%L)$f$, mn, em),
    format($f$insert into quarterly_maps(mine_name, department, submitted_by, period, file_url) values (%L,'معدن',%L,'p','u')$f$, mn, em),
    format($f$insert into qr_checkins(mine_name) values (%L)$f$, mn),
    format($f$insert into mine_presence_events(email, mine_name, department, event_type) values (%L,%L,'معدن','enter')$f$, em, mn),
    format($f$insert into production_reports(mine_name, department, submitted_by, period) values (%L,'معدن',%L,'p')$f$, mn, em),
    format($f$insert into safety_checkins(email, mine_name, department, next_due_at) values (%L,%L,'معدن', now())$f$, em, mn),
    format($f$insert into exploration_boreholes(mine_name) values (%L)$f$, mn),
    format($f$insert into exploration_core_boxes(mine_name, borehole_no, photo_url, submitted_by) values (%L,'b','u',%L)$f$, mn, em),
    format($f$insert into exploration_progress_reports(mine_name, submitted_by, period) values (%L,%L,'p')$f$, mn, em),
    format($f$insert into exploration_sample_custody(mine_name, sample_code, collected_by) values (%L,'c',%L)$f$, mn, em),
    format($f$insert into exploration_site_photos(mine_name, photo_url, submitted_by) values (%L,'u',%L)$f$, mn, em),
    format($f$insert into exploration_strike_dip(mine_name, strike_deg, dip_deg, measured_by) values (%L,10,20,%L)$f$, mn, em),
    format($f$insert into exploration_traverses(mine_name, points, started_by) values (%L,'[]'::jsonb,%L)$f$, mn, em),
    format($f$insert into processing_reports(mine_name, submitted_by, period) values (%L,%L,'p')$f$, mn, em),
    format($f$insert into processing_consumption(mine_name, submitted_by, period) values (%L,%L,'p')$f$, mn, em),
    format($f$insert into processing_site_photos(mine_name, location_type, photo_url, submitted_by) values (%L,'کارخانه','u',%L)$f$, mn, em),
    format($f$insert into processing_stockpile_photos(mine_name, stockpile_type, photo_url, submitted_by) values (%L,'raw_material','u',%L)$f$, mn, em),
    format($f$insert into processing_tailings_dam(mine_name, submitted_by, period) values (%L,%L,'p')$f$, mn, em),
    $f$insert into storage.objects(bucket_id, name) values ('tech-reports','__t/a.txt')$f$,
    $f$insert into storage.objects(bucket_id, name) values ('incident-photos','__t/a.jpg')$f$,
    format($f$insert into storage.objects(bucket_id, name) values ('identity-photos', %L)$f$, em || '/__t.jpg'),
    format($f$insert into client_errors(email, app, context, message) values (%L,'tech','test','m')$f$, em)
  ];
  perform set_config('request.jwt.claims', json_build_object('email', em, 'role', 'authenticated', 'sub', '00000000-0000-0000-0000-000000000000')::text, true);
  set local role authenticated;
  foreach s in array stmts loop
    begin
      execute s;
      rep := rep || 'OK   | ' || left(s, 70) || E'\n';
    exception when others then
      fails := fails + 1;
      rep := rep || 'FAIL | ' || left(s, 70) || ' => ' || sqlerrm || E'\n';
    end;
  end loop;
  reset role;
  raise notice E'\n%', rep;
  if fails > 0 then raise exception 'RLS test failed: % statement(s)', fails; end if;
end $$;
rollback;
