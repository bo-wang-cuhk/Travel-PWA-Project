import { getSupabaseClient } from './supabaseClient'

export interface WorkspacePerson {
  id: number
  auth_id: string
  username: string
  display_name: string
  role?: 'owner' | 'admin' | 'member'
  added_at?: string
}

export interface WorkspaceContext {
  workspace: { id: string; kind: 'personal' | 'shared'; name: string; owner_id: string }
  can_manage: boolean
  members: WorkspacePerson[]
  candidates: WorkspacePerson[]
}

async function invoke(body: Record<string, unknown>): Promise<WorkspaceContext> {
  const { data, error } = await getSupabaseClient().functions.invoke('workspace-members', { body })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data as WorkspaceContext
}

export const workspaceMembersApi = {
  context: () => invoke({ action: 'context' }),
  add: (userId: number) => invoke({ action: 'add', user_id: userId }),
  remove: (userId: number) => invoke({ action: 'remove', user_id: userId }),
}
