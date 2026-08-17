import { sb } from './supabase.js';

export async function fetchNotices(department) {
  const { data, error } = await sb.from('notices').select('*').eq('department', department).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createNotice(department, title, body, mineName) {
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('notices').insert([{
    department, title, body, mine_name: mineName || null, created_by: user ? user.email : '',
  }]);
  if (error) throw error;
}

export async function updateNotice(id, patch) {
  const { error } = await sb.from('notices').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteNotice(id) {
  const { error } = await sb.from('notices').delete().eq('id', id);
  if (error) throw error;
}
