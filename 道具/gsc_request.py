# -*- coding: utf-8 -*-
"""GSCのURL検査→インデックス登録リクエストを、未登録ページに順に実行する（2026-08-22改訂）

🚨 旧版（_一時/gsc_request.py）は対象URLをベタ書きしていたので、
   相性ペア20ページを1本もリクエストできなかった。
   → 対象は site_urls.py（URLの正本）＋ GSC APIの実測から毎回組み立てる。

事前準備:
    msedge.exe --remote-debugging-port=9222 --user-data-dir=%TEMP%\\claude-gsc-profile ^
               --start-maximized https://search.google.com/search-console?resource_id=https://ura.jr-genius.jp/

使い方:
    python 道具\\gsc_request.py            # 未登録の全ページ
    python 道具\\gsc_request.py 3          # 先頭3件だけ（試し運転）

安全のため:
  - 既に登録済み／既にリクエスト済みのページは押さずに飛ばす
  - 1日の割り当てを使い切ったら、そこで止めて残りを報告する
  - 1件ごとに記録を書き出す（途中で止まっても消えない）
"""
import sys, io, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession
import site_urls

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_一時")
LOG = os.path.join(OUT, "gsc_request_log.json")
LABEL = "インデックス登録をリクエスト"
SITE = "https://ura.jr-genius.jp"
KEY = (r"C:\Claude Code\ウェブサイト\あそびラボ_プロジェクト\ビックファイブ診断サイト"
       r"\_private\マーケティング\SEO\nifty-harmony-307600-1ada38767743.json")


def undone_urls():
    """GSC APIで実測し、まだ登録されていないURLを返す（大事な順に並べ替える）"""
    creds = service_account.Credentials.from_service_account_file(
        KEY, scopes=["https://www.googleapis.com/auth/webmasters"])
    s = AuthorizedSession(creds)
    ng = []
    for path, _lm in site_urls.all_urls(ROOT):
        u = SITE + path
        r = s.post("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
                   json={"inspectionUrl": u, "siteUrl": SITE + "/", "languageCode": "ja"})
        if r.status_code != 200:
            print(f"  APIエラー {r.status_code} {path}")
            continue
        d = r.json().get("inspectionResult", {}).get("indexStatusResult", {})
        if d.get("verdict") != "PASS":
            ng.append((path, d.get("coverageState", "-")))
    # 「Googleに認識されていない」ものを先頭に（放っておいても進まないため）
    ng.sort(key=lambda x: (0 if "認識されていません" in x[1] else
                           1 if "検出" in x[1] else 2))
    return [SITE + p for p, _ in ng]


def find_box(pg):
    for i in pg.query_selector_all("input"):
        if not i.is_visible():
            continue
        lab = (i.get_attribute("placeholder") or "") + " " + (i.get_attribute("aria-label") or "")
        if "URL を検査" in lab:
            return i
    return None


def find_btn(pg, label):
    for el in pg.query_selector_all("[role=button]"):
        try:
            if not el.is_visible():
                continue
            if (el.inner_text() or "").strip() == label:
                return el
        except Exception:
            continue
    return None


def wait_btn(pg, label, sec=45):
    """ボタンが実際に押せる状態になるまで待つ（検査直後はまだ描画されていない）"""
    for _ in range(int(sec / 1.5)):
        b = find_btn(pg, label)
        if b is not None:
            return b
        pg.wait_for_timeout(1500)
    return None


def kill_overlay(pg):
    """Edgeの翻訳レイヤーなど、クリックを遮る覆いを取り除く"""
    pg.evaluate("""() => {
      document.querySelectorAll('trans-layer, .KL4X6e, .TuA45b').forEach(e => e.remove());
      document.documentElement.setAttribute('translate', 'no');
    }""")


def click_hard(pg, el):
    """遮られても押し切る。DOMのclick→強制click→座標クリックの順に試す"""
    kill_overlay(pg)
    try:
        el.evaluate("e => e.click()")
        return "js"
    except Exception:
        pass
    try:
        el.click(force=True, timeout=8000)
        return "force"
    except Exception:
        pass
    try:
        bb = el.bounding_box()
        pg.mouse.click(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
        return "mouse"
    except Exception as e:
        return f"NG {e}"


class Log(list):
    """1件ごとにファイルへ書き出すリスト（途中で止まっても記録が消えない）"""
    def append(self, x):
        super().append(x)
        with open(LOG, "w", encoding="utf-8") as f:
            json.dump(list(self), f, ensure_ascii=False, indent=1)


print("=== 未登録ページをAPIで実測中 ===")
TARGETS = undone_urls()
print(f"未登録 {len(TARGETS)} 件")
limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(TARGETS)
TARGETS = TARGETS[:limit]
for u in TARGETS:
    print("  ", u)
print()

try:
    _prev = json.load(open(LOG, encoding="utf-8"))
except Exception:
    _prev = []
results = Log(_prev)
_base = len(_prev)

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    ctx = b.contexts[0]
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    pg.set_viewport_size({"width": 1400, "height": 950})

    stop = False
    for n, url in enumerate(TARGETS, 1):
        if stop:
            results.append({"date": "2026-08-22", "url": url, "result": "未実行（割り当て切れで中断）"})
            continue

        kill_overlay(pg)
        box = find_box(pg)
        if box is None:
            results.append({"date": "2026-08-22", "url": url, "result": "NG 入力欄が見つからない"})
            print(f"[{n}/{len(TARGETS)}] {url} → NG 入力欄なし")
            continue
        box.click(force=True); box.fill(url); box.press("Enter")

        # ⚠️8/1の失敗：前の画面のテキストを読んで誤判定した
        #   → 画面に「今回のURL」が出てから判定する
        key = url[len(SITE):]
        state = ""
        for _ in range(40):
            pg.wait_for_timeout(2000)
            t = pg.inner_text("body")
            if key not in t:
                continue
            if "URL は Google に登録されています" in t:
                state = "登録済み"; break
            if LABEL in t:
                state = "未登録"; break
        if not state:
            results.append({"date": "2026-08-22", "url": url, "result": "NG 検査が終わらない"})
            print(f"[{n}/{len(TARGETS)}] {url} → NG 検査タイムアウト")
            continue

        if state == "登録済み":
            results.append({"date": "2026-08-22", "url": url, "result": "スキップ（既に登録済み）"})
            print(f"[{n}/{len(TARGETS)}] {url} → 既に登録済み・スキップ")
            continue

        if find_btn(pg, "インデックス登録をリクエスト再リクエスト") is not None:
            results.append({"date": "2026-08-22", "url": url, "result": "スキップ（既にリクエスト済み）"})
            print(f"[{n}/{len(TARGETS)}] {url} → 既にリクエスト済み・スキップ")
            continue

        btn = wait_btn(pg, LABEL)
        if btn is None:
            results.append({"date": "2026-08-22", "url": url, "result": "NG ボタンが出ない"})
            print(f"[{n}/{len(TARGETS)}] {url} → NG ボタンが出ない")
            continue

        how = click_hard(pg, btn)
        res = ""
        for _ in range(50):
            pg.wait_for_timeout(3000)
            t = pg.inner_text("body")
            for k in ["インデックス登録をリクエスト済み", "リクエストは正常に", "優先クロール",
                      "1 日の割り当て", "割り当てを使い切", "しばらくしてからもう一度"]:
                if k in t:
                    res = k; break
            if res:
                break
        if "割り当て" in res or "しばらく" in res:
            stop = True
            results.append({"date": "2026-08-22", "url": url, "result": f"中断: {res}"})
            print(f"[{n}/{len(TARGETS)}] {url} → ★{res}（ここで中断）")
        else:
            results.append({"date": "2026-08-22", "url": url, "result": res or "押したが判定文なし",
                            "click": how})
            print(f"[{n}/{len(TARGETS)}] {url} → {res or '押したが判定文なし'}（{how}）")

        # 完了ダイアログを閉じる（ボタンは「表示しない」）
        for lab in ["表示しない", "OK", "閉じる", "GOT IT", "確認"]:
            x = find_btn(pg, lab)
            if x is not None:
                click_hard(pg, x); pg.wait_for_timeout(1200); break
        pg.wait_for_timeout(2500)

ok = sum(1 for r in results[_base:] if "リクエスト済み" in r["result"] or "正常" in r["result"] or "優先" in r["result"])
sk = sum(1 for r in results[_base:] if r["result"].startswith("スキップ"))
ngc = sum(1 for r in results[_base:] if r["result"].startswith("NG") or "中断" in r["result"] or "未実行" in r["result"])
print(f"\n=== リクエスト成功 {ok} / スキップ {sk} / 失敗・中断 {ngc} ===")
print("記録:", LOG)
