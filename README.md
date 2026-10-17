# seoul_rent_api · 서울 전세가 5년 변화

스마트시티와 융합기술 세미나 **과제2**: 지난 5년간 서울시 전세 가격 변화를 분석하고 Cloudflare로 발행.

자치구·법정동을 고르면 서울 열린데이터광장 `tbLnOpendataRentV` API에서 접수연도 2022~2026년 자료를 가져와
전세 거래만 골라 월별·연도별 평균 보증금, ㎡당 보증금, 변화율을 보여줍니다. 건물용도(아파트·연립다세대·단독다가구·오피스텔)로 거를 수 있습니다.

## 구조

```text
public/            정적 화면 (index.html, style.css, app.js, dongs.json)
functions/api/rent.js   Cloudflare Pages Function: API 키로 서울시 API 호출 → 집계 결과만 반환
test.mjs           node test.mjs : 가짜 API 응답으로 rent.js 점검
```

- API 키는 브라우저로 내려가지 않습니다. 서버 함수가 환경변수 `SEOUL_API_KEY`로만 호출합니다.
- `dongs.json`(25개 구, 403개 법정동)은 lecture02의 `seoul_rent_2026.csv`에서 만든 목록입니다.
- 화면의 "동"은 API가 주는 **법정동**(`STDG_NM`)입니다. 과제 문구의 행정동과 다릅니다.
- **데이터 한계:** 2026-10-17 확인 기준 이 API는 접수연도 2024년부터만 자료가 있습니다(2022·2023 요청은 "해당 데이터 없음").
  앱은 5개 연도를 모두 요청하고, 없는 연도는 "자료 수집 현황"에 그대로 표시합니다.
- 무료 플랜의 외부 호출 제한(요청당 50회) 때문에 연도별로 나눠 요청하며, 한 연도에 4만 건이 넘으면 일부만 집계합니다.

## 로컬 실행

```sh
cp .dev.vars.example .dev.vars   # 파일 안에 본인 인증키 입력
npx wrangler@4.131.1 pages dev public
```

## 배포 (Cloudflare Pages Direct Upload)

```sh
npx wrangler@4.131.1 pages project create seoul-rent-api --production-branch main
npx wrangler@4.131.1 pages secret put SEOUL_API_KEY --project-name seoul-rent-api
npx wrangler@4.131.1 pages deploy public --project-name seoul-rent-api --branch main
```

GitHub 연결 방식으로 배포할 때는 Build output directory를 `public`으로 하고, Settings → Variables and Secrets에 `SEOUL_API_KEY`를 등록합니다.
