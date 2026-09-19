import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json, requiredEnv } from '../_shared/http.ts'

type Profile = {
  id: string
  legacy_user_id: number
  username: string
  display_name: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
}

type Membership = { user_id: string; role: 'owner' | 'admin' | 'member'; created_at: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const url = requiredEnv('SUPABASE_URL')
    const publishableKey = requiredEnv('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY')
    const secretKey = requiredEnv('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY')
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const callerClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: callerData, error: callerError } = await callerClient.auth.getUser(token)
    if (callerError || !callerData.user) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const callerId = callerData.user.id
    const { data: callerProfile, error: callerProfileError } = await admin
      .from('profiles').select('status').eq('id', callerId).maybeSingle()
    if (callerProfileError || callerProfile?.status !== 'active') return json({ error: 'Forbidden' }, 403)
    const body = await req.json().catch(() => ({}))
    const action = typeof body.action === 'string' ? body.action : 'context'

    const { data: ownedWorkspaces, error: ownedError } = await admin
      .from('workspaces')
      .select('id,kind,name,owner_id,created_at')
      .eq('owner_id', callerId)
      .order('created_at', { ascending: true })
    if (ownedError) return json({ error: ownedError.message }, 400)

    const { data: memberships, error: membershipError } = await admin
      .from('workspace_members')
      .select('workspace_id,role,created_at,workspaces!inner(id,kind,name,owner_id,created_at)')
      .eq('user_id', callerId)
    if (membershipError) return json({ error: membershipError.message }, 400)

    const joined = (memberships || []).map((row: Record<string, unknown>) => row.workspaces as Record<string, unknown>)
    const workspace =
      joined.find(row => row.kind === 'shared') ||
      (ownedWorkspaces || []).find(row => row.kind === 'personal') ||
      joined[0]
    if (!workspace) return json({ error: 'Workspace not found' }, 404)

    const workspaceId = String(workspace.id)
    const { data: callerMembership } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', callerId)
      .maybeSingle()
    const canManage = workspace.owner_id === callerId || callerMembership?.role === 'owner' || callerMembership?.role === 'admin'

    if (action === 'add') {
      if (!canManage) return json({ error: 'Forbidden' }, 403)
      const targetLegacyId = Number(body.user_id)
      if (!Number.isSafeInteger(targetLegacyId)) return json({ error: 'Invalid user' }, 400)
      const { data: target } = await admin
        .from('profiles')
        .select('id,status')
        .eq('legacy_user_id', targetLegacyId)
        .maybeSingle()
      if (!target || target.status !== 'active') return json({ error: 'User not found' }, 404)
      if (target.id === callerId) return json({ error: 'Cannot add the current user' }, 400)
      const { data: targetShared, error: targetSharedError } = await admin
        .from('workspace_members')
        .select('workspace_id,workspaces!inner(kind)')
        .eq('user_id', target.id)
        .eq('workspaces.kind', 'shared')
      if (targetSharedError) return json({ error: targetSharedError.message }, 400)
      if (targetShared?.some(row => row.workspace_id !== workspaceId)) {
        return json({ error: 'User already belongs to another shared workspace' }, 409)
      }

      if (workspace.kind === 'personal') {
        const { error } = await admin
          .from('workspaces')
          .update({ kind: 'shared', name: `${workspace.name || 'TREK'} · 共享空间` })
          .eq('id', workspaceId)
          .eq('owner_id', callerId)
        if (error) return json({ error: error.message }, 400)
        workspace.kind = 'shared'
      }

      const { error } = await admin.from('workspace_members').upsert({
        workspace_id: workspaceId,
        user_id: target.id,
        role: 'member',
      }, { onConflict: 'workspace_id,user_id', ignoreDuplicates: true })
      if (error) return json({ error: error.message }, 400)
    } else if (action === 'remove') {
      if (!canManage) return json({ error: 'Forbidden' }, 403)
      const targetLegacyId = Number(body.user_id)
      const { data: target } = await admin.from('profiles').select('id').eq('legacy_user_id', targetLegacyId).maybeSingle()
      if (!target) return json({ error: 'User not found' }, 404)
      if (target.id === workspace.owner_id) return json({ error: 'The workspace owner cannot be removed' }, 400)
      const { error } = await admin.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', target.id)
      if (error) return json({ error: error.message }, 400)
    } else if (action !== 'context') {
      return json({ error: 'Unknown action' }, 400)
    }

    const [{ data: memberRows, error: membersError }, { data: profiles, error: profilesError }, { data: sharedMembers, error: sharedError }] = await Promise.all([
      admin.from('workspace_members').select('user_id,role,created_at').eq('workspace_id', workspaceId),
      admin.from('profiles').select('id,legacy_user_id,username,display_name,role,status').eq('status', 'active').order('username'),
      admin.from('workspace_members').select('user_id,workspaces!inner(kind)').eq('workspaces.kind', 'shared'),
    ])
    if (membersError || profilesError || sharedError) return json({ error: membersError?.message || profilesError?.message || sharedError?.message }, 400)

    const profilesById = new Map((profiles as Profile[] || []).map(profile => [profile.id, profile]))
    const members = (memberRows as Membership[] || []).flatMap(membership => {
      const profile = profilesById.get(membership.user_id)
      return profile ? [{
        id: profile.legacy_user_id,
        auth_id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        role: membership.role,
        added_at: membership.created_at,
      }] : []
    })
    const memberIds = new Set((memberRows as Membership[] || []).map(row => row.user_id))
    const sharedMemberIds = new Set((sharedMembers || []).map(row => row.user_id))
    const candidates = canManage ? (profiles as Profile[] || [])
      .filter(profile => profile.id !== callerId && !memberIds.has(profile.id) && !sharedMemberIds.has(profile.id))
      .map(profile => ({
        id: profile.legacy_user_id,
        auth_id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
      })) : []

    return json({
      workspace: { id: workspaceId, kind: workspace.kind, name: workspace.name, owner_id: workspace.owner_id },
      can_manage: canManage,
      members,
      candidates,
    })
  } catch (error) {
    console.error('[workspace-members]', error)
    return json({ error: '共享空间成员服务暂时不可用' }, 500)
  }
})
