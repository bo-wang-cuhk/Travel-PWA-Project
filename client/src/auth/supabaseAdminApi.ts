import { getSupabaseClient } from './supabaseClient'

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseClient().functions.invoke('manage-users', { body })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data as T
}

export const supabaseAdminApi = {
  users: () => invoke<{ users: unknown[] }>({ action: 'list' }),
  createUser: (data: Record<string, unknown>) => invoke<{ user: unknown }>({ action: 'create', ...data }),
  updateUser: (id: number, data: Record<string, unknown>) => invoke<{ user: unknown }>({ action: 'update', id, ...data }),
  deleteUser: (id: number) => invoke<{ ok: true }>({ action: 'delete', id }),
}
