# 우리집 장보기

> **2026-10-19부터 장보기는 가계부 앱(jootaewan-hub/account-book)의 '장보기' 탭이다(D-010).** 코드·마이그레이션·Edge Function·식약처 예약 실행·문서는
> 가계부 저장소로 옮겼고(`src/grocery/`, `docs/grocery/`), 이 저장소는 보관(읽기 전용)한다. 이 주소(https://jootaewan-hub.github.io/grocery-app/)는
> 옮겨졌다는 안내만 보여 주고 https://jootaewan-hub.github.io/account-book/?tab=grocery 로 넘긴다. 새 작업은 가계부 저장소에서 한다.

부부 둘이 쓰는 장보기 앱. 품목을 글이나 사진으로 담으면 쇼핑몰별 가격, 식약처 회수·판매중지 기록, 공공 시세와 변동, 대안 상품을 보여 주고, 산 것은 지출 기록으로 남긴다.

- 작업 규칙과 진입점: [CLAUDE.md](CLAUDE.md)
- 요구사항: [docs/product.md](docs/product.md)
- 데이터 출처: [docs/data-sources.md](docs/data-sources.md)
- 현재 상태: [docs/tracking/status.md](docs/tracking/status.md)

## 개발

가계부 앱과 같은 Supabase 프로젝트를 쓴다(D-003). 주소와 공개용 키는 `src/lib/supabaseConfig.ts`에 있어서 `.env` 파일 없이 `npm install` 후 `npm run dev`로 바로 실행된다. 두 값은 브라우저에 노출돼도 되는 공개용 값이고, 비밀값은 그 파일에 두지 않는다(테스트가 막는다). 다른 프로젝트로 시험할 때만 `.env.local`의 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`로 덮어쓴다.

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm test` | 테스트(권한 테스트는 PGlite) |
| `npm run build` | 타입 검사 후 빌드 |
| `npm run screens` | 스크린샷 캡처. 개발 서버를 먼저 띄워 둔다 |

개발 서버에서만 되는 화면 미리보기 주소:

- `?demo=1` 로그인한 상태의 목록(메모리 데이터)
- `?demo=login` 로그인 화면
- `?demo=nohousehold` 가구에 속하지 않은 계정 화면

배포는 `main`에 푸시하면 GitHub Actions가 테스트 → 빌드 → GitHub Pages 순서로 한다(D-006).
