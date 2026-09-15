import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.SUPABASE_URL?.trim() || ''
const supabasePublishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY?.trim() || ''

export const SUPABASE_AUTH_ENABLED = Boolean(supabaseUrl && supabasePublishableKey)

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!SUPABASE_AUTH_ENABLED) {
    throw new Error('Supabase Auth is not configured')
  }
  if (!client) {
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}

export function getSupabasePublicConfig(): { url: string; publishableKey: string } {
  if (!SUPABASE_AUTH_ENABLED) throw new Error('Supabase Auth is not configured')
  return { url: supabaseUrl, publishableKey: supabasePublishableKey }
}
