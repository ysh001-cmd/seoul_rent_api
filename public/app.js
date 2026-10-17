const YEARS = [2022, 2023, 2024, 2025, 2026];
const MIN_TRADES = 30; // 이보다 적으면 연평균이 거래 몇 건에 크게 흔들림
const COLORS = { 아파트: "#f26b1d", 연립다세대: "#2563eb", 단독다가구: "#16a34a", 오피스텔: "#9333ea" };

const $ = (id) => document.getElementById(id);
const form = $("form"), cggSel = $("cgg"), dongSel = $("dong"), usageSel = $("usage");
let districts = []; // [[구코드, 구이름, [[동코드, 동이름], ...]], ...] 가나다순
let merged = null; // "YYYY-MM|건물용도" → [건수, 보증금 합, 면적 합]
let coveredFrom = null; // 자료가 있는 첫 접수연도. 그 이전 계약연도는 늦게 신고된 일부 거래뿐이라 비교에서 뺀다
let chart = null;

// 만원 → "3억 2,000만원"
function won(man) {
  const v = Math.round(man);
  const eok = Math.floor(v / 10000), rest = v % 10000;
  return ([eok && `${eok}억`, rest && `${rest.toLocaleString()}만`].filter(Boolean).join(" ") || "0") + "원";
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

function fillDongs() {
  const [, , dongs] = districts.find(([code]) => code === cggSel.value);
  dongSel.replaceChildren(...dongs.map(([code, name]) => new Option(name, code)));
}

async function init() {
  districts = await (await fetch("dongs.json")).json();
  cggSel.replaceChildren(...districts.map(([code, name]) => new Option(name, code)));
  fillDongs();
}

async function fetchYear(year) {
  const q = new URLSearchParams({ year, cgg: cggSel.value, dong: dongSel.value });
  try {
    const res = await fetch(`/api/rent?${q}`);
    const data = await res.json();
    return res.ok ? { year, ...data } : { year, error: data.error || `HTTP ${res.status}` };
  } catch {
    return { year, error: "네트워크 오류" };
  }
}

function render() {
  const usage = usageSel.value;
  const months = {}; // "YYYY-MM" → { 건물용도: [건수, 합] }
  const years = {};  // 계약연도 → [건수, 보증금 합, 면적 합]
  for (const [key, [n, sum, area]] of Object.entries(merged)) {
    const [ym, use] = key.split("|");
    const y = +ym.slice(0, 4);
    if (!YEARS.includes(y) || (usage && use !== usage)) continue;
    const m = ((months[ym] ??= {})[use] ??= [0, 0]);
    m[0] += n; m[1] += sum;
    const t = (years[y] ??= [0, 0, 0]);
    t[0] += n; t[1] += sum; t[2] += area;
  }

  const yList = Object.keys(years).map(Number).sort();
  const total = yList.reduce((s, y) => s + years[y][0], 0);
  $("s-count").textContent = `${total.toLocaleString()}건`;
  const avg = (y) => years[y][1] / years[y][0];
  const full = yList.filter((y) => y >= coveredFrom);
  if (full.length) {
    const [first, last] = [full[0], full.at(-1)];
    $("s-first-label").textContent = `${first}년 평균`;
    $("s-last-label").textContent = `${last}년 평균`;
    $("s-first").textContent = won(avg(first));
    $("s-last").textContent = won(avg(last));
    const change = (avg(last) / avg(first) - 1) * 100;
    $("s-change").textContent = first === last ? "-" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
    $("s-change").className = first === last ? "" : change >= 0 ? "up" : "down";
    const few = [first, last].filter((y) => years[y][0] < MIN_TRADES);
    $("warn").hidden = !few.length;
    $("warn").textContent = `※ ${few.map((y) => `${y}년 전세 ${years[y][0]}건`).join(", ")}: 거래가 ${MIN_TRADES}건 미만이라 평균·변화율이 몇 건의 거래에 크게 좌우됩니다. 해석에 주의하세요.`;
  } else {
    for (const id of ["s-first", "s-last", "s-change"]) $(id).textContent = "-";
    $("warn").hidden = true;
  }

  $("table").replaceChildren(...yList.map((y) => {
    const tr = document.createElement("tr");
    const [n, sum, area] = years[y];
    for (const v of [y < coveredFrom ? `${y}년 (일부)` : `${y}년`, n.toLocaleString(), won(sum / n), `${(sum / area).toFixed(1)}만원`]) {
      tr.append(Object.assign(document.createElement("td"), { textContent: v }));
    }
    return tr;
  }));

  const labels = Object.keys(months).filter((ym) => +ym.slice(0, 4) >= coveredFrom).sort();
  const uses = Object.keys(COLORS).filter((u) => labels.some((ym) => months[ym][u]));
  const datasets = uses.map((u) => ({
    label: u,
    data: labels.map((ym) => (months[ym][u] ? Math.round(months[ym][u][1] / months[ym][u][0]) : null)),
    borderColor: COLORS[u],
    backgroundColor: COLORS[u],
    spanGaps: true,
    tension: 0.25,
    pointRadius: 2,
  }));
  chart?.destroy();
  chart = new Chart($("chart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: { y: { ticks: { callback: (v) => won(v) } } },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${won(c.parsed.y)}` } } },
    },
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("submit").disabled = true;
  const place = `${cggSel.selectedOptions[0].text} ${dongSel.selectedOptions[0].text}`;
  setStatus(`${place}의 2022~2026년 자료를 가져오는 중입니다… (거래가 많은 동은 30초 이상 걸릴 수 있어요)`);

  const results = await Promise.all(YEARS.map(fetchYear));
  merged = {};
  coveredFrom = Math.min(...results.filter((r) => r.total > 0).map((r) => r.year));
  for (const r of results) {
    for (const [key, [n, sum, area]] of Object.entries(r.agg || {})) {
      const m = (merged[key] ??= [0, 0, 0]);
      m[0] += n; m[1] += sum; m[2] += area;
    }
  }

  $("coverage").replaceChildren(...results.map((r) => {
    const text = r.error ? `오류 – ${r.error}`
      : r.total === 0 ? "데이터 없음 (현재 API는 2024년 접수분부터 제공)"
      : `${r.rows.toLocaleString()}건 수신${r.truncated ? ` (전체 ${r.total.toLocaleString()}건 중 일부)` : ""}`;
    return Object.assign(document.createElement("li"), { textContent: `접수 ${r.year}년: ${text}` });
  }));

  const failed = results.filter((r) => r.error);
  $("result").hidden = false;
  render();
  setStatus(failed.length === YEARS.length
    ? `자료를 가져오지 못했습니다: ${failed[0].error}`
    : `${place} 조회 완료`, failed.length === YEARS.length);
  $("submit").disabled = false;
});

cggSel.addEventListener("change", fillDongs);
usageSel.addEventListener("change", () => merged && render());
init().catch(() => setStatus("동 목록을 불러오지 못했습니다.", true));
