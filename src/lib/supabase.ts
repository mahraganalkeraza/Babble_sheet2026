import { createClient } from '@supabase/supabase-js';

let supabaseInstance: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase configuration (VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY) is missing. Real database queries will fail until configured.');
    return null;
  }

  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  return supabaseInstance;
}
