import type { SupabaseClient } from '@supabase/supabase-js'
import type { Member } from './types'

export type Membership = { userId: string; householdId: string; members: Member[] }

export type MemberRow = { household_id: string; user_id: string; display_name: string; spouse_role: string | null }

// 본인 행이 없으면 가구가 없는 것이다.
export function toMembership(userId: string, rows: MemberRow[]): Membership | null {
  const mine = rows.find((r) => r.user_id === userId)
  if (!mine) return null
  const members = rows
    .filter((r) => r.household_id === mine.household_id)
    .map((r): Member => ({
      userId: r.user_id,
      displayName: r.display_name,
      spouseRole: r.spouse_role === 'husband' || r.spouse_role === 'wife' ? r.spouse_role : null,
    }))
  return { userId, householdId: mine.household_id, members }
}

export async function loadMembership(client: SupabaseClient): Promise<Membership | null> {
  const { data: auth } = await client.auth.getUser()
  const userId = auth.user?.id
  if (!userId) return null
  const { data, error } = await client.from('members').select('household_id, user_id, display_name, spouse_role')
  if (error) throw error
  return toMembership(userId, (data ?? []) as MemberRow[])
}

export function loginErrorMessage(code: string | undefined): string {
  if (code === 'invalid_credentials') return '이메일이나 비밀번호가 맞지 않아요.'
  return '지금 로그인할 수 없어요. 잠시 뒤 다시 해 주세요.'
}
