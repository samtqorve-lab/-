-- ثبت احراز هویت مسئول فنی (وضعیت نهایی بعد از بازبینی ۱۳ مهر ۱۴۰۵)

-- مسئول فنیِ «معاف از محدوده» (فقط با تایید سوپرادمین) از چک محدوده‌ی سرور هم رد می‌شود و
-- inside_boundary مقدار واقعیِ چک سرور را ذخیره می‌کند. پرچم app.identity_submit_in_progress فقط برای
-- همین تراکنش است و تریگر محافظ user_roles به‌خاطر آن اجازه‌ی تغییر وضعیت به «pending» را می‌دهد.
CREATE OR REPLACE FUNCTION public.submit_identity_verification(mine_name_in text, kind_in text, photo_url_in text, lat_in double precision, lon_in double precision, inside_boundary_in boolean, device_id_in text, credential_id_in text DEFAULT NULL::text, public_key_in text DEFAULT NULL::text, credential_counter_in bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  my_email text := auth.jwt()->>'email';
  my_role text; my_dept text; assigned jsonb; new_id bigint; computed_inside boolean; is_exempt boolean;
begin
  select role, department, assigned_mines, coalesce(identity_boundary_exempt, false)
    into my_role, my_dept, assigned, is_exempt
  from user_roles where email = my_email;
  if my_role is distinct from 'tech_officer' then raise exception 'دسترسی ندارید'; end if;
  if assigned is null or not (assigned @> to_jsonb(mine_name_in)) then raise exception 'شما مسئول فنی این معدن نیستید'; end if;
  if kind_in not in ('initial','monthly') then raise exception 'نوع نامعتبر'; end if;
  if lat_in is null or lon_in is null then raise exception 'موقعیت مکانی نامعتبر است'; end if;

  computed_inside := coalesce(private.mine_name_contains_point(my_dept, mine_name_in, lat_in, lon_in), false);
  if not computed_inside and not is_exempt then
    raise exception 'عکس باید داخل محدوده قانونی معدن گرفته شود (بررسی موقعیت مکانی توسط سرور تایید نشد)';
  end if;

  insert into identity_verifications(email, full_name, membership_no, mine_name, department, kind, photo_url, device_id, lat, lon, inside_boundary, status, credential_id, public_key, credential_counter)
  select my_email, ur.full_name, ur.membership_no, mine_name_in, my_dept, kind_in, photo_url_in, device_id_in, lat_in, lon_in, computed_inside, 'pending', credential_id_in, public_key_in, credential_counter_in
  from user_roles ur where ur.email = my_email
  returning id into new_id;

  perform set_config('app.identity_submit_in_progress', '1', true);
  update user_roles set identity_status = 'pending' where email = my_email;
  perform set_config('app.identity_submit_in_progress', '', true);
  return new_id;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.submit_identity_verification(text, text, text, double precision, double precision, boolean, text, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_identity_verification(text, text, text, double precision, double precision, boolean, text, text, text, bigint) TO authenticated;

-- فقط عکس‌های «یتیم» (بدون ردیف در identity_verifications) را صاحبشان می‌تواند پاک کند
DROP POLICY IF EXISTS identity_photos_delete_orphan_own ON storage.objects;
CREATE POLICY identity_photos_delete_orphan_own ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'identity-photos'
  AND lower((storage.foldername(name))[1]) = lower(auth.jwt() ->> 'email')
  AND NOT EXISTS (SELECT 1 FROM public.identity_verifications v WHERE v.photo_url = storage.objects.name)
);

-- عکس‌های حادثه/یادداشت صوتی: مسئول ایمنی و بهداشت هم (مثل مسئول فنی) اجازه‌ی آپلود دارند
DROP POLICY IF EXISTS incident_photos_upload ON storage.objects;
CREATE POLICY incident_photos_upload ON storage.objects FOR INSERT TO public
WITH CHECK (
  bucket_id = 'incident-photos'
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.email = (auth.jwt() ->> 'email')
      AND user_roles.role = ANY (ARRAY['admin','superadmin','inspector','tech_officer','safety_officer','health_officer'])
  )
);
