// Edge Function 진입점. 비밀값과 서비스 롤 클라이언트를 만들어 handle()에 넘긴다.
// FOODSAFETY_API_KEY, SYNC_SECRET은 Supabase 함수 비밀값(사용자가 넣음).
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY는 Supabase가 함수 환경에 넣어 준다.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handle } from './handle.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

Deno.serve((req) =>
  handle(req, {
    syncSecret: Deno.env.get('SYNC_SECRET'),
    apiKey: Deno.env.get('FOODSAFETY_API_KEY'),
    fetchImpl: (url) => fetch(url),
    upsert: async (rows) => {
      const { error } = await admin.schema('grocery').from('food_alerts').upsert(
        rows.map((r) => ({ ...r, fetched_at: new Date().toISOString() })),
        { onConflict: 'source,source_id' },
      )
      if (error) throw new Error(`food_alerts 저장 실패: ${error.message}`)
    },
    recordRun: async (run) => {
      const { error } = await admin.schema('grocery').from('sync_runs').insert(run)
      if (error) console.error('sync_runs 기록 실패', error.message)
    },
  }),
)
