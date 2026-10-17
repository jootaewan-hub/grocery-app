import { SUPABASE_URL } from './supabaseConfig'

/** 기본 Supabase 프로젝트(VITE_SUPABASE_URL로 덮어쓰지 않을 때) */
export const DEFAULT_SUPABASE_ORIGIN = new URL(SUPABASE_URL).origin

/** 빌드한 페이지에 넣는 콘텐츠 보안 정책. 통신·이미지는 이 앱의 Supabase 한 곳으로만 허용한다.
 *  쇼핑몰 상품 이미지 호스트는 쓰게 될 때 정확한 호스트 이름으로 하나씩 더한다. */
export function buildCsp(supabaseOrigin: string): string {
  const wss = supabaseOrigin.replace(/^https:\/\//, 'wss://')
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabaseOrigin}`,
    "font-src 'self'",
    `connect-src 'self' ${supabaseOrigin} ${wss}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}
