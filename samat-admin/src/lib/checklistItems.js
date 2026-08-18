import { sb } from './supabase.js';

export const OFFICER_ROLE_TABS = [
  { role: 'tech_officer', label: '🦺 مسئول فنی', color: '#1565c0' },
  { role: 'safety_officer', label: '🦺 مسئول ایمنی', color: '#b71c1c' },
  { role: 'health_officer', label: '⚕️ بهداشت حرفه‌ای', color: '#2e7d32' },
  { role: 'owner', label: '🏗 بهره‌بردار', color: '#8d6e63' },
];

export async function fetchChecklistItems(department, role) {
  const { data, error } = await sb.from('safety_checklist_items').select('*').eq('department', department).eq('role', role).order('sort_order');
  if (error) throw error;
  return data || [];
}

export async function addChecklistItem(department, role, text, requiresPhoto, currentItems) {
  const maxOrder = currentItems.reduce((m, it) => Math.max(m, it.sort_order || 0), 0);
  const { error } = await sb.from('safety_checklist_items').insert([{
    department, role, item_text: text, sort_order: maxOrder + 1, active: true, requires_photo: requiresPhoto,
  }]);
  if (error) throw error;
}

export async function updateChecklistItem(id, patch) {
  const { error } = await sb.from('safety_checklist_items').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteChecklistItem(id) {
  const { error } = await sb.from('safety_checklist_items').delete().eq('id', id);
  if (error) throw error;
}

export async function moveChecklistItem(items, id, dir) {
  const idx = items.findIndex((it) => it.id === id);
  const swapIdx = idx + dir;
  if (idx === -1 || swapIdx < 0 || swapIdx >= items.length) return;
  const a = items[idx];
  const b = items[swapIdx];
  await Promise.all([
    sb.from('safety_checklist_items').update({ sort_order: b.sort_order }).eq('id', a.id),
    sb.from('safety_checklist_items').update({ sort_order: a.sort_order }).eq('id', b.id),
  ]);
}
