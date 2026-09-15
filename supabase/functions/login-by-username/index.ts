import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json, requiredEnv } from '../_shared/http.ts'

const genericLoginError = '用户名或密码错误'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { username, password } = await req.json()
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return json({ error: genericLoginError }, 400)
    }

    const url = requiredEnv('SUPABASE_URL')
    const publishableKey = requiredEnv('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY')
    const secretKey = requiredEnv('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY')
    const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id,status')
      .ilike('username', username.trim())
      .maybeSingle()
    if (profileError || !profile || profile.status !== 'active') {
      return json({ error: genericLoginError }, 400)
    }

    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(profile.id)
    const email = authUser.user?.email
    if (authUserError || !email) return json({ error: genericLoginError }, 400)

    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) return json({ error: genericLoginError }, 400)

    const session = await response.json()
    return json({ access_token: session.access_token, refresh_token: session.refresh_token })
  } catch (error) {
    console.error('[login-by-username]', error)
    return json({ error: '登录服务暂时不可用' }, 500)
  }
})
