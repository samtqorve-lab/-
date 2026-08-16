import { createClient } from '@supabase/supabase-js';

// این مقادیر باید در فایل .env (کپی از .env.example) قرار بگیرند — هرگز مستقیم اینجا هاردکد نشوند.
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPA_URL || !SUPA_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error('متغیرهای محیطی Supabase تنظیم نشده‌اند — فایل .env.example را به .env کپی کنید.');
}

export const sb = createClient(SUPA_URL, SUPA_ANON_KEY);
