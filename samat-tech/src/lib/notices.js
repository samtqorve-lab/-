import { sb } from './supabase.js';

/** اطلاعیه‌های فعالِ مربوط به این کاربر: یا مخصوص یکی از معادنش، یا عمومیِ همان بخش (mine_name=null) */
export async function fetchNoticesForUser(department) {
  const { data, error } = await sb.from('notices').select('*').eq('department', department).eq('active', true).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
