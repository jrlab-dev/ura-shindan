# -*- coding: utf-8 -*-
"""全ページのインデックス状態をGSCのAPIで直接確かめる（2026-08-22改訂）

⚠️ 旧版（_一時/gsc_verify_index.py）はURLを22本ベタ書きしていたため、
   相性ペア20ページを検査できなかった。URLは site_urls.py だけが持つ。
   （2本の生成スクリプトでURLが二重管理になっていた8/16の問題と同じ構造）

使い方:  python 道具\gsc_index_check.py
"""
import sys, io, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession
import site_urls

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = (r"C:\Claude Code\ウェブサイト\あそびラボ_プロジェクト\ビックファイブ診断サイト"
       r"\_private\マーケティング\SEO\nifty-harmony-307600-1ada38767743.json")
SITE = "https://ura.jr-genius.jp/"

creds = service_account.Credentials.from_service_account_file(
    KEY, scopes=["https://www.googleapis.com/auth/webmasters"])
s = AuthorizedSession(creds)

rows = site_urls.all_urls(ROOT)
print(f"検査対象 {len(rows)} URL（site_urls.py が正本）\n")

cnt, ng = {}, []
for path, _lm in rows:
    u = SITE.rstrip("/") + path
    r = s.post("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
               json={"inspectionUrl": u, "siteUrl": SITE, "languageCode": "ja"})
    if r.status_code != 200:
        print(f"  {path:<26} APIエラー {r.status_code} {r.text[:80]}")
        ng.append((path, f"APIエラー{r.status_code}"))
        continue
    d = r.json().get("inspectionResult", {}).get("indexStatusResult", {})
    verdict = d.get("verdict", "-")
    cov = d.get("coverageState", "-")
    crawl = (d.get("lastCrawlTime") or "未クロール")[:10]
    cnt[cov] = cnt.get(cov, 0) + 1
    mark = "OK " if verdict == "PASS" else "-> "
    print(f"  {mark}{path:<26} {verdict:8} {cov:30} クロール:{crawl}")
    if verdict != "PASS":
        ng.append((path, cov))

print("\n=== 集計 ===")
for k, v in sorted(cnt.items(), key=lambda x: -x[1]):
    print(f"  {v:2}件  {k}")
print(f"\n登録済み(PASS): {len(rows) - len(ng)} / {len(rows)}")
if ng:
    print("--- 未登録のページ ---")
    for p, c in ng:
        print(f"  {p:<26} {c}")
