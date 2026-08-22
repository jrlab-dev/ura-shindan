# -*- coding: utf-8 -*-
"""サイトマップに載せるURLを1か所で管理する（2026-08-16新設）

🚨 なぜ切り出したか
   gen_type_pages.py も gen_pair_pages.py も sitemap.xml を作り直す。
   別々にURLリストを持つと、片方を実行した瞬間にもう片方のページがサイトマップから消える。
   （2026-08-11に「noindexページが復活する罠」を潰した箇所と同じ構造の事故）
   → URLリストはこのファイルだけが持ち、両方のスクリプトがここを呼ぶ。

⚠️ /unei/ と /privacy/ は meta robots=noindex なので絶対に入れない。
   （載せる＝登録してほしいという合図。noindexと矛盾し、GSCで登録リクエストが弾かれる）
"""
import os, json

SITE = "https://ura.jr-genius.jp"
ORDER = ["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP",
         "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"]

# 中身を実際に更新した日（更新していないページに新しい日付を入れない）
LASTMOD = {
    "/": "2026-07-26", "/honne/": "2026-07-26", "/renai/": "2026-07-26",
    "/money/": "2026-07-26", "/type/": "2026-07-26", "/aisho/": "2026-07-04",
}
TYPE_LASTMOD = "2026-08-11"   # 16タイプ個別に「取扱説明書」を追加した日
PAIR_LASTMOD = "2026-08-16"   # 相性ペアページを新設した日


def pair_keys(root):
    """_design/相性ペア.json にあるペアのキーを返す（_で始まるものは除く）"""
    path = os.path.join(root, "_design", "相性ペア.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    return sorted(k for k in d if not k.startswith("_"))


def all_urls(root):
    """(url, lastmod) の一覧を返す"""
    rows = []
    for u in ["/", "/honne/", "/renai/", "/aisho/", "/money/", "/type/"]:
        rows.append((u, LASTMOD.get(u, TYPE_LASTMOD)))
    for c in ORDER:
        rows.append((f"/type/{c}/", TYPE_LASTMOD))
    pk = pair_keys(root)
    if pk:
        rows.append(("/pair/", PAIR_LASTMOD))
        for k in pk:
            rows.append((f"/pair/{k}/", PAIR_LASTMOD))
    return rows


def write_sitemap(root):
    """sitemap.xml を書き出して、書いたURL数を返す"""
    rows = all_urls(root)
    sm = ['<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u, lm in rows:
        sm.append(f"  <url><loc>{SITE}{u}</loc><lastmod>{lm}</lastmod></url>")
    sm.append("</urlset>")
    with open(os.path.join(root, "sitemap.xml"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(sm) + "\n")
    return len(rows)


if __name__ == "__main__":
    import sys, io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    ROOT = r"C:\Claude Code\ウェブサイト\ura-shindan"
    for u, lm in all_urls(ROOT):
        print(f"  {u:<24} {lm}")
    print(f"\n合計 {len(all_urls(ROOT))} URL（書き出しは write_sitemap を呼ぶ）")
