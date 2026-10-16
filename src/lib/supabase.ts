import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isConfigured = Boolean(url && key)

let client: SupabaseClient | null = null

// 가계부와 같은 프로젝트·계정을 쓴다. 키가 없어도 모듈 import는 실패하지 않고, 처음 쓸 때 만든다.
export function supabase(): SupabaseClient {
  if (!client) {
    if (!url || !key) throw new Error('Supabase 환경 변수가 없어요')
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  }
  return client
}
