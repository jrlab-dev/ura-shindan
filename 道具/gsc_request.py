# -*- coding: utf-8 -*-
"""GSCのURL検査→インデックス登録リクエストを、未登録ページに順に実行する（2026-08-22 第2版）

🚨 第1版からの変更（2026-08-22）
   ① 対象URLのベタ書きをやめた。旧版は相性ページを1本もリクエストできない作りだった
      → site_urls.py（URLの正本）＋ GSC APIの実測から毎回組み立てる
   ② Edgeを外から起動して9222でつなぐ方式をやめた。
      Edge 151 では --remote-debugging-port を付けても DevToolsActivePort が作られず、
      CDP接続が成立しない（2026-08-22に実測）。
      → Playwright自身がプロファイルを開く（launch_persistent_context）
   ③ ログインが切れていたら、画面を開いたまま最大15分待つ。
      準也さんがログインし終えた瞬間から、そのまま自動で続きを実行する

使い方:
    python 道具\\gsc_request.py            # 未登録の全ページ
    python 道具\\gsc_request.py 3          # 先頭3件だけ（試し運転）
    python 道具\\gsc_request.py 10 30      # 10件・ログイン待ちを30分にする

安全のため:
  - 既に登録済み／既にリクエスト済みのページは押さずに飛ばす
  - 1日の割り当てを使い切ったら、そこで止めて残りを報告する
  - 1件ごとに記録を書き出す（途中で止まっても消えない）
"""
import sys, io, json, os, datetime
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
PROFILE = r"C:\Users\user\AppData\Local\Temp\claude-gsc-profile"
GSC_URL = ("https://search.google.com/search-console"
           "?resource_id=https%3A%2F%2Fura.jr-genius.jp%2F")
KEY = (r"C:\Claude Code\ウェブサイト\あそびラボ_プロジェクト\ビックファイブ診断サイト"
       r"\_private\マーケティング\SEO\nifty-harmony-307600-1ada38767743.json")
TODAY = datetime.date.today().isoformat()


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
    """画面上部のURL検査ボックス。⚠placeholderではなくaria-labelにしか名前がない"""
    for i in pg.query_selector_all("input"):
        try:
            if not i.is_visible():
                continue
            lab = (i.get_attribute("placeholder") or "") + " " + (i.get_attribute("aria-label") or "")
            if "URL を検査" in lab:
                return i
        except Exception:
            continue
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
    try:
        pg.evaluate("""() => {
          document.querySelectorAll('trans-layer, .KL4X6e, .TuA45b').forEach(e => e.remove());
          document.documentElement.setAttribute('translate', 'no');
        }""")
    except Exception:
        pass


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


def wait_login(pg, minutes):
    """ログインが済んで検査ボックスが出るまで待つ。済んでいればすぐ返る"""
    tries = int(minutes * 60 / 5)
    for i in range(tries):
        if find_box(pg) is not None:
            return True
        # ログイン後にトップへ流れることがあるので、たまに戻す
        if i and i % 12 == 0 and "search-console" not in pg.url:
            try:
                pg.goto(GSC_URL, wait_until="domcontentloaded")
            except Exception:
                pass
        if i % 12 == 0:
            print(f"  ログイン待ち… {i*5//60}分経過（画面: {pg.url[:70]}）", flush=True)
        pg.wait_for_timeout(5000)
    return False


class Log(list):
    """1件ごとにファイルへ書き出すリスト（途中で止まっても記録が消えない）"""
    def append(self, x):
        super().append(x)
        with open(LOG, "w", encoding="utf-8") as f:
            json.dump(list(self), f, ensure_ascii=False, indent=1)


limit = int(sys.argv[1]) if len(sys.argv) > 1 else 999
wait_min = float(sys.argv[2]) if len(sys.argv) > 2 else 15

try:
    _prev = json.load(open(LOG, encoding="utf-8"))
except Exception:
    _prev = []
results = Log(_prev)
_base = len(results)

# ⚠️ブラウザを先に開く。API実測（42URLで約2分）を先にやると、
#   その間ずっと画面が出ず、ログインする人を待たせてしまう（2026-08-22に実際にそうなった）
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        PROFILE, headless=False, channel="msedge",
        viewport=None, args=["--start-maximized"],
    )
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    print("ブラウザを開いた。Search Console へ移動する", flush=True)
    pg.goto(GSC_URL, wait_until="domcontentloaded")
    pg.wait_for_timeout(6000)

    if find_box(pg) is None:
        print(f"★ ログインが必要です。画面でログインしてください（最大{wait_min:.0f}分待ちます）", flush=True)
        if not wait_login(pg, wait_min):
            print("時間切れ。ログインされませんでした")
            ctx.close()
            sys.exit(1)
    print("✅ Search Console に入れました\n", flush=True)

    print("=== 未登録ページをAPIで実測中（1〜2分かかる）===", flush=True)
    TARGETS = undone_urls()
    print(f"未登録 {len(TARGETS)} 件（今回は先頭 {min(limit, len(TARGETS))} 件を処理）", flush=True)
    TARGETS = TARGETS[:limit]
    for u in TARGETS:
        print("  ", u, flush=True)
    print(flush=True)

    stop = False
    for n, url in enumerate(TARGETS, 1):
        if stop:
            results.append({"date": TODAY, "url": url, "result": "未実行（割り当て切れで中断）"})
            continue

        kill_overlay(pg)
        box = find_box(pg)
        if box is None:
            results.append({"date": TODAY, "url": url, "result": "NG 入力欄が見つからない"})
            print(f"[{n}/{len(TARGETS)}] {url} → NG 入力欄なし", flush=True)
            continue
        box.click(force=True); box.fill(url); box.press("Enter")

        # ⚠️8/1の失敗：前の画面のテキストを読んで誤判定した
        #   → 画面に「今回のURL」が出てから判定する
        key = url[len(SITE):]
        state = ""
        for _ in range(40):
            pg.wait_for_timeout(2000)
            try:
                t = pg.inner_text("body")
            except Exception:
                continue
            if key not in t:
                continue
            if "URL は Google に登録されています" in t:
                state = "登録済み"; break
            if LABEL in t:
                state = "未登録"; break
        if not state:
            results.append({"date": TODAY, "url": url, "result": "NG 検査が終わらない"})
            print(f"[{n}/{len(TARGETS)}] {url} → NG 検査タイムアウト", flush=True)
            continue

        if state == "登録済み":
            results.append({"date": TODAY, "url": url, "result": "スキップ（既に登録済み）"})
            print(f"[{n}/{len(TARGETS)}] {url} → 既に登録済み・スキップ", flush=True)
            continue

        # 既にリクエスト済みならボタンの文言が変わる＝重複リクエストを避けられる
        if find_btn(pg, "インデックス登録をリクエスト再リクエスト") is not None:
            results.append({"date": TODAY, "url": url, "result": "スキップ（既にリクエスト済み）"})
            print(f"[{n}/{len(TARGETS)}] {url} → 既にリクエスト済み・スキップ", flush=True)
            continue

        btn = wait_btn(pg, LABEL)
        if btn is None:
            results.append({"date": TODAY, "url": url, "result": "NG ボタンが出ない"})
            print(f"[{n}/{len(TARGETS)}] {url} → NG ボタンが出ない", flush=True)
            continue

        how = click_hard(pg, btn)
        res = ""
        for _ in range(50):
            pg.wait_for_timeout(3000)
            try:
                t = pg.inner_text("body")
            except Exception:
                continue
            for k in ["インデックス登録をリクエスト済み", "リクエストは正常に", "優先クロール",
                      "1 日の割り当て", "割り当てを使い切", "しばらくしてからもう一度"]:
                if k in t:
                    res = k; break
            if res:
                break
        if "割り当て" in res or "しばらく" in res:
            stop = True
            results.append({"date": TODAY, "url": url, "result": f"中断: {res}"})
            print(f"[{n}/{len(TARGETS)}] {url} → ★{res}（ここで中断）", flush=True)
        else:
            results.append({"date": TODAY, "url": url, "result": res or "押したが判定文なし",
                            "click": how})
            print(f"[{n}/{len(TARGETS)}] {url} → {res or '押したが判定文なし'}（{how}）", flush=True)

        # 完了ダイアログを閉じる（ボタンは「表示しない」。OK・閉じるではない）
        for lab in ["表示しない", "OK", "閉じる", "GOT IT", "確認"]:
            x = find_btn(pg, lab)
            if x is not None:
                click_hard(pg, x); pg.wait_for_timeout(1200); break
        pg.wait_for_timeout(2500)

    try:
        pg.screenshot(path=os.path.join(OUT, f"gsc_request_{TODAY}.png"))
    except Exception:
        pass
    ctx.close()

ok = sum(1 for r in results[_base:] if "リクエスト済み" in r["result"] or "正常" in r["result"] or "優先" in r["result"])
sk = sum(1 for r in results[_base:] if r["result"].startswith("スキップ"))
ngc = sum(1 for r in results[_base:] if r["result"].startswith("NG") or "中断" in r["result"] or "未実行" in r["result"])
print(f"\n=== リクエスト成功 {ok} / スキップ {sk} / 失敗・中断 {ngc} ===")
print("記録:", LOG)
