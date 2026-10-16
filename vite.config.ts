import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages처럼 하위 경로에 배포할 때는 BASE_PATH=/grocery-app/ 으로 빌드한다
const base = process.env.BASE_PATH ?? '/'

// 빌드한 페이지에만 콘텐츠 보안 정책(CSP)을 넣는다: 스크립트는 이 사이트 파일만, 통신은 Supabase로만.
// GitHub Pages는 응답 헤더를 못 바꿔서 meta 태그로 넣는다. 개발 서버는 인라인 스크립트(HMR)를 써서 뺀다.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export default defineConfig({
  base,
  plugins: [
    react(),
    {
      name: 'csp-meta',
      apply: 'build',
      transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '우리집 장보기',
        short_name: '장보기',
        description: '둘이 같이 쓰는 장보기 목록',
        lang: 'ko',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        // 장보기 데이터(Supabase)는 캐시하지 않는다. 앱 파일만 캐시.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
})
