import { createClient } from '@supabase/supabase-js'
import { authConfigured, supabaseAnonKey, supabaseUrl } from './config.js'

// Used for sign-in only. All data goes through the FastAPI server, which
// forwards the user's token so the database's row level security applies.
// Null when no anon key is configured: the sign-in pages then say so.
export const supabase = authConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null
