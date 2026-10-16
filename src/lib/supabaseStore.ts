import type { SupabaseClient } from '@supabase/supabase-js'
import type { Category } from './categories'
import type { ListStore } from './store'
import type { Membership } from './session'
import type { Item } from './types'

type Row = {
  id: string
  household_id: string
  name: string
  spec: string | null
  count: number
  category: string
  product_key: string | null
  added_by: string | null
  added_at: string
  bought_by: string | null
  bought_at: string | null
  paid: number | null
}

export function rowToItem(r: Row): Item {
  return {
    id: r.id,
    householdId: r.household_id,
    name: r.name,
    spec: r.spec,
    count: r.count,
    category: r.category as Category,
    productKey: r.product_key,
    addedBy: r.added_by,
    addedAt: r.added_at,
    boughtBy: r.bought_by,
    boughtAt: r.bought_at,
    paid: r.paid,
  }
}

// grocery.items 저장소. 서버 오류는 던진다(호출하는 쪽이 오류 상태를 보여 준다).
export function createSupabaseStore(client: SupabaseClient, me: Membership): ListStore {
  const table = () => client.schema('grocery').from('items')

  return {
    async list() {
      const { data, error } = await table()
        .select('*')
        .eq('household_id', me.householdId)
        .order('added_at', { ascending: true })
      if (error) throw error
      return ((data ?? []) as Row[]).map(rowToItem)
    },
    async add(items) {
      if (items.length === 0) return
      // added_by는 보내지 않는다: DB 기본값(auth.uid())이 채우고 RLS가 확인한다.
      const rows = items.map((p) => ({
        household_id: me.householdId,
        name: p.name,
        spec: p.spec,
        count: p.count,
        category: p.category,
      }))
      const { error } = await table().insert(rows)
      if (error) throw error
    },
    async setBought(id, bought) {
      const patch = bought
        ? { bought_by: me.userId, bought_at: new Date().toISOString() }
        : { bought_by: null, bought_at: null, paid: null }
      const { error } = await table().update(patch).eq('id', id).eq('household_id', me.householdId)
      if (error) throw error
    },
    async remove(id) {
      const { error } = await table().delete().eq('id', id).eq('household_id', me.householdId)
      if (error) throw error
    },
    subscribe(onChange) {
      const channel = client
        .channel(`grocery-items-${me.householdId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'grocery', table: 'items', filter: `household_id=eq.${me.householdId}` },
          () => onChange(),
        )
        .subscribe()
      return () => {
        void client.removeChannel(channel)
      }
    },
  }
}
