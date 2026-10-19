// Edge Function 진입점. 서비스 롤 클라이언트를 만들어 handle()에 넘긴다.
// FOODSAFETY_API_KEY는 Supabase 함수 비밀값(사용자가 넣음). 호출 비밀번호는 없다:
// handle()이 20시간에 한 번만 실제로 받고, 30분 안의 재시도는 429로 돌려보낸다.
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY는 Supabase가 함수 환경에 넣어 준다.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handle } from './handle.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const runs = () => admin.schema('grocery').from('sync_runs')

Deno.serve((req) =>
  handle(req, {
    apiKey: Deno.env.get('FOODSAFETY_API_KEY'),
    fetchImpl: (url) => fetch(url, { signal: AbortSignal.timeout(20_000) }), // 한 번에 20초까지
    now: () => new Date(),
    recentRuns: async (since) => {
      const { data, error } = await runs().select('source, ok, ran_at').gte('ran_at', since)
      if (error) throw new Error(`sync_runs 읽기 실패: ${error.message}`)
      return data ?? []
    },
    markAttempt: async () => {
      const { error } = await runs().insert({ source: 'attempt', ok: false })
      if (error) throw new Error(`sync_runs 기록 실패: ${error.message}`)
    },
    upsert: async (rows) => {
      const { error } = await admin.schema('grocery').from('food_alerts').upsert(
        rows.map((r) => ({ ...r, fetched_at: new Date().toISOString() })),
        { onConflict: 'source,source_id' },
      )
      if (error) {
        console.error('food_alerts 저장 실패', error.message)
        throw new Error('save_failed')
      }
    },
    recordRun: async (run) => {
      const { error } = await runs().insert(run)
      if (error) console.error('sync_runs 기록 실패', error.message)
    },
  }),
)
