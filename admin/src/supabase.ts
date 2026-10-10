import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseUrl) {
  throw new Error('VITE_SUPABASE_URL environment variable is required.');
}
if (!supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_ANON_KEY environment variable is required.');
}
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export type Rel = { id: string; status: string; recipient_user_id: string | null };
export type Msg = { id: string; title: string | null; body: string; category: string; status: string; relationship_id: string };
