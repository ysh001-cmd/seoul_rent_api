// node test.mjs — 서울시 API를 가짜 fetch로 대신해 rent.js 페이지 처리·집계를 확인
import assert from "node:assert/strict";
import { onRequestGet } from "./functions/api/rent.js";

const row = (day, se, grfe, area, usg) => ({ CTRT_DAY: day, RENT_SE: se, GRFE: String(grfe), RENT_AREA: area, BLDG_USG: usg });
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(url);
  const start = +url.split("/")[6];
  if (url.includes("/2022/")) return Response.json({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } });
  if (url.includes("/2023/")) return Response.json({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키가 유효하지 않습니다." } });
  const rows = start === 1
    ? [row("20240301", "전세", 30000, 60, "아파트"), row("20240305", "월세", 1000, 30, "아파트")]
    : [row("20240320", "전세", 10000, 20, "아파트"), row("2024", "전세", 5, 5, "아파트")];
  return Response.json({ tbLnOpendataRentV: { list_total_count: 1500, row: rows } });
};
const call = async (year, extra = {}) => {
  const res = await onRequestGet({ request: new Request(`https://x/api/rent?year=${year}&cgg=11470&dong=10200`), env: { SEOUL_API_KEY: "SECRETKEY", ...extra } });
  return [res.status, await res.json()];
};

let [status, body] = await call(2024);
assert.equal(status, 200);
assert.equal(calls.length, 2);                                   // 1500건 → 2쪽
assert.ok(calls[1].includes("/1001/2000/2024/11470/%20/10200/"));
assert.deepEqual(body.agg, { "2024-03|아파트": [2, 40000, 80] });  // 월세·잘못된 날짜 제외
assert.equal(body.rows, 4);

[status, body] = await call(2022);
assert.equal(status, 200); assert.equal(body.total, 0);

[status, body] = await call(2023);
assert.equal(status, 502); assert.equal(body.error, "인증키가 유효하지 않습니다.");

globalThis.fetch = async () => { throw new Error("connect failed http://openapi.seoul.go.kr:8088/SECRETKEY/..."); };
[status, body] = await call(2024);
assert.equal(status, 502); assert.ok(!JSON.stringify(body).includes("SECRETKEY"));

assert.equal((await call(2024, { SEOUL_API_KEY: "" }))[0], 500);
assert.equal((await onRequestGet({ request: new Request("https://x/api/rent?year=abc"), env: {} })).status, 400);
console.log("ok");
