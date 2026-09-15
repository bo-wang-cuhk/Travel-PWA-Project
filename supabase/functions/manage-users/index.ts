import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json, requiredEnv } from '../_shared/http.ts'

type Role = 'admin' | 'user'
type Status = 'active' | 'disabled'

function syntheticEmail(): string {
  return `login.${crypto.randomUUID()}@users.trek.invalid`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const url = requiredEnv('SUPABASE_URL')
    const publishableKey = requiredEnv('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY')
    const secretKey = requiredEnv('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY')
    const authorization = req.headers.get('Authorization') || ''
    const token = authorization.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const callerClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: callerData, error: callerError } = await callerClient.auth.getUser(token)
    if (callerError || !callerData.user) return json({ error: 'Unauthorized' }, 401)

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role,status')
      .eq('id', callerData.user.id)
      .maybeSingle()
    if (callerProfile?.role !== 'admin' || callerProfile?.status !== 'active') {
      return json({ error: 'Forbidden' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const action = body.action || 'list'

    if (action === 'list') {
      const { data: profiles, error } = await admin
        .from('profiles')
        .select('id,legacy_user_id,username,display_name,role,status,created_at,updated_at')
        .order('created_at', { ascending: false })
      if (error) return json({ error: error.message }, 400)
      const { data: authUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const authById = new Map((authUsers.users || []).map(user => [user.id, user]))
      return json({
        users: (profiles || []).map(profile => ({
          id: Number(profile.legacy_user_id),
          auth_id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          email: authById.get(profile.id)?.email || '',
          role: profile.role,
          status: profile.status,
          created_at: profile.created_at,
          last_login: authById.get(profile.id)?.last_sign_in_at || null,
          avatar_url: null,
        })),
      })
    }

    if (action === 'create') {
      const username = typeof body.username === 'string' ? body.username.trim() : ''
      const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const role: Role = body.role === 'admin' ? 'admin' : 'user'
      if (!username || !displayName || password.length < 6) {
        return json({ error: '用户名、显示名称和至少 6 位的初始密码为必填项' }, 400)
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: syntheticEmail(),
        password,
        email_confirm: true,
        user_metadata: { username, display_name: displayName },
      })
      if (createError || !created.user) return json({ error: createError?.message || '创建用户失败' }, 400)

      const { data: profile, error: profileError } = await admin
        .from('profiles')
        .update({ username, display_name: displayName, role, status: 'active' satisfies Status })
        .eq('id', created.user.id)
        .select('id,legacy_user_id,username,display_name,role,status,created_at')
        .single()
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: profileError.message }, 400)
      }
      return json({ user: {
        id: Number(profile.legacy_user_id), auth_id: profile.id, username: profile.username,
        display_name: profile.display_name, email: created.user.email || '', role: profile.role,
        status: profile.status, created_at: profile.created_at, last_login: null, avatar_url: null,
      } })
    }

    const legacyUserId = Number(body.id)
    if (!Number.isSafeInteger(legacyUserId)) return json({ error: 'Invalid user id' }, 400)
    const { data: target } = await admin.from('profiles').select('id').eq('legacy_user_id', legacyUserId).maybeSingle()
    if (!target) return json({ error: 'User not found' }, 404)
    if (target.id === callerData.user.id && (action === 'delete' || body.status === 'disabled')) {
      return json({ error: '管理员不能禁用或删除当前账号' }, 400)
    }

    if (action === 'update') {
      const updates: Record<string, unknown> = {}
      if (typeof body.username === 'string' && body.username.trim()) updates.username = body.username.trim()
      if (typeof body.display_name === 'string' && body.display_name.trim()) updates.display_name = body.display_name.trim()
      if (body.role === 'admin' || body.role === 'user') updates.role = body.role
      if (body.status === 'active' || body.status === 'disabled') updates.status = body.status
      if (typeof body.password === 'string' && body.password) {
        if (body.password.length < 6) return json({ error: '密码至少需要 6 位' }, 400)
        const { error } = await admin.auth.admin.updateUserById(target.id, { password: body.password })
        if (error) return json({ error: error.message }, 400)
      }
      const { data: profile, error } = await admin
        .from('profiles').update(updates).eq('id', target.id)
        .select('id,legacy_user_id,username,display_name,role,status,created_at').single()
      if (error) return json({ error: error.message }, 400)
      const { data: authUser } = await admin.auth.admin.getUserById(target.id)
      return json({ user: {
        id: Number(profile.legacy_user_id), auth_id: profile.id, username: profile.username,
        display_name: profile.display_name, email: authUser.user?.email || '', role: profile.role,
        status: profile.status, created_at: profile.created_at,
        last_login: authUser.user?.last_sign_in_at || null, avatar_url: null,
      } })
    }

    if (action === 'delete') {
      const { error } = await admin.auth.admin.deleteUser(target.id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (error) {
    console.error('[manage-users]', error)
    return json({ error: '用户管理服务暂时不可用' }, 500)
  }
})
