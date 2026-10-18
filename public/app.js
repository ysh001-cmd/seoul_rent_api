const YEARS = [2022, 2023, 2024, 2025, 2026];
const MIN_TRADES = 30; // 이보다 적으면 연평균이 거래 몇 건에 크게 흔들림
const COLORS = { 아파트: "#f26b1d", 연립다세대: "#2563eb", 단독다가구: "#16a34a", 오피스텔: "#9333ea" };

const $ = (id) => document.getElementById(id);
const form = $("form"), cggSel = $("cgg"), dongSel = $("dong"), usageSel = $("usage");
let districts = []; // [[구코드, 구이름, [[동코드, 동이름], ...]], ...] 가나다순
let merged = null; // "YYYY-MM|건물용도" → [건수, 보증금 합, 면적 합]
let coveredFrom = null; // 자료가 있는 첫 접수연도. 그 이전 계약연도는 늦게 신고된 일부 거래뿐이라 비교에서 뺀다
let chart = null;
const MAP_COLORS = ["#fee6ce", "#fdd0a2", "#fdae6b", "#fd8d3c", "#e6550d", "#a63603"];
let geo = null;  // 지도 법정동 레이어
let breaks = []; // 색 구간 경계(만원), 거래 5건 이상인 동의 6분위

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
  await initMap().catch(() => ($("map").textContent = "지도를 불러오지 못했습니다."));
}

const fillColor = (p) => (p.n < 5 ? "#e5e5e5" : MAP_COLORS[breaks.filter((b) => p.avg >= b).length]);
const roundWon = (man) => won(Math.round(man / 1000) * 1000); // 범례용: 천만원 단위

async function initMap() {
  const data = await (await fetch("map.geojson")).json();
  const avgs = data.features.map((f) => f.properties).filter((p) => p.n >= 5).map((p) => p.avg).sort((a, b) => a - b);
  breaks = [1, 2, 3, 4, 5].map((i) => avgs[Math.floor((avgs.length * i) / 6)]);

  const map = L.map("map", { scrollWheelZoom: false, zoomSnap: 0.25 });
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
    maxZoom: 16,
  }).addTo(map);
  geo = L.geoJSON(data, {
    style: (f) => ({ color: "#fff", weight: 0.7, fillColor: fillColor(f.properties), fillOpacity: 0.8 }),
    onEachFeature: (f, layer) => {
      const p = f.properties;
      const gu = districts.find(([code]) => code === p.cgg)?.[1] ?? "";
      layer.bindTooltip(`<b>${gu} ${p.name}</b><br>${p.n ? `평균 ${won(p.avg)} · 전세 ${p.n.toLocaleString()}건` : "2026년 전세 거래 없음"}`, { sticky: true });
      layer.on("click", () => selectDong(p.cgg, p.dong));
    },
  }).addTo(map);
  map.fitBounds(geo.getBounds());

  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    div.innerHTML = MAP_COLORS.map((c, i) => `<i style="background:${c}"></i>${i ? `${roundWon(breaks[i - 1])} 이상` : `${roundWon(breaks[0])} 미만`}`).join("<br>")
      + '<br><i style="background:#e5e5e5"></i>거래 5건 미만';
    return div;
  };
  legend.addTo(map);
  highlight();
}

// 선택된 동 테두리 강조
function highlight() {
  geo?.eachLayer((layer) => {
    const p = layer.feature.properties;
    const on = p.cgg === cggSel.value && p.dong === dongSel.value;
    layer.setStyle(on ? { color: "#1f2430", weight: 3 } : { color: "#fff", weight: 0.7 });
    if (on) layer.bringToFront();
  });
}

function selectDong(cgg, dong) {
  cggSel.value = cgg;
  fillDongs();
  if (![...dongSel.options].some((o) => o.value === dong)) {
    highlight();
    return setStatus("이 동은 전월세 거래 자료가 없어 조회할 수 없습니다.");
  }
  dongSel.value = dong;
  form.requestSubmit();
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
  highlight();
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

cggSel.addEventListener("change", () => (fillDongs(), highlight()));
dongSel.addEventListener("change", highlight);
usageSel.addEventListener("change", () => merged && render());
init().catch(() => setStatus("동 목록을 불러오지 못했습니다.", true));
