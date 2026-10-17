// 가계부와 같은 Supabase 프로젝트(D-003)의 공개용 값. 가계부 배포 설정과 같은 값이다.
// 브라우저에 그대로 들어가도 되는 값이며 데이터는 RLS로 보호된다. 그래서 .env 파일 없이 바로 실행된다.
// 비밀값(서비스 롤 키, sb_secret_ 키, 외부 API 키)은 절대 여기에 두지 않는다. tests/supabaseConfig.test.ts가 막는다.
export const SUPABASE_URL = 'https://kifdfpbwiebfgvdumqjf.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bQ2BOXHX_7-_l_tvVrel6A_-2atkMYK'
