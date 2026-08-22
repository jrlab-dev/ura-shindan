# -*- coding: utf-8 -*-
"""タイプ×タイプの相性ページを生成する（2026-08-16新設）

  正本データ  : _design/相性ペア.json（手でHTMLを直さない）
  タイプの名前: honne/index.html の const TYPES から読む
  出力        : /pair/<A-B>/index.html ・ /pair/index.html ・ /pair/pair.css
  sitemap     : site_urls.write_sitemap() に任せる（URLの管理を1か所に集約）

  python gen_pair_pages.py            生成する
  python gen_pair_pages.py --dry      何を作るかだけ表示する
"""
import sys, io, os, re, json, html
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import site_urls

ROOT = r"C:\Claude Code\ウェブサイト\ura-shindan"
SITE = "https://ura.jr-genius.jp"
GA = "G-6DCT8VYEFM"
DRY = "--dry" in sys.argv
TODAY = "2026-08-16"

MARK_NAME = {"◎": "とても良い", "○": "良い", "△": "すれ違いやすい", "×": "噛み合いにくい"}
MARK_CLASS = {"◎": "m-best", "○": "m-good", "△": "m-mid", "×": "m-bad"}


# ---------------------------------------------------------------- タイプ情報
def parse_types(path):
    src = open(path, encoding="utf-8").read()
    m = re.search(r"const TYPES = \{(.*?)\n\};", src, re.S)
    if not m:
        raise RuntimeError(f"TYPES が見つかりません: {path}")
    out = {}
    for tm in re.finditer(r"(\b[EI][NS][TF][JP])\s*:\s*\{(.*?)\}\s*(?:,|\s*$)", m.group(1), re.S):
        code, blk = tm.group(1), tm.group(2)
        d = {}
        for km in re.finditer(r"(\w+)\s*:\s*'((?:[^'\\]|\\.)*)'", blk):
            d[km.group(1)] = km.group(2).replace("\\'", "'")
        out[code] = d
    return out


TYPES = parse_types(os.path.join(ROOT, "honne", "index.html"))
with open(os.path.join(ROOT, "_design", "相性ペア.json"), encoding="utf-8") as f:
    PAIRS = json.load(f)
PAIRS = {k: v for k, v in PAIRS.items() if not k.startswith("_")}

e = lambda s: html.escape(str(s), quote=True)


# ---------------------------------------------------------------- CSS（追加分のみ）
CSS = """/* 相性ペアページ 追加スタイル（/type/file.css を読み込んだ上で使う） */
.pair-hero{text-align:center;padding:26px 10px 20px;}
/* ⚠️スマホで縦に割れないよう nowrap ＋ min-width:0 で縮ませる（2026-08-16に実物を見て修正） */
.pair-faces{display:flex;align-items:flex-start;justify-content:center;gap:8px;flex-wrap:nowrap;}
.pf{flex:1 1 0;text-align:center;min-width:0;max-width:160px;}
.pf .em{font-size:38px;line-height:1.1;}
.pf .cd{font-family:'IBM Plex Mono',monospace;font-size:16.5px;font-weight:600;
        letter-spacing:.06em;color:var(--ink);margin-top:2px;}
.pf .nm{font-size:11px;color:var(--ink3);margin-top:3px;line-height:1.5;}
.pf a{text-decoration:none;color:inherit;display:block;}
.pf a:hover .cd{color:var(--red);}
.pair-x{flex:0 0 auto;font-size:20px;color:var(--kraft2);font-weight:700;padding-top:14px;}
.pair-hero h1{font-size:20px;margin:18px 0 6px;letter-spacing:.02em;line-height:1.6;}
.pair-hero .catch{font-size:14px;color:var(--ink2);line-height:1.9;margin-top:6px;}

.verdict{display:flex;align-items:center;justify-content:center;gap:12px;
         margin:18px auto 4px;padding:12px 18px;max-width:420px;
         border:1px solid var(--paper-line);background:rgba(255,255,255,.22);}
.verdict .mk{font-size:32px;line-height:1;font-weight:700;}
.verdict .lb{font-size:13px;color:var(--ink2);letter-spacing:.08em;}
/* 判定記号は一覧の要。薄いと読めないので濃くする（2026-08-16に実物を見て調整） */
.m-best{color:#b5121b;} .m-good{color:#5f7d3a;} .m-mid{color:#9a6a1e;} .m-bad{color:#6b4a4a;}
.kataomoi{display:inline-block;margin:10px auto 0;padding:5px 12px;font-size:11.5px;
          letter-spacing:.08em;color:#fff;background:var(--red2);}

.mikata{display:grid;gap:12px;margin-top:6px;}
.mikata .mi{border-left:3px solid var(--kraft);padding:10px 14px;background:rgba(255,255,255,.14);}
.mikata .mi .who{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;
                 letter-spacing:.06em;color:var(--red);margin-bottom:5px;}
.mikata .mi p{font-size:14px;line-height:1.95;color:var(--ink);}

.plist{display:grid;gap:14px;}
.plist .it .nani{font-size:14.5px;font-weight:700;color:var(--ink);margin-bottom:4px;line-height:1.6;}
.plist .it .naze{font-size:13.5px;line-height:1.95;color:var(--ink2);}
.plist.ng .it .nani::before{content:"▲ ";color:var(--red);font-size:12px;}
.plist.ok .it .nani::before{content:"○ ";color:#7d6a2f;font-weight:700;}

.ptext{font-size:14px;line-height:2.0;color:var(--ink);}
.pair-links{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:8px;}
.pair-links a{display:inline-block;padding:9px 16px;border:1px solid var(--paper-line);
              font-size:13px;color:var(--ink);text-decoration:none;background:rgba(255,255,255,.18);}
.pair-links a:hover{border-color:var(--red);color:var(--red);}

.pair-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px;}
.pair-grid a{display:block;padding:10px 8px 9px;text-align:center;text-decoration:none;
             border:1px solid var(--paper-line);background:rgba(255,255,255,.14);position:relative;}
.pair-grid a:hover{border-color:var(--red);}
.pair-grid .cd{font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;color:var(--ink);}
.pair-grid .mk{font-size:19px;margin-top:2px;line-height:1.2;font-weight:700;}
.pair-grid .ct{font-size:10.5px;color:var(--ink3);margin-top:3px;line-height:1.45;}
.pair-grid .kt{display:inline-block;margin-top:4px;padding:1px 6px;font-size:9.5px;
               letter-spacing:.04em;color:#fff;background:var(--red2);}
/* 一覧の導入文は左揃え（中央揃えだと長文の改行位置が不自然になる。2026-08-16に実物を見て修正） */
.pair-lead{font-size:13.5px;line-height:2.0;color:var(--ink2);text-align:left;padding:2px 2px 4px;}
@media(max-width:420px){
  .pf{min-width:96px;} .pf .em{font-size:34px;} .pair-hero h1{font-size:17.5px;}
}
"""


# ---------------------------------------------------------------- 部品
def head(title, desc, url, jsonld):
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}">

<meta property="og:type" content="article">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/ogp/aisho.png">
<meta property="og:site_name" content="ウラ性格診断">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
<meta name="twitter:image" content="{SITE}/ogp/aisho.png">

<script async src="https://www.googletagmanager.com/gtag/js?id={GA}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','{GA}');</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;600&family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/type/file.css">
<link rel="stylesheet" href="/pair/pair.css">
<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>
</head>
<body>
<div class="wrap">
"""


FOOT = """
<footer>
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
  </footer>
</div>
</body>
</html>
"""


def sec(title, no, inner):
    return f"""
  <section class="sheet">
    <div class="sheet-head">
      <span class="doc-title">{title}</span>
      <span class="doc-no">{no}</span>
    </div>
{inner}
  </section>
"""


def face(code):
    t = TYPES[code]
    return (f'<div class="pf"><a href="/type/{code}/">'
            f'<div class="em">{t.get("emoji","")}</div>'
            f'<div class="cd">{code}</div>'
            f'<div class="nm">{e(t.get("name",""))}</div></a></div>')


# ---------------------------------------------------------------- 1ページ生成
def build_pair(key, p):
    a, b = key.split("-")
    ta, tb = TYPES[a], TYPES[b]
    mark = p["hantei"]
    url = f"{SITE}/pair/{key}/"

    title = f"{a}と{b}の相性｜{p['catch']} - ウラ性格診断"
    desc = (f"{a}と{b}の相性は{mark}（{MARK_NAME[mark]}）。"
            f"{p['lead'][:70]}… 惹かれ合う理由、噛み合わなくなる瞬間、恋愛と仕事、"
            f"長続きさせるコツまで、調査報告書として開示します。")

    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Article",
         "headline": f"{a}と{b}の相性",
         "description": p["lead"][:110],
         "inLanguage": "ja",
         "mainEntityOfPage": url,
         "image": f"{SITE}/ogp/aisho.png",
         "dateModified": TODAY,
         "author": {"@type": "Organization", "name": "ウラ性格診断"},
         "publisher": {"@type": "Organization", "name": "ウラ性格診断"}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "ウラ性格診断", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "相性ペア一覧", "item": f"{SITE}/pair/"},
            {"@type": "ListItem", "position": 3, "name": f"{a} × {b}"}]}]}

    h = [head(title, desc, url, jsonld)]
    h.append(f'  <nav class="crumb"><a href="/">ウラ性格診断</a> ＞ '
             f'<a href="/pair/">相性ペア</a> ＞ {a} × {b}</nav>\n')

    # 見出し
    kata = ('<div style="text-align:center"><span class="kataomoi">'
            '判定が食い違う組み合わせ</span></div>') if p.get("kataomoi") else ""
    hero = f"""
    <div class="pair-hero">
      <div class="pair-faces">
        {face(a)}<span class="pair-x">×</span>{face(b)}
      </div>
      <h1>{a}と{b}の相性</h1>
      <p class="catch">{e(p['catch'])}</p>
      <div class="verdict">
        <span class="mk {MARK_CLASS[mark]}">{mark}</span>
        <span class="lb">総合判定：{MARK_NAME[mark]}</span>
      </div>
      {kata}
    </div>
    <p class="ptext" style="margin-top:16px">{e(p['lead'])}</p>
"""
    h.append(sec("相性照合報告書", f"{a} × {b}", hero))

    # 相手がどう見えるか
    mi = ['    <div class="mikata">']
    for m in p["mikata"]:
        other = b if m["who"] == a else a
        mi.append(f'      <div class="mi"><div class="who">{m["who"]} から見た {other}</div>'
                  f'<p>{e(m["text"])}</p></div>')
    mi.append("    </div>")
    h.append(sec("お互いから、どう見えているか", "MUTUAL VIEW", "\n".join(mi)))

    # 惹かれ合う理由
    hk = ['    <div class="plist ok">']
    for it in p["hikare"]:
        hk.append(f'      <div class="it"><div class="nani">{e(it["nani"])}</div>'
                  f'<div class="naze">{e(it["naze"])}</div></div>')
    hk.append("    </div>")
    h.append(sec("惹かれ合う理由", "WHY", "\n".join(hk)))

    # 噛み合わなくなる瞬間
    ks = ['    <div class="plist ng">']
    for it in p["kishimu"]:
        ks.append(f'      <div class="it"><div class="nani">{e(it["nani"])}</div>'
                  f'<div class="naze">{e(it["naze"])}</div></div>')
    ks.append("    </div>")
    h.append(sec("噛み合わなくなる瞬間", "FRICTION", "\n".join(ks)))

    # 恋愛・仕事
    h.append(sec("恋愛のとき", "LOVE", f'    <p class="ptext">{e(p["renai"])}</p>'))
    h.append(sec("仕事・友人のとき", "WORK & FRIEND", f'    <p class="ptext">{e(p["shigoto"])}</p>'))

    # コツ
    kt = ['    <div class="plist ok">']
    for it in p["kotsu"]:
        kt.append(f'      <div class="it"><div class="nani">{e(it["nani"])}</div>'
                  f'<div class="naze">{e(it["naze"])}</div></div>')
    kt.append("    </div>")
    kt.append(f'    <p class="ptext" style="margin-top:16px">{e(p["shime"])}</p>')
    h.append(sec("長続きさせるコツ", "HOW TO", "\n".join(kt)))

    # 内部リンク
    links = f"""    <div class="pair-links">
      <a href="/type/{a}/">{a} の詳しい解説</a>
      <a href="/type/{b}/">{b} の詳しい解説</a>
      <a href="/aisho/">本音の相性診断をやってみる</a>
      <a href="/pair/">他の組み合わせを見る</a>
    </div>"""
    h.append(sec("あわせて読む", "RELATED", links))

    h.append(FOOT)
    return "".join(h)


# ---------------------------------------------------------------- 一覧ページ
def build_index():
    url = f"{SITE}/pair/"
    title = "MBTI16タイプ 相性ペア一覧｜どの組み合わせが噛み合うのか - ウラ性格診断"
    desc = ("MBTI16タイプの組み合わせ別に、惹かれ合う理由と噛み合わなくなる瞬間を調査。"
            "片方は憧れていて、片方は壁を感じている――判定が食い違う組み合わせも開示します。")
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "name": "相性ペア一覧", "inLanguage": "ja",
         "mainEntityOfPage": url, "dateModified": TODAY},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "ウラ性格診断", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "相性ペア一覧"}]}]}

    h = [head(title, desc, url, jsonld)]
    h.append('  <nav class="crumb"><a href="/">ウラ性格診断</a> ＞ 相性ペア</nav>\n')
    kata = [k for k in PAIRS if PAIRS[k].get("kataomoi")]
    kata_txt = ""
    if kata:
        kata_txt = (f'そのうち<strong>{len(kata)}組は、片方が憧れていて、'
                    f'片方が壁を感じている組み合わせ</strong>でした。')
    lead = f"""
    <div class="pair-hero">
      <h1>相性ペア一覧</h1>
    </div>
    <p class="pair-lead">「合う・合わない」は、たいてい片方だけの感想です。
    同じ二人でも、どちらから見るかで評価がひっくり返ることがあります。{kata_txt}<br>
    惹かれ合う理由と、噛み合わなくなる瞬間を、組み合わせごとに開示しました。</p>
"""
    h.append(sec("相性照合ファイル", f"{len(PAIRS)} PAIRS", lead))

    cells = ['    <div class="pair-grid">']
    for k in sorted(PAIRS):
        a, b = k.split("-")
        p = PAIRS[k]
        badge = '<span class="kt">片思い</span>' if p.get("kataomoi") else ""
        cells.append(f'      <a href="/pair/{k}/"><div class="cd">{a} × {b}</div>'
                     f'<div class="mk {MARK_CLASS[p["hantei"]]}">{p["hantei"]}</div>'
                     f'<div class="ct">{e(p["catch"])}</div>{badge}</a>')
    cells.append("    </div>")
    h.append(sec("組み合わせから探す", "INDEX", "\n".join(cells)))

    h.append(sec("16タイプそれぞれの解説", "TYPES",
                 '    <div class="pair-links">'
                 '<a href="/type/">16タイプ図鑑を見る</a>'
                 '<a href="/aisho/">本音の相性診断をやってみる</a></div>'))
    h.append(FOOT)
    return "".join(h)


# ---------------------------------------------------------------- 実行
def write(path, text):
    if DRY:
        print(f"  [dry] {path}（{len(text)}文字）")
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


print(f"対象ペア: {len(PAIRS)} 組\n")
n = 0
for key in sorted(PAIRS):
    a, b = key.split("-")
    if a not in TYPES or b not in TYPES:
        raise RuntimeError(f"{key}: タイプ名が不正です")
    write(os.path.join(ROOT, "pair", key, "index.html"), build_pair(key, PAIRS[key]))
    n += 1
    print(f"  ✓ /pair/{key}/")

write(os.path.join(ROOT, "pair", "index.html"), build_index())
write(os.path.join(ROOT, "pair", "pair.css"), CSS)
print(f"  ✓ /pair/（一覧）\n  ✓ /pair/pair.css")

if not DRY:
    cnt = site_urls.write_sitemap(ROOT)
    print(f"\n生成: {n}ページ + 一覧 + CSS ／ sitemap.xml を {cnt}URL で更新")
else:
    print("\n[dry] 実際には書き込んでいません")
