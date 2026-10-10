import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
export type Rel = { id: string; status: string; recipient_user_id: string | null };
export type Msg = { id: string; title: string | null; body: string; category: string; status: string; relationship_id: string };
