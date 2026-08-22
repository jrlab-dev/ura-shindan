"""
ウラ性格診断：16タイプ個別ページ生成スクリプト
  honne/index.html と renai/index.html の TYPES 定義を読み取り、
  /type/{CODE}/index.html （16枚）と /type/index.html（図鑑）を生成する。
  既存ファイルは一切書き換えない（type/ 配下と sitemap.xml のみ）。
"""
import re, sys, io, os, json
from string import Template

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = r"C:\Claude Code\ウェブサイト\ura-shindan"
SITE = "https://ura.jr-genius.jp"
ORDER = ["INTJ","INTP","ENTJ","ENTP","INFJ","INFP","ENFJ","ENFP",
         "ISTJ","ISFJ","ESTJ","ESFJ","ISTP","ISFP","ESTP","ESFP"]

# ------------------------------------------------------------------
# 1) TYPES を JS から抽出
# ------------------------------------------------------------------
def parse_types(path):
    src = open(path, encoding="utf-8").read()
    m = re.search(r"const TYPES = \{(.*?)\n\};", src, re.S)
    if not m:
        raise RuntimeError(f"TYPES が見つかりません: {path}")
    body = m.group(1)
    out = {}
    # 各タイプのブロックを切り出す
    for tm in re.finditer(r"(\b[EI][NS][TF][JP])\s*:\s*\{(.*?)\}\s*(?:,|\s*$)", body, re.S):
        code, blk = tm.group(1), tm.group(2)
        d = {}
        for km in re.finditer(r"(\w+)\s*:\s*'((?:[^'\\]|\\.)*)'", blk):
            d[km.group(1)] = km.group(2)
        am = re.search(r"aru\s*:\s*\[(.*?)\]", blk, re.S)
        if am:
            d["aru"] = re.findall(r"'((?:[^'\\]|\\.)*)'", am.group(1))
        out[code] = d
    return out

honne = parse_types(os.path.join(ROOT, "honne", "index.html"))
renai = parse_types(os.path.join(ROOT, "renai", "index.html"))

# 16タイプ全員との相性（_design/相性データ.json）
AISHO_PATH = os.path.join(ROOT, "_design", "相性データ.json")
with open(AISHO_PATH, encoding="utf-8") as f:
    AISHO = json.load(f)
for c in ORDER:
    if c not in AISHO:
        raise RuntimeError(f"相性データに {c} がありません")
    for t in ORDER:
        if t not in AISHO[c]:
            raise RuntimeError(f"相性データ {c} に相手 {t} がありません")

# 取扱説明書（_design/取扱説明書.json）＝他人視点のセクション。2026-08-11追加
TORIA_PATH = os.path.join(ROOT, "_design", "取扱説明書.json")
with open(TORIA_PATH, encoding="utf-8") as f:
    TORIA = json.load(f)
for c in ORDER:
    if c not in TORIA:
        raise RuntimeError(f"取扱説明書に {c} がありません")
    d = TORIA[c]
    for k in ["lead", "gokai", "jirai", "seikai", "tsukareru"]:
        if not d.get(k):
            raise RuntimeError(f"取扱説明書 {c} に {k} がありません")
    if len(d["gokai"]) != 3 or len(d["jirai"]) != 3 or len(d["seikai"]) != 3:
        raise RuntimeError(f"取扱説明書 {c} の項目数が3件ではありません")

missing = [c for c in ORDER if c not in honne or c not in renai]
if missing:
    raise RuntimeError(f"抽出できなかったタイプ: {missing}")
for c in ORDER:
    need = ["emoji","name","catch","omote","ura","honne","strength","weakness","good","bad","share"]
    for k in need:
        if k not in honne[c] or not honne[c][k]:
            raise RuntimeError(f"honne {c} に {k} がありません")
        if k not in renai[c] or not renai[c][k]:
            raise RuntimeError(f"renai {c} に {k} がありません")
    if len(honne[c].get("aru", [])) < 3 or len(renai[c].get("aru", [])) < 3:
        raise RuntimeError(f"{c} の aru が不足")
print(f"抽出OK: honne {len(honne)}タイプ / renai {len(renai)}タイプ")

# ------------------------------------------------------------------
# 2) 共通CSS
# ------------------------------------------------------------------
CSS = """/* ウラ性格診断 タイプ図鑑 共通スタイル */
:root{
  --desk:#17140f; --paper:#eee3c9; --paper2:#e5d8b8; --paper-line:#c9b78d;
  --kraft:#a5854e; --kraft2:#8a6c3c;
  --ink:#26221a; --ink2:#5c5340; --ink3:#8a7d61;
  --red:#b5121b; --red2:#8e0e15;
}
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{
  background:var(--desk); color:var(--ink);
  font-family:'Shippori Mincho B1',serif; min-height:100vh; overflow-x:hidden;
  -webkit-tap-highlight-color:transparent;
}
body::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(ellipse 90% 70% at 50% 0%, rgba(90,74,48,.20), transparent 65%),
    radial-gradient(ellipse 120% 90% at 50% 110%, rgba(0,0,0,.55), transparent 60%);}
body::after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.5;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.06'/%3E%3C/svg%3E");}
.wrap{position:relative;z-index:2;max-width:720px;margin:0 auto;padding:0 16px 70px;}
.mono{font-family:'IBM Plex Mono',monospace;}

/* パンくず */
.crumb{padding:20px 2px 0;font-size:11.5px;color:#877c63;letter-spacing:.06em;}
.crumb a{color:#a4977b;text-decoration:none;}
.crumb a:hover{color:#d8caa8;}

/* 紙 */
.sheet{
  position:relative; background:var(--paper);
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23p)' opacity='0.05'/%3E%3C/svg%3E");
  border-radius:3px;
  box-shadow:0 1px 0 rgba(255,255,255,.06) inset, 0 18px 50px rgba(0,0,0,.6), 0 4px 14px rgba(0,0,0,.45);
  padding:26px 22px 30px; margin-top:22px;
}
.sheet::before{content:'';position:absolute;inset:10px;border:1px solid rgba(120,100,60,.4);pointer-events:none;border-radius:2px;}
.sheet-head{
  display:flex;justify-content:space-between;align-items:center;gap:10px;
  border-bottom:2px solid var(--ink);padding-bottom:10px;margin-bottom:18px;flex-wrap:wrap;
}
.sheet-head .doc-title{font-weight:800;font-size:14.5px;letter-spacing:.2em;}
.sheet-head .doc-no{font-size:10.5px;color:var(--ink2);letter-spacing:.08em;font-family:'IBM Plex Mono',monospace;}
.chip-secret{
  display:inline-block;border:2px solid var(--red);color:var(--red);
  font-weight:800;font-size:11px;letter-spacing:.3em;padding:3px 8px 3px 11px;
  transform:rotate(-4deg);opacity:.9;
}

/* タイプ見出し */
.type-hero{text-align:center;padding:4px 0 6px;}
.type-hero .emoji{font-size:64px;line-height:1;margin-bottom:8px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.2));}
.type-hero h1 .code{
  font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.3em;color:var(--ink2);
  border:1px solid var(--paper-line);display:block;width:fit-content;margin:0 auto 12px;
  padding:3px 12px 3px 15px;border-radius:2px;font-weight:600;
}
.type-hero h1{font-size:clamp(21px,5.6vw,27px);font-weight:800;letter-spacing:.06em;line-height:1.5;}
.type-hero .catch{margin-top:14px;font-size:14px;line-height:2;color:var(--ink2);}

/* 表と裏 */
.faces{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px;}
@media(max-width:520px){.faces{grid-template-columns:1fr;}}
.face{border:1px solid var(--paper-line);border-radius:2px;padding:14px 14px 16px;background:rgba(255,255,255,.25);}
.face .lbl{font-size:10.5px;letter-spacing:.22em;color:var(--ink3);margin-bottom:8px;font-family:'IBM Plex Mono',monospace;}
.face .txt{font-size:15px;font-weight:800;line-height:1.7;}
.face.ura{background:rgba(181,18,27,.06);border-color:rgba(181,18,27,.35);}
.face.ura .txt{color:var(--red2);}

h2.sec{
  font-size:15px;font-weight:800;letter-spacing:.14em;margin:30px 0 12px;
  border-left:5px solid var(--red);padding-left:10px;
}
h3.sub{font-size:13.5px;font-weight:800;letter-spacing:.1em;color:var(--ink2);margin:20px 0 8px;}
p.body{font-size:14px;line-height:2.05;color:var(--ink);}
p.lead{font-size:12.5px;line-height:1.9;color:var(--ink3);margin:0 0 10px;}

/* 16タイプ全員との相性 */
.aisho-list{display:flex;flex-direction:column;gap:1px;background:rgba(0,0,0,.09);
  border:1px solid rgba(0,0,0,.12);border-radius:4px;overflow:hidden;}
.aisho-list a{
  display:grid;grid-template-columns:34px 30px 1fr;gap:10px;align-items:center;
  background:var(--paper);padding:11px 12px;text-decoration:none;color:inherit;
  transition:background .15s;
}
.aisho-list a:hover{background:rgba(142,14,21,.045);}
.aisho-list .rk{
  font-size:16px;font-weight:800;text-align:center;line-height:1;
  font-family:'Shippori Mincho B1',serif;
}
.aisho-list .rk.r1{color:#2f6b3d;}
.aisho-list .rk.r2{color:var(--ink2);}
.aisho-list .rk.r3{color:#9a7a1e;}
.aisho-list .rk.r4{color:var(--red2);}
.aisho-list .em{font-size:19px;line-height:1;text-align:center;}
.aisho-list .tx .cd{
  font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.14em;
  color:var(--ink3);font-weight:600;
}
.aisho-list .tx .nm{font-size:12.5px;font-weight:800;margin-left:7px;color:var(--ink);}
.aisho-list .tx .ln{font-size:12.5px;line-height:1.8;color:var(--ink);margin-top:3px;}
.aisho-list a.self{background:rgba(0,0,0,.035);}
@media(max-width:420px){
  .aisho-list a{grid-template-columns:26px 24px 1fr;gap:7px;padding:10px 9px;}
  .aisho-list .tx .ln{font-size:12px;}
}
p.body + p.body{margin-top:.9em;}
ul.aru{list-style:none;margin-top:6px;}
ul.aru li{
  position:relative;padding-left:24px;font-size:13.5px;line-height:1.95;margin:.5em 0;color:var(--ink);
}
ul.aru li::before{
  content:'☑';position:absolute;left:0;top:0;color:var(--red);font-size:13px;
}
.sw{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px;}
@media(max-width:520px){.sw{grid-template-columns:1fr;}}
.sw .box{border:1px solid var(--paper-line);border-radius:2px;padding:13px 14px;background:rgba(255,255,255,.25);}
.sw .box .lbl{font-size:10.5px;letter-spacing:.2em;color:var(--ink3);margin-bottom:7px;font-family:'IBM Plex Mono',monospace;}
.sw .box p{font-size:13.5px;line-height:1.95;}

/* 相性 */
.match{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px;}
@media(max-width:520px){.match{grid-template-columns:1fr;}}
.match a{
  display:block;text-decoration:none;color:var(--ink);border:1px solid var(--paper-line);
  border-radius:2px;padding:14px;background:rgba(255,255,255,.3);transition:transform .15s;
  text-align:center;
}
.match a:hover{transform:translateY(-2px);}
.match .lbl{font-size:11px;letter-spacing:.16em;margin-bottom:8px;font-weight:800;}
.match a.good{border-color:rgba(47,107,61,.45);}
.match a.good .lbl{color:#2f6b3d;}
.match a.bad{border-color:rgba(142,14,21,.4);}
.match a.bad .lbl{color:var(--red2);}
.match .emoji{font-size:30px;line-height:1;}
.match .nm{font-size:14px;font-weight:800;margin-top:6px;line-height:1.6;}
.match .cd{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ink3);letter-spacing:.14em;margin-top:4px;}

/* 引用（心の声） */
.voice{
  margin-top:16px;border-left:4px solid var(--red);background:rgba(181,18,27,.05);
  padding:12px 14px;font-size:14.5px;font-weight:800;line-height:1.9;color:var(--red2);
}

/* CTA */
.cta{margin-top:26px;text-align:center;}
.cta .btn{
  display:inline-block;background:linear-gradient(160deg,#c0161f,#8e0e15);color:#f7ecd4;
  font-weight:800;font-size:14px;letter-spacing:.08em;border-radius:3px;padding:15px 30px;
  text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,.35);
}
.cta .btn:hover{filter:brightness(1.08);}
.cta .btn.sub{background:transparent;color:var(--ink);border:2px solid var(--ink2);box-shadow:none;}
.cta .note{margin-top:10px;font-size:11.5px;color:var(--ink3);}
.cta .row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}

/* 一覧グリッド */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:16px;}
.grid a{
  display:block;text-decoration:none;color:var(--ink);text-align:center;
  border:1px solid var(--paper-line);border-radius:2px;padding:14px 8px;background:rgba(255,255,255,.28);
  transition:transform .15s,background .15s;
}
.grid a:hover{transform:translateY(-2px);background:rgba(255,255,255,.5);}
.grid .em{font-size:30px;line-height:1;}
.grid .cd{font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.16em;color:var(--ink3);margin-top:6px;}
.grid .nm{font-size:12.5px;font-weight:800;line-height:1.5;margin-top:4px;}
.grid a.cur{background:rgba(181,18,27,.1);border-color:var(--red);}

/* フッター */
footer{text-align:center;padding:44px 18px 10px;position:relative;z-index:2;}
.foot-links{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-bottom:14px;}
.foot-links a{color:#877c63;font-size:12px;text-decoration:none;letter-spacing:.06em;}
.foot-links a:hover{color:#b9ad8f;}
.foot-copy{font-family:'IBM Plex Mono',monospace;letter-spacing:.3em;font-size:10.5px;color:#6b634e;}
.foot-note{margin-top:10px;font-size:10.5px;color:#6b634e;line-height:1.8;max-width:480px;margin-left:auto;margin-right:auto;}

/* ============ 取扱説明書（他人視点） ============ */
.gokai{display:flex;flex-direction:column;gap:11px;margin-top:12px;}
.gokai .g{border:1px solid var(--paper-line);border-radius:2px;
  background:rgba(255,255,255,.25);padding:13px 15px;}
.gokai .mie{
  font-size:13.5px;font-weight:800;line-height:1.75;color:var(--ink2);
  position:relative;padding-left:30px;
}
.gokai .mie::before{
  content:'噂';position:absolute;left:0;top:1px;
  font-size:9.5px;font-weight:800;letter-spacing:.1em;color:var(--ink3);
  border:1px solid var(--paper-line);border-radius:2px;padding:2px 5px;line-height:1;
}
.gokai .jitsu{
  margin-top:9px;padding-top:9px;border-top:1px dashed var(--paper-line);
  font-size:13.5px;line-height:1.95;position:relative;padding-left:30px;
}
.gokai .jitsu::before{
  content:'実';position:absolute;left:0;top:11px;
  font-size:9.5px;font-weight:800;letter-spacing:.1em;color:#fff;background:var(--red);
  border-radius:2px;padding:2px 5px;line-height:1;
}
ul.dont,ul.do{list-style:none;margin-top:9px;}
ul.dont li,ul.do li{position:relative;padding-left:27px;margin:.85em 0;}
ul.dont li::before{content:'✕';position:absolute;left:3px;top:1px;color:var(--red);font-weight:800;font-size:14px;}
ul.do li::before{content:'○';position:absolute;left:2px;top:1px;color:#2f6b3d;font-weight:800;font-size:13px;}
ul.dont li b,ul.do li b{display:block;font-size:13.5px;font-weight:800;line-height:1.75;}
ul.dont li span,ul.do li span{display:block;font-size:13px;line-height:1.95;color:var(--ink2);margin-top:4px;}
.tsukare{
  margin-top:20px;border-top:1px solid var(--paper-line);padding-top:15px;
  font-size:13.5px;line-height:2.05;color:var(--ink2);
}
"""

# ------------------------------------------------------------------
# 3) 部品
# ------------------------------------------------------------------
GA = """<script async src="https://www.googletagmanager.com/gtag/js?id=G-6DCT8VYEFM"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-6DCT8VYEFM');</script>"""

FONTS = """<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;600&family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">"""

FOOTER = """<footer>
    <div class="foot-links">
      <a href="/">トップ</a>
      <a href="/type/">16タイプ図鑑</a>
      <a href="/pair/">相性ペア一覧</a>
      <a href="/honne/">本音タイプ診断</a>
      <a href="/renai/">恋愛の本音診断</a>
      <a href="/aisho/">本音の相性診断</a>
      <a href="/money/">お金のウラ診断</a>
      <a href="/unei/">運営・免責</a>
      <a href="/privacy/">プライバシー</a>
    </div>
    <p class="foot-copy">URA SHINDAN &mdash;&mdash; CONFIDENTIAL</p>
    <p class="foot-note">本サイトの診断はすべてエンタメコンテンツです。科学的・医学的な根拠を示すものではありません。結果は楽しむためのものとしてご利用ください。</p>
  </footer>"""

def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))

def grid_html(current=None):
    cells = []
    for c in ORDER:
        t = honne[c]
        cur = " cur" if c == current else ""
        cells.append(
            f'<a class="cell{cur}" href="/type/{c}/"><div class="em">{t["emoji"]}</div>'
            f'<div class="cd">{c}</div><div class="nm">{esc(t["name"])}</div></a>'
        )
    return '<div class="grid">\n      ' + "\n      ".join(cells) + "\n    </div>"


RANK_CLS = {"◎": "r1", "○": "r2", "△": "r3", "×": "r4"}
# 噛み合う順に並べる（◎→○→△→×）。同ランク内はORDER順
RANK_SORT = {"◎": 0, "○": 1, "△": 2, "×": 3}


def aisho_html(code):
    """そのタイプから見た16タイプ全員との相性を、相性のいい順に並べて返す"""
    rows = sorted(ORDER, key=lambda t: (RANK_SORT[AISHO[code][t][0]], ORDER.index(t)))
    out = []
    for t in rows:
        rank, line = AISHO[code][t]
        h = honne[t]
        self_cls = " self" if t == code else ""
        nm = esc(h["name"]) + ("（自分と同じタイプ）" if t == code else "")
        out.append(
            f'      <a class="{self_cls.strip() or "row"}" href="/type/{t}/">'
            f'<div class="rk {RANK_CLS[rank]}">{rank}</div>'
            f'<div class="em">{h["emoji"]}</div>'
            f'<div class="tx"><span class="cd">{t}</span><span class="nm">{nm}</span>'
            f'<div class="ln">{esc(line)}</div></div></a>'
        )
    return "\n".join(out)

def pair_links_html(code):
    """そのタイプが含まれる相性ペアの専用ページへのリンク（2026-08-16追加）

    ⚠️ペアが1組も無いときは空文字を返す。相性ペア.json が無くても壊れない作りにしてある。
    """
    path = os.path.join(ROOT, "_design", "相性ペア.json")
    if not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8") as f:
        pairs = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    mine = sorted(k for k in pairs if code in k.split("-"))
    if not mine:
        return ""
    cells = []
    for k in mine:
        a, b = k.split("-")
        other = b if a == code else a
        h = honne[other]
        cells.append(
            f'      <a class="row" href="/pair/{k}/">'
            f'<div class="rk {RANK_CLS[pairs[k]["hantei"]]}">{pairs[k]["hantei"]}</div>'
            f'<div class="em">{h["emoji"]}</div>'
            f'<div class="tx"><span class="cd">{other}</span>'
            f'<span class="nm">{esc(pairs[k]["catch"])}</span>'
            f'<div class="ln">{code}と{other}の相性をくわしく読む</div></div></a>'
        )
    return ('\n    <h3 class="sub">くわしい相性ページがある組み合わせ</h3>\n'
            f'    <p class="lead">{code}を含む組み合わせのうち、'
            'お互いから見た本音まで掘り下げたページです。</p>\n'
            '    <div class="aisho-list">\n' + "\n".join(cells) + "\n    </div>\n")


def toriatsukai_html(code):
    """取扱説明書セクションの中身（誤解3つ・地雷3つ・正解3つ）を組み立てる"""
    d = TORIA[code]
    g = "\n".join(
        f'      <div class="g"><div class="mie">{esc(x["mie"])}</div>'
        f'<div class="jitsu">{esc(x["jitsu"])}</div></div>'
        for x in d["gokai"])
    dont = "\n".join(
        f'      <li><b>{esc(x["nani"])}</b><span>{esc(x["naze"])}</span></li>'
        for x in d["jirai"])
    do = "\n".join(
        f'      <li><b>{esc(x["nani"])}</b><span>{esc(x["naze"])}</span></li>'
        for x in d["seikai"])
    return d, g, dont, do


# ------------------------------------------------------------------
# 4) 個別ページのテンプレート
# ------------------------------------------------------------------
PAGE = Template("""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>$title</title>
<meta name="description" content="$desc">
<link rel="canonical" href="$url">

<meta property="og:type" content="article">
<meta property="og:title" content="$ogtitle">
<meta property="og:description" content="$ogdesc">
<meta property="og:url" content="$url">
<meta property="og:image" content="$SITE/ogp/honne.png">
<meta property="og:site_name" content="ウラ性格診断">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="$ogtitle">
<meta name="twitter:description" content="$ogdesc">
<meta name="twitter:image" content="$SITE/ogp/honne.png">

$GA

$FONTS
<link rel="stylesheet" href="/type/file.css">
<script type="application/ld+json">$jsonld</script>
</head>
<body>
<div class="wrap">

  <nav class="crumb"><a href="/">ウラ性格診断</a> ＞ <a href="/type/">16タイプ図鑑</a> ＞ $code</nav>

  <article class="sheet">
    <div class="sheet-head">
      <span class="doc-title">裏人格調査報告書</span>
      <span class="doc-no">FILE No.$no ／ $code</span>
    </div>

    <div class="type-hero">
      <div class="emoji">$emoji</div>
      <h1><span class="code">$code</span>$name</h1>
      <p class="catch">$catch</p>
    </div>

    <div class="faces">
      <div class="face">
        <div class="lbl">OMOTE ／ 表の顔</div>
        <div class="txt">$omote</div>
      </div>
      <div class="face ura">
        <div class="lbl">URA ／ 裏の本音</div>
        <div class="txt">$ura</div>
      </div>
    </div>

    <h2 class="sec">$nameの、本当のところ</h2>
    <p class="body">$honne_txt</p>

    <h2 class="sec">$code あるある</h2>
    <ul class="aru">
$aru_li
    </ul>

    <h2 class="sec">強みと、弱点</h2>
    <div class="sw">
      <div class="box"><div class="lbl">STRENGTH ／ 強み</div><p>$strength</p></div>
      <div class="box"><div class="lbl">WEAKNESS ／ 弱点</div><p>$weakness</p></div>
    </div>

    <div class="cta">
      <a class="btn" href="/honne/">裏の顔を診断する（12問・無料）</a>
      <p class="note">※ このページは $code の解説です。自分のタイプが分からない方は診断からどうぞ。</p>
    </div>
  </article>

  <article class="sheet">
    <div class="sheet-head">
      <span class="doc-title">恋愛時の追加調査</span>
      <span class="chip-secret">極秘</span>
    </div>

    <h2 class="sec">恋をすると、$codeはこうなる</h2>
    <p class="body">$r_catch</p>
    <div class="voice">$r_ura</div>
    <p class="body">$r_honne</p>

    <h3 class="sub">恋愛中の あるある</h3>
    <ul class="aru">
$r_aru_li
    </ul>

    <div class="sw">
      <div class="box"><div class="lbl">恋人としての強み</div><p>$r_strength</p></div>
      <div class="box"><div class="lbl">恋の落とし穴</div><p>$r_weakness</p></div>
    </div>

    <div class="cta">
      <a class="btn" href="/renai/">恋愛版を診断する（8問・無料）</a>
    </div>
  </article>

  <article class="sheet">
    <div class="sheet-head">
      <span class="doc-title">相性判定</span>
      <span class="doc-no">COMPATIBILITY</span>
    </div>

    <h2 class="sec">$codeと相性がいい／悪いタイプ</h2>
    <div class="match">
      <a class="good" href="/type/$good/">
        <div class="lbl">◎ 相性がいい</div>
        <div class="emoji">$good_emoji</div>
        <div class="nm">$good_name</div>
        <div class="cd">$good</div>
      </a>
      <a class="bad" href="/type/$bad/">
        <div class="lbl">△ ぶつかりやすい</div>
        <div class="emoji">$bad_emoji</div>
        <div class="nm">$bad_name</div>
        <div class="cd">$bad</div>
      </a>
    </div>

    <h3 class="sub">16タイプ全員との相性</h3>
    <p class="lead">$codeから見た、それぞれのタイプとの距離。◎は噛み合う相手、×は消耗する相手。</p>
    <div class="aisho-list">
$aisho_rows
    </div>
$pair_links
    <div class="cta">
      <a class="btn sub" href="/aisho/">ふたりの「裏の相性」を判定する</a>
    </div>
  </article>

  <article class="sheet">
    <div class="sheet-head">
      <span class="doc-title">取扱説明書</span>
      <span class="chip-secret">取扱注意</span>
    </div>

    <h2 class="sec">$codeの取扱説明書（周りの人へ）</h2>
    <p class="body">$t_lead</p>

    <h3 class="sub">周りからは、こう見えている</h3>
    <div class="gokai">
$t_gokai
    </div>

    <h3 class="sub">やってはいけない、3つのこと</h3>
    <ul class="dont">
$t_dont
    </ul>

    <h3 class="sub">こうすると、うまくいく</h3>
    <ul class="do">
$t_do
    </ul>

    <p class="tsukare">$t_tsukareru</p>

    <div class="cta">
      <a class="btn sub" href="/aisho/">その人との相性を判定する</a>
    </div>
  </article>

  <section class="sheet">
    <div class="sheet-head">
      <span class="doc-title">他のタイプを見る</span>
      <span class="doc-no">16 TYPES</span>
    </div>
    $grid
  </section>

$FOOTER
</div>
</body>
</html>
""")

INDEX = Template("""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>裏の顔・16タイプ図鑑｜表の顔と裏の本音の一覧 - ウラ性格診断</title>
<meta name="description" content="ウラ性格診断の16タイプ一覧。INTJ〜ESFPまで、それぞれの「表の顔」と「裏の本音」、あるある、強み・弱点、恋愛のとき、相性のいいタイプまでを1ページずつ解説しています。">
<link rel="canonical" href="$SITE/type/">

<meta property="og:type" content="website">
<meta property="og:title" content="裏の顔・16タイプ図鑑｜ウラ性格診断">
<meta property="og:description" content="16タイプそれぞれの「表の顔」と「裏の本音」。あるある・強み弱点・恋愛・相性まで。">
<meta property="og:url" content="$SITE/type/">
<meta property="og:image" content="$SITE/ogp/top.png">
<meta property="og:site_name" content="ウラ性格診断">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="裏の顔・16タイプ図鑑｜ウラ性格診断">
<meta name="twitter:description" content="16タイプそれぞれの「表の顔」と「裏の本音」を解説。">
<meta name="twitter:image" content="$SITE/ogp/top.png">

$GA

$FONTS
<link rel="stylesheet" href="/type/file.css">
<script type="application/ld+json">$jsonld</script>
</head>
<body>
<div class="wrap">

  <nav class="crumb"><a href="/">ウラ性格診断</a> ＞ 16タイプ図鑑</nav>

  <section class="sheet">
    <div class="sheet-head">
      <span class="doc-title">裏の顔・16タイプ図鑑</span>
      <span class="chip-secret">極秘</span>
    </div>
    <p class="body">人には、表の顔と裏の本音があります。ここでは16タイプそれぞれについて、周りから見えている<b>表の顔</b>と、本人しか知らない<b>裏の本音</b>を、調査報告書の形でまとめました。</p>
    <p class="body">あるある・強みと弱点・恋をしたときの変化・相性のいいタイプまで、1タイプずつ読めます。自分のタイプが分からない方は、まず12問の診断からどうぞ。</p>
    <div class="cta">
      <div class="row">
        <a class="btn" href="/honne/">裏の顔を診断する（12問・無料）</a>
        <a class="btn sub" href="/renai/">恋愛版を診断する（8問）</a>
      </div>
    </div>
  </section>

  <section class="sheet">
    <div class="sheet-head">
      <span class="doc-title">タイプ一覧</span>
      <span class="doc-no">16 TYPES</span>
    </div>
    $grid
  </section>

  <section class="sheet">
    <div class="sheet-head">
      <span class="doc-title">表の顔と裏の本音・早見表</span>
      <span class="doc-no">QUICK REFERENCE</span>
    </div>
$rows
  </section>

$FOOTER
</div>
</body>
</html>
""")

# ------------------------------------------------------------------
# 5) 生成
# ------------------------------------------------------------------
os.makedirs(os.path.join(ROOT, "type"), exist_ok=True)
with open(os.path.join(ROOT, "type", "file.css"), "w", encoding="utf-8", newline="\n") as f:
    f.write(CSS)

written = []
for i, code in enumerate(ORDER, 1):
    h, r = honne[code], renai[code]
    no = f"{i:02d}"
    title = f'【{code}】{h["name"]}｜16タイプ全員との相性・あるある・裏の本音 - ウラ性格診断'
    desc = (f'{code}「{h["name"]}」の表の顔は{h["omote"]}。裏の本音は「{h["ura"]}」。'
            f'あるある・強みと弱点・恋愛のとき、そして16タイプ全員との相性まで、調査報告書として開示します。')
    ogtitle = f'【{code}】{h["name"]}｜表の顔と、裏の本音'
    ogdesc = h["catch"]

    jsonld = json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Article",
                "headline": f'【{code}】{h["name"]}の裏の顔',
                "description": h["catch"],
                "inLanguage": "ja",
                "mainEntityOfPage": f"{SITE}/type/{code}/",
                "image": f"{SITE}/ogp/honne.png",
                "dateModified": "2026-08-01",
                "author": {"@type": "Organization", "name": "ウラ性格診断"},
                "publisher": {"@type": "Organization", "name": "ウラ性格診断"}
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "ウラ性格診断", "item": f"{SITE}/"},
                    {"@type": "ListItem", "position": 2, "name": "16タイプ図鑑", "item": f"{SITE}/type/"},
                    {"@type": "ListItem", "position": 3, "name": f'{code} {h["name"]}'}
                ]
            }
        ]
    }, ensure_ascii=False, indent=None)

    aru_li = "\n".join(f"      <li>{esc(a)}</li>" for a in h["aru"])
    r_aru_li = "\n".join(f"      <li>{esc(a)}</li>" for a in r["aru"])
    t_d, t_g, t_dont, t_do = toriatsukai_html(code)

    html = PAGE.substitute(
        SITE=SITE, GA=GA, FONTS=FONTS, FOOTER=FOOTER,
        title=esc(title), desc=esc(desc), ogtitle=esc(ogtitle), ogdesc=esc(ogdesc),
        url=f"{SITE}/type/{code}/", jsonld=jsonld,
        code=code, no=no, emoji=h["emoji"], name=esc(h["name"]), catch=esc(h["catch"]),
        omote=esc(h["omote"]), ura=esc(h["ura"]), honne_txt=esc(h["honne"]),
        aru_li=aru_li, strength=esc(h["strength"]), weakness=esc(h["weakness"]),
        r_catch=esc(r["catch"]), r_ura=esc(f'「{r["ura"]}」' if not r["ura"].startswith("「") else r["ura"]),
        r_honne=esc(r["honne"]), r_aru_li=r_aru_li,
        r_strength=esc(r["strength"]), r_weakness=esc(r["weakness"]),
        good=h["good"], good_emoji=honne[h["good"]]["emoji"], good_name=esc(honne[h["good"]]["name"]),
        bad=h["bad"], bad_emoji=honne[h["bad"]]["emoji"], bad_name=esc(honne[h["bad"]]["name"]),
        aisho_rows=aisho_html(code), pair_links=pair_links_html(code),
        t_lead=esc(t_d["lead"]), t_gokai=t_g, t_dont=t_dont, t_do=t_do,
        t_tsukareru=esc(t_d["tsukareru"]),
        grid=grid_html(code),
    )
    d = os.path.join(ROOT, "type", code)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    written.append(f"type/{code}/index.html")

# 一覧ページ
rows = []
for code in ORDER:
    h = honne[code]
    rows.append(
        f'    <h3 class="sub">{h["emoji"]} {code}｜<a href="/type/{code}/" style="color:#8e0e15;text-decoration:none">{esc(h["name"])}</a></h3>\n'
        f'    <p class="body">表の顔は「{esc(h["omote"])}」。裏の本音は「{esc(h["ura"])}」。{esc(h["catch"])}</p>'
    )
idx_jsonld = json.dumps({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "ウラ性格診断", "item": f"{SITE}/"},
        {"@type": "ListItem", "position": 2, "name": "16タイプ図鑑", "item": f"{SITE}/type/"}
    ]
}, ensure_ascii=False)
with open(os.path.join(ROOT, "type", "index.html"), "w", encoding="utf-8", newline="\n") as f:
    f.write(INDEX.substitute(SITE=SITE, GA=GA, FONTS=FONTS, FOOTER=FOOTER,
                             grid=grid_html(), rows="\n".join(rows), jsonld=idx_jsonld))
written.append("type/index.html")

# ------------------------------------------------------------------
# 6) sitemap.xml を更新
# ------------------------------------------------------------------
# 🚨 2026-08-16：URLの管理を site_urls.py に一本化した。
#    理由＝gen_pair_pages.py も sitemap.xml を作り直すため、ここが独自のリストを持っていると
#    このスクリプトを実行した瞬間に /pair/ の全ページがサイトマップから消える。
#    （2026-08-11に潰した「noindexページが復活する罠」と同じ構造の事故）
#    ⚠️/unei/ と /privacy/ を入れない決まりも site_urls.py 側に引き継いである。
import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import site_urls as _su

_url_count = _su.write_sitemap(ROOT)

print(f"生成: {len(written)} ファイル + file.css + sitemap.xml（{_url_count}URL）")

# ------------------------------------------------------------------
# 7) トップページに「16タイプ図鑑」への導線を差し込む（何度実行しても同じ結果）
# ------------------------------------------------------------------
TOP_CSS = """
/* ============ 16タイプ図鑑への導線 ============ */
.type-lead{font-size:13px;line-height:1.95;color:var(--ink2);}
.type-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:16px;}
.type-grid a{display:block;text-decoration:none;color:var(--ink);text-align:center;border:1px solid var(--paper-line);border-radius:2px;padding:12px 6px;background:rgba(255,255,255,.28);transition:transform .15s,background .15s;}
.type-grid a:hover{transform:translateY(-2px);background:rgba(255,255,255,.5);}
.type-grid .em{font-size:26px;line-height:1;}
.type-grid .cd{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.16em;color:var(--ink3);margin-top:5px;}
.type-grid .nm{font-size:12px;font-weight:800;line-height:1.5;margin-top:3px;}
.type-more{margin-top:18px;text-align:center;}
.type-more a{color:var(--red2);font-weight:800;font-size:13px;text-decoration:none;letter-spacing:.06em;}
.type-more a:hover{text-decoration:underline;}
"""

cells = []
for c in ORDER:
    t = honne[c]
    cells.append(f'<a href="/type/{c}/"><div class="em">{t["emoji"]}</div>'
                 f'<div class="cd">{c}</div><div class="nm">{esc(t["name"])}</div></a>')
TOP_SEC = ("""  <!-- TYPE-INDEX:START -->
  <section class="sheet">
    <div class="sheet-head">
      <span class="doc-title">裏の顔・16タイプ図鑑</span>
      <span class="chip-secret">極秘</span>
    </div>
    <p class="type-lead">16タイプそれぞれの「表の顔」と「裏の本音」を、1タイプずつ調査報告書にまとめました。あるある・強みと弱点・恋をしたときの変化・相性まで、診断しなくても読めます。</p>
    <div class="type-grid">
      """ + "\n      ".join(cells) + """
    </div>
    <p class="type-more"><a href="/type/">▶ 16タイプ図鑑をまとめて見る</a></p>
  </section>
  <!-- TYPE-INDEX:END -->
""")

top_path = os.path.join(ROOT, "index.html")
top = open(top_path, encoding="utf-8").read()

# CSS（マーカーで冪等化）
if "/* ============ 16タイプ図鑑への導線 ============ */" in top:
    top = re.sub(r"\n/\* =+ 16タイプ図鑑への導線 =+ \*/.*?(?=\n/\* =+ フッター)", TOP_CSS, top, flags=re.S)
else:
    top = top.replace("\n/* ============ フッター ============ */", TOP_CSS + "\n/* ============ フッター ============ */")

# セクション（マーカーで冪等化）
if "<!-- TYPE-INDEX:START -->" in top:
    top = re.sub(r"  <!-- TYPE-INDEX:START -->.*?  <!-- TYPE-INDEX:END -->\n", TOP_SEC, top, flags=re.S)
else:
    anchor = '  <section class="sheet why-sheet">'
    if anchor not in top:
        raise RuntimeError("トップページの差し込み位置が見つかりません")
    top = top.replace(anchor, TOP_SEC + "\n" + anchor, 1)

# フッターリンク
if 'href="/type/">16タイプ図鑑' not in top:
    top = top.replace('      <a href="/honne/">本音タイプ診断</a>',
                      '      <a href="/type/">16タイプ図鑑</a>\n      <a href="/honne/">本音タイプ診断</a>', 1)

with open(top_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(top)
print("トップページ更新: 16タイプ図鑑セクション＋フッターリンク")
