"""서울 법정동 경계 + 2026년 동별 평균 전세가 → public/map.geojson

python scripts/build_map.py LSMD_ADM_SECT_UMD_11_202609.shp seoul_rent_2026.csv
- 경계: VWorld 법정동 경계(eTL 6주차 LSMD_ADM_SECT_UMD_서울.zip), EPSG:5186, EUC-KR
- 전세가: lecture02 seoul_rent_2026.csv(접수연도 2026)에서 전세만 평균
"""
import json, sys
import geopandas as gpd
import pandas as pd

shp, csv = sys.argv[1:3]
g = gpd.read_file(shp, encoding="cp949")
g["cgg"] = g["EMD_CD"].str[:5]
g["dong"] = g["EMD_CD"].str[5:8] + "00"  # API의 STDG_CD(5자리)와 맞춤

rent = pd.read_csv(csv, encoding="utf-8-sig", dtype={"CGG_CD": str, "STDG_CD": str})
j = rent[rent["RENT_SE"] == "전세"].groupby(["CGG_CD", "STDG_CD"])["GRFE"].agg(["mean", "count"]).reset_index()
g = g.merge(j, left_on=["cgg", "dong"], right_on=["CGG_CD", "STDG_CD"], how="left")

g["geometry"] = g.geometry.simplify(20)  # 20m: 동 경계 모양은 유지하면서 용량 축소
g = g.to_crs(4326)
features = []
for r in g.itertuples():
    geo = json.loads(gpd.GeoSeries([r.geometry]).to_json())["features"][0]["geometry"]
    features.append({
        "type": "Feature",
        "properties": {"cgg": r.cgg, "dong": r.dong, "name": r.EMD_NM,
                       "avg": None if pd.isna(r.mean) else round(r.mean), "n": 0 if pd.isna(r.count) else int(r.count)},
        "geometry": geo,
    })
out = json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":"))
# 좌표 소수 5자리(약 1m)로 줄여 용량 축소
import re
out = re.sub(r"(\d+\.\d{5})\d+", r"\1", out)
open("public/map.geojson", "w").write(out)
print(len(features), "동,", sum(f["properties"]["avg"] is not None for f in features), "동 전세가 있음,", len(out) // 1024, "KB")
