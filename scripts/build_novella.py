"""Build the public novella from the current ODT chapters, without editing sources."""
from pathlib import Path
import argparse
import hashlib
import html
import re
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
NS = {"text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0", "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0"}
T = "{" + NS["text"] + "}"

def text_content(element):
    result = element.text or ""
    for child in element:
        if child.tag == T + "s":
            result += " " * int(child.get(T + "c", "1"))
        elif child.tag == T + "tab":
            result += "\t"
        elif child.tag == T + "line-break":
            result += "\n"
        else:
            result += text_content(child)
        result += child.tail or ""
    return result

def read_chapter(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("content.xml"))
    body = root.find("office:body/office:text", NS)
    blocks = [(e.tag == T + "h", text_content(e)) for e in body.iter() if e.tag in (T + "p", T + "h")]
    if not blocks or not re.match(r"Глава\s+\d+", blocks[0][1]):
        raise ValueError(f"Missing chapter heading: {path.name}")
    return blocks

def document(title, content, chapter=None):
    chapter_attr = f' data-chapter="{chapter}"' if chapter else ""
    asset_version = hashlib.sha256(
        (ROOT / "novella/novella.css").read_bytes() + (ROOT / "novella/novella.js").read_bytes()
    ).hexdigest()[:12]
    return f'''<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} — Кодислово</title>
<meta name="description" content="Перерождение чёрной дырой — новелла Марка. Оглавление и чтение глав.">
<link rel="icon" href="../assets/brand/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="novella.css?v={asset_version}"><script src="novella.js?v={asset_version}" defer></script></head>
<body{chapter_attr}><header class="topbar"><a class="brand" href="https://kodislovo.ru/">Кодислово <span> / Новелла</span></a>
<button id="theme" type="button" aria-label="Переключить тему">Сменить тему</button></header>
<main>{content}</main><footer>Марк · Перерождение чёрной дырой <a href="index.html">Оглавление</a></footer></body></html>'''

def build(source):
    files = sorted(source.glob("Глава *.odt"), key=lambda p: int(re.search(r"Глава (\d+)", p.name)[1]))
    if not files:
        raise ValueError("No chapters found")
    numbers = [int(re.search(r"Глава (\d+)", p.name)[1]) for p in files]
    if numbers != list(range(1, len(files) + 1)):
        raise ValueError("Chapters are not consecutive")
    output = ROOT / "novella"
    output.mkdir(exist_ok=True)
    chapters = [read_chapter(path) for path in files]
    entries = []
    for number, blocks in enumerate(chapters, 1):
        title = blocks[0][1]
        entries.append(f'<li><a href="chapter-{number:03}.html">{html.escape(title)}</a></li>')
        previous = f'<a href="chapter-{number-1:03}.html" rel="prev">← Предыдущая глава</a>' if number > 1 else '<span></span>'
        following = f'<a href="chapter-{number+1:03}.html" rel="next">Следующая глава →</a>' if number < len(chapters) else '<a href="index.html">К оглавлению →</a>'
        navigation = f'<nav class="chapter-nav" aria-label="Переходы между главами">{previous}<a href="index.html">Оглавление</a>{following}</nav>'
        paragraphs = []
        for heading, value in blocks[1:]:
            tag = "h2" if heading else "p"
            paragraphs.append(f'<{tag}>{html.escape(value).replace(chr(10), "<br>")}</{tag}>')
        content = f'''{navigation}<header class="chapter-heading"><p class="eyebrow">Перерождение чёрной дырой · Марк</p><h1>{html.escape(title)}</h1>
<div class="reading-controls"><span>Размер текста</span><button id="smaller" type="button" aria-label="Уменьшить текст">А−</button><output id="font-size" aria-label="Размер текста">21 px</output><button id="larger" type="button" aria-label="Увеличить текст">А+</button><button id="width" type="button" aria-pressed="false">По ширине</button></div></header>
<article class="prose">{''.join(paragraphs)}</article>{navigation}'''
        rendered = document(title, content, number)
        (output / f"chapter-{number:03}.html").write_text(rendered, encoding="utf-8")
        # Verify that every source block survives conversion verbatim as visible text.
        for _, value in blocks:
            assert html.escape(value).replace(chr(10), "<br>") in rendered
    content = f'''<section class="hero"><div class="orbit" aria-hidden="true"></div><p class="eyebrow">Авторская новелла · Марк</p>
<h1>Перерождение<br>чёрной дырой</h1><p class="intro">История Астера. {len(chapters)} {chapter_word(len(chapters))}.</p>
<div class="hero-actions"><a class="primary" href="chapter-001.html">Начать читать →</a><a id="resume" hidden>Продолжить чтение</a></div></section>
<section class="contents" aria-labelledby="contents-title"><div class="contents-head"><h2 id="contents-title">Оглавление</h2><label>Найти главу <input id="search" type="search" placeholder="Номер или название"></label></div>
<ol class="chapters">{''.join(entries)}</ol><p id="empty" hidden>Глав с таким названием не найдено.</p></section>'''
    (output / "index.html").write_text(document("Перерождение чёрной дырой", content), encoding="utf-8")
    print(f"Built {len(chapters)} chapters; all source paragraphs verified.")

def chapter_word(count):
    if count % 100 in (11, 12, 13, 14):
        return "глав"
    if count % 10 == 1:
        return "глава"
    if count % 10 in (2, 3, 4):
        return "главы"
    return "глав"

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    build(parser.parse_args().source)
