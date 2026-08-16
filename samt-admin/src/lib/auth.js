import { sb } from './supabase.js';

/** @typedef {{ email: string, role: string, full_name?: string, department?: string }} UserRoleRow */

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data?.session ?? null;
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await sb.auth.signOut();
}

/** نقش/دپارتمان کاربر لاگین‌شده را از جدول user_roles می‌گیرد */
export async function fetchMyRole(email) {
  const { data, error } = await sb.from('user_roles').select('*').eq('email', email).single();
  if (error) throw error;
  return /** @type {UserRoleRow} */ (data);
}

export function isStaffRole(role) {
  return ['superadmin', 'admin', 'inspector', 'viewer'].includes(role);
}
