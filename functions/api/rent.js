// GET /api/rent?year=2024&cgg=11470&dong=10200
// 서울시 API 키는 서버(Cloudflare 환경변수)에만 있고, 브라우저에는 집계 결과만 보낸다.
const SERVICE = "tbLnOpendataRentV";
const PAGE = 1000;
// ponytail: Cloudflare 무료 플랜은 요청 1회당 외부 호출 50번 제한 → 연도별로 나눠 부르고 40쪽(4만 건)에서 자름
const MAX_PAGES = 40;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": status === 200 ? "public, max-age=3600" : "no-store" },
  });

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const year = q.get("year"), cgg = q.get("cgg"), dong = q.get("dong");
  if (!/^20\d\d$/.test(year) || !/^\d{5}$/.test(cgg) || !/^\d{5}$/.test(dong)) {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (!env.SEOUL_API_KEY) return json({ error: "서버에 SEOUL_API_KEY가 설정되지 않았습니다." }, 500);

  const page = async (i) => {
    const url = `http://openapi.seoul.go.kr:8088/${env.SEOUL_API_KEY}/json/${SERVICE}/${i * PAGE + 1}/${(i + 1) * PAGE}/${year}/${cgg}/%20/${dong}/`;
    const d = await (await fetch(url)).json();
    if (d[SERVICE]) return { total: d[SERVICE].list_total_count, rows: d[SERVICE].row };
    if (d.RESULT?.CODE === "INFO-200") return { total: 0, rows: [] }; // 해당 데이터 없음
    throw Object.assign(new Error(d.RESULT?.MESSAGE || "서울시 API 오류"), { api: true });
  };

  try {
    const first = await page(0);
    const need = Math.ceil(first.total / PAGE);
    const pages = Math.min(need, MAX_PAGES);
    const rest = await Promise.all(Array.from({ length: Math.max(pages - 1, 0) }, (_, i) => page(i + 1)));

    // 계약월|건물용도 → [전세 건수, 보증금 합(만원), 면적 합(㎡)]
    const agg = {};
    let rows = 0;
    for (const r of [first, ...rest].flatMap((p) => p.rows)) {
      rows++;
      const grfe = Number(r.GRFE), area = Number(r.RENT_AREA);
      if (r.RENT_SE !== "전세" || !grfe || !area || !/^\d{8}$/.test(r.CTRT_DAY)) continue;
      const key = `${r.CTRT_DAY.slice(0, 4)}-${r.CTRT_DAY.slice(4, 6)}|${r.BLDG_USG}`;
      const a = (agg[key] ??= [0, 0, 0]);
      a[0]++;
      a[1] += grfe;
      a[2] += area;
    }
    return json({ year, total: first.total, rows, truncated: pages < need, agg });
  } catch (e) {
    console.error("rent api", e.message.replaceAll(env.SEOUL_API_KEY, "***"));
    // 네트워크 오류 메시지에는 키가 든 URL이 섞일 수 있어 서울시 API 메시지만 그대로 전달
    return json({ error: e.api ? e.message : "서울시 API 호출에 실패했습니다." }, 502);
  }
}
