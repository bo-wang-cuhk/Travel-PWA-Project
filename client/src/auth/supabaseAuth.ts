import type { User } from '../types'
import { getSupabaseClient, getSupabasePublicConfig } from './supabaseClient'

interface ProfileRow {
  id: string
  legacy_user_id: number
  username: string
  display_name: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  created_at: string
}

async function readCurrentProfile(): Promise<User> {
  const supabase = getSupabaseClient()
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session) throw new Error('登录状态已失效')

  const { data, error } = await supabase
    .from('profiles')
    .select('id,legacy_user_id,username,display_name,role,status,created_at')
    .eq('id', sessionData.session.user.id)
    .single<ProfileRow>()
  if (error || !data) throw new Error(error?.message || '用户资料不存在')
  if (data.status !== 'active') {
    await supabase.auth.signOut()
    throw new Error('账号已被禁用')
  }

  return {
    id: Number(data.legacy_user_id),
    auth_id: data.id,
    username: data.username,
    display_name: data.display_name,
    email: sessionData.session.user.email || '',
    role: data.role,
    status: data.status,
    avatar_url: null,
    maps_api_key: null,
    created_at: data.created_at,
    mfa_enabled: false,
    must_change_password: false,
  }
}

export async function loginWithUsername(username: string, password: string): Promise<{ user: User; token: string }> {
  const { url, publishableKey } = getSupabasePublicConfig()
  const response = await fetch(`${url}/functions/v1/login-by-username`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password }),
  })
  const body = await response.json().catch(() => ({})) as {
    access_token?: string
    refresh_token?: string
    error?: string
  }
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new Error(body.error || '用户名或密码错误')
  }

  const supabase = getSupabaseClient()
  const { error } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  })
  if (error) throw error
  const user = await readCurrentProfile()
  return { user, token: body.access_token }
}

export async function loadSupabaseUser(): Promise<User> {
  return readCurrentProfile()
}

export async function logoutSupabase(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut()
  if (error) throw error
}
