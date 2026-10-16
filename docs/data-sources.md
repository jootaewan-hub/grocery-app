# 외부 데이터 출처

2026-10-16에 공식 문서와 실제 호출로 확인한 내용이다. "확인 필요"는 코드를 쓰기 전에 실제 호출로 확인하고 이 문서를 고친다.

## 1. 쇼핑 가격 — 네이버 검색 API(쇼핑)

- 문서: https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md
- 확인된 사실
  - 검색 API의 하루 호출 한도는 25,000회다. (https://developers.naver.com/products/intro/plan/plan.md)
  - 응답 항목: `title`(검색어 일치 부분이 `<b>` 태그로 감싸짐), `link`, `image`(섬네일 URL), `lprice`(최저가, 없으면 0), `hprice`(최고가, 없으면 0), `mallName`(없으면 "네이버"), `productId`, `brand`, `maker`, `category1~4`.
  - JSON 또는 XML로 받는다.
- 확인 필요
  - 인증 헤더 이름과 엔드포인트 경로(`/v1/search/shop.json` 등)를 문서에서 재확인.
  - 네이버 클라우드 API HUB로 옮겨 간 경우 한도가 다를 수 있다는 FAQ가 있다(https://www.ncloud.com/support/faq/prod/3752). 어느 쪽으로 키를 받는지에 따라 한도를 다시 확인.
  - 바코드 번호로 검색했을 때 상품이 잡히는지(추측: 일부만 잡힐 것).
  - 쿠팡 상품이 결과의 `mallName`으로 나오는지.

## 2. 농축수산물 시세 — KAMIS Open API (한국농수산식품유통공사)

- 안내: https://www.kamis.or.kr/customer/reference/openapi_list.do
- 확인된 사실
  - 사용하려면 사용 신청 후 키를 받는다. 공공데이터포털을 통하면 승인 대기 없이 바로 쓸 수 있다고 안내돼 있다.
  - 일별 부류별 도·소매가격(`action=dailyPriceByCategoryList`): 요청 변수 `p_cert_key`, `p_cert_id`, `p_returntype`(json/xml), `p_product_cls_code`(01 소매/02 도매), `p_item_category_code`(100 식량작물, 200 채소, 300 특용작물, 400 과일, 500 축산물, 600 수산물), `p_country_code`(지역), `p_regday`(yyyy-mm-dd), `p_convert_kg_yn`. 응답에 `dpr1`~`dpr7` = 조회일, 1일 전, 1주일 전, 2주일 전, 1개월 전, 1년 전, 평년 가격과 각 날짜가 온다.
  - 기간 조회(`action=periodProductList`)는 당일로부터 1년치만 제공한다.
  - 월별·연도별 API는 "축평원 데이터 제외"라고 명시돼 있다.
  - 평년은 5년간(금년 제외) 해당일의 최고·최저를 뺀 3년 평균이다(KAMIS 화면 안내).
- 확인 필요
  - 일별 API에 축산물(축산물품질평가원 자료)이 포함되는지. (추측: 월별·연도별만 제외라고 적은 점으로 보아 포함)
  - 하루 갱신 시각. 참고로 국가농식품통계서비스 화면은 "평일 16시 이후 업데이트"라고 안내한다.
  - 호출 한도.

## 3. 회수·판매중지 — 식품안전나라 Open API (서비스 ID `I0490`)

- 주소 형식: `http://openapi.foodsafetykorea.go.kr/api/{인증키}/I0490/json/{시작}/{끝}/{조건=값}`
- 확인된 사실 (2026-10-16 실제 호출)
  - `sample` 키로 호출하면 최근 5건만 온다(10/14 등록분까지 확인).
  - 이 서비스가 받는 조회 조건은 `CHNG_DT`, `CRET_DTM`, `PRDLST_REPORT_NO`뿐이다. 제품명(`PRDTNM`)을 넣으면 "지원하지 않는 요청인자"라는 안내와 함께 무시된다.
  - 응답 항목: `PRDTNM`(제품명), `BSSHNM`(업체명), `RTRVLPRVNS`(회수 사유), `RTRVL_GRDCD_NM`(회수 등급), `CRET_DTM`(등록일시), `BRCDNO`(바코드), `FRMLCUNIT`(포장 단위), `DISTBTMLMT`(소비기한), `MNFDT`(제조일자), `PRDLST_TYPE`, `PRDLST_CD_NM`, `PRDLST_REPORT_NO`(품목보고번호), `IMG_FILE_PATH`, `RTRVLPLANDOC_RTRVLMTHD`.
- 쓰는 방법(제안): 정식 인증키로 `CRET_DTM` 기준 최근 기간을 매일 받아 DB에 쌓고, 목록 품목과 바코드·제품명·업체명으로 대조한다.
- 확인 필요
  - 정식 키의 호출 한도와 한 번에 받을 수 있는 최대 건수.
  - 행정처분 결과를 주는 서비스 ID(미확인).

## 4. 바코드 → 제품 — 식약처 유통바코드 (공공데이터포털 15064775)

- https://www.data.go.kr/data/15064775/openapi.do
- 확인된 사실: 유통물류진흥원 요청으로 **2018년 이후 최신화가 중단**됐다고 안내돼 있다. 최신 제품은 이 경로로 찾지 못한다.
- 대안(확인 필요): 바코드 숫자를 네이버 쇼핑 검색에 넣기, 제품 포장 사진에서 제품명을 읽기.

## 5. 축산물 소비자가 — 축산물품질평가원 다봄

- https://www.ekapepia.com/v3/web/main.do?userGroup=common
- 확인된 사실: 웹 화면에 삼겹살 100g 소비자가와 전일·전주·전년 동월·평년 동월 대비가 기준일과 함께 나온다(2026-10-15자 확인).
- 확인 필요: 공개 API 여부와 이용 조건. KAMIS 일별 API로 충분하면 쓰지 않는다.

## 6. 쿠팡 가격

- 확인된 사실: 공개 가격 API는 확인하지 못했다.
- 참고: 쿠팡 가격 추적 사이트(로우차트, 타이밍, 폴센트)에 관측 최저·평균·최고가가 나오지만 웹페이지이므로 이용약관 확인 전에는 수집하지 않는다.

## 7. 사진에서 품목 읽기 — Anthropic API

- 서버 함수에서 이미지와 지시문을 보내 `[{name, spec, count, barcode}]` 형태로 받는다. 읽히지 않는 글자는 추측하지 말고 빼라고 지시한다.
- 확인 필요: 쓸 모델과 1장당 비용(Anthropic 문서에서 확인).
