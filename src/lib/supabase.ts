import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabaseConfig'

// 기본은 코드에 둔 공개용 값. 다른 프로젝트로 시험할 때만 VITE_ 환경 변수로 덮어쓴다.
const url = import.meta.env.VITE_SUPABASE_URL || SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY

export const isConfigured = Boolean(url && key)

let client: SupabaseClient | null = null

// 가계부와 같은 프로젝트·계정을 쓴다. 모듈 import 때가 아니라 처음 쓸 때 만든다.
export function supabase(): SupabaseClient {
  if (!client) {
    if (!url || !key) throw new Error('Supabase 설정이 비어 있어요')
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  }
  return client
}
