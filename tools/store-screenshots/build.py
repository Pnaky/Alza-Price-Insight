# Snímky a propagační dlaždice do Chrome Web Store – nezávisle na rozšíření (jen čte jeho CSS a JS).
#
#   python tools/store-screenshots/build.py [výstupní složka]
#
# Vygeneruje stránky do tools/store-screenshots/pages/ a vyfotí je headless Chromem:
#   <výstup>/cs|sk|hu/1-…5-….png  lokalizované snímky 1280x800 (CZ alza.cz, SK alza.sk €, HU alza.hu Ft)
#   <výstup>/en/1-…5-….png        globální snímky 1280x800 (alza.cz, rozšíření v angličtině)
#   <výstup>/promo/…              malá dlaždice 440x280 a dlaždice běžícího textu 1400x560 (anglicky)
#   <výstup>/release/cs|en/…      promo novinek verze pro X / Twitter 1600x900 + text příspěvku (release.py)
# Výchozí výstup je ..lza-price-insight-store\<verze z manifest.json>\ – každá verze má vlastní složku.
# Data a texty kolem rozšíření jsou vymyšlené (common.js); rozhraní rozšíření je skutečné.
# Celý postup vydání, co kam v obchodě nahrát a pravidla designu: store/README.md
import json
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image

TOOL = pathlib.Path(__file__).resolve().parent
REPO = TOOL.parents[1]
VERSION = json.loads((REPO / "manifest.json").read_text(encoding="utf-8"))["version"]  # verze v mocku chrome.runtime (common.js)
PAGES = TOOL / "pages"
X = REPO.as_uri()
# Každá verze do vlastní složky – je vidět, ke které verzi snímky a promo patří
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else REPO.parent / "alza-price-insight-store" / VERSION
CHROME = pathlib.Path("C:/Program Files/Google/Chrome/Application/chrome.exe")
LANGS = ["cs", "sk", "hu", "en"]

# Barvy z ikony: rám #1e1e1e, sloupce limetková / oranžová / šedá, čára grafu námořnická modrá
FRAME_CSS = """
:root { --ink: #1e1e1e; --navy: #263f6a; --lime: #c9dd03; --orange: #ee771a; --grey: #9a9b9c; }
html, body { margin: 0; overflow: hidden; }
body {
  font-family: "Segoe UI", system-ui, sans-serif;
  background: radial-gradient(circle at 88% 12%, rgba(201, 221, 3, 0.10) 0%, transparent 38%),
    linear-gradient(135deg, #161616 0%, #1e2636 45%, #263f6a 100%);
  color: #fff;
}
.frame { display: grid; grid-template-columns: 420px 1fr; width: 1280px; height: 800px; }
.copy { position: relative; padding: 60px 26px 48px 60px; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 600; color: #dfe5ee; }
.brand img { width: 30px; height: 30px; background: #fff; border-radius: 8px; padding: 3px; }
h1 { font-size: 46px; line-height: 1.08; margin: 60px 0 20px; font-weight: 800; letter-spacing: -0.5px; }
h1 em { font-style: normal; color: var(--lime); }
.lead { font-size: 20px; line-height: 1.45; color: #d5dbe5; margin: 0; }
ul.points { margin: 28px 0 0; padding: 0; list-style: none; font-size: 18px; line-height: 1.45; color: #eef2f7; }
ul.points li { margin: 12px 0; padding-left: 30px; position: relative; }
ul.points li::before { content: "✓"; position: absolute; left: 0; color: var(--lime); font-weight: 800; }
.bars { position: absolute; left: 60px; bottom: 52px; display: flex; align-items: flex-end; gap: 7px; }
.bars i { display: block; width: 13px; border-radius: 2px; }
.bars i:nth-child(1) { height: 26px; background: var(--grey); }
.bars i:nth-child(2) { height: 40px; background: var(--lime); }
.bars i:nth-child(3) { height: 32px; background: var(--orange); }
.bars i:nth-child(4) { height: 50px; background: var(--lime); }
.bars i:nth-child(5) { height: 62px; background: var(--lime); }
.stage { position: relative; display: flex; align-items: flex-start; justify-content: center; padding: 48px 44px 48px 0; }
/* Všechna okna stejně vysoká a na stejném místě – při listování snímků nic neposkakuje */
.window { position: relative; box-sizing: border-box; height: 704px; background: #fff; color: #212121; border: 3px solid var(--ink); border-radius: 14px; box-shadow: 0 28px 70px rgba(0, 0, 0, 0.45); overflow: hidden; }
.bar { height: 26px; background: var(--ink); display: flex; align-items: center; gap: 6px; padding: 0 12px; }
.bar i { width: 7px; height: 7px; border-radius: 50%; background: #fff; }
"""
BAR = '<div class="bar"><i></i><i></i><i></i></div>'
BARS = '<div class="bars"><i></i><i></i><i></i><i></i><i></i></div>'

# Nadpis, perex a body vlevo: snímek → jazyk → (h1, lead, [body])
COPY = {
    "history": {
        "cs": ("Je to opravdu <em>sleva</em>?", "Historie všech cen produktu a upozornění na slevy, které jsou jen na oko.",
               ["Graf všech typů cen a dostupnosti", "Obvyklá cena za posledních 180 dní", "Odhalí vymyšlenou přeškrtnutou cenu"]),
        "sk": ("Je to naozaj <em>zľava</em>?", "História všetkých cien produktu a upozornenie na zľavy, ktoré sú len naoko.",
               ["Graf všetkých typov cien a dostupnosti", "Obvyklá cena za posledných 180 dní", "Odhalí vymyslenú prečiarknutú cenu"]),
        "hu": ("Tényleg <em>akció</em>?", "A termék teljes árelőzménye és figyelmeztetés a csak látszólagos kedvezményekre.",
               ["Minden ártípus és az elérhetőség grafikonon", "Szokásos ár az elmúlt 180 napból", "Leleplezi a kitalált áthúzott árat"]),
        "en": ("Is it <em>really</em> a deal?", "The full price history of every product and a warning when a discount is just for show.",
               ["Chart of every price type and availability", "Usual price over the last 180 days", "Spots made-up strikethrough prices"]),
    },
    "list": {
        "cs": ("Nákupní seznam <em>na jeden pohled</em>", "Všechny ceny u každé položky – i s AlzaPlus+, slevovými kódy a cashbackem.",
               ["▼ ▲ levněji / dráž než obvykle", "Souhrn, úspora a změny od minula", "Filtry a řazení, i podle ceny za kus"]),
        "sk": ("Nákupný zoznam <em>na jeden pohľad</em>", "Všetky ceny pri každej položke – aj s AlzaPlus+, zľavovými kódmi a cashbackom.",
               ["▼ ▲ lacnejšie / drahšie ako obvykle", "Súhrn, úspora a zmeny od minula", "Filtre a zoradenie, aj podľa ceny za kus"]),
        "hu": ("Bevásárlólista <em>egy pillantással</em>", "Minden tétel minden ára – AlzaPlus+-szal, kuponkódokkal és cashbackkel együtt.",
               ["▼ ▲ olcsóbb / drágább a szokásosnál", "Összesítés, megtakarítás és változások", "Szűrők és rendezés, darabár szerint is"]),
        "en": ("Your shopping list <em>at a glance</em>", "Every price of every item – including AlzaPlus+, discount codes and cashback.",
               ["▼ ▲ cheaper / pricier than usual", "Total, savings and changes since last time", "Filters and sorting, even by unit price"]),
    },
    "detail": {
        "cs": ("Kupte, až <em>cena klesne</em>", "Nastavte cílovou cenu – klidně za kus – a rozšíření se ozve, jakmile ji Alza nabídne.",
               ["Historie cen přímo na detailu produktu", "Hodnocení aktuální ceny", "Kontrola na pozadí každou hodinu"]),
        "sk": ("Kúpte, keď <em>cena klesne</em>", "Nastavte cieľovú cenu – kľudne za kus – a rozšírenie sa ozve, len čo ju Alza ponúkne.",
               ["História cien priamo na detaile produktu", "Hodnotenie aktuálnej ceny", "Kontrola na pozadí každú hodinu"]),
        "hu": ("Vásároljon, ha <em>csökken az ár</em>", "Állítson be célárat – akár darabárat –, és a bővítmény szól, amint az Alza kínálja.",
               ["Árelőzmények a termékoldalon", "A jelenlegi ár értékelése", "Háttérellenőrzés óránként"]),
        "en": ("Buy when the <em>price drops</em>", "Set a target price – even per piece – and get notified as soon as Alza offers it.",
               ["Price history right on the product page", "Rating of the current price", "Background check every hour"]),
    },
    "unit": {
        "cs": ("Skutečná cena <em>za kus</em>", "Alza počítá cenu za jednotku bez AlzaPlus+ a slevových kódů. Rozšíření ukáže tu skutečnou.",
               ["Oranžový štítek přímo v kategorii", "Seřazení celé kategorie podle ní", "Ideální na nákup do zásoby"]),
        "sk": ("Skutočná cena <em>za kus</em>", "Alza počíta cenu za jednotku bez AlzaPlus+ a zľavových kódov. Rozšírenie ukáže tú skutočnú.",
               ["Oranžový štítok priamo v kategórii", "Zoradenie celej kategórie podľa nej", "Ideálne na nákup do zásoby"]),
        "hu": ("Valós <em>darabár</em>", "Az Alza az egységárat AlzaPlus+ és kuponkódok nélkül számolja. A bővítmény a valósat mutatja.",
               ["Narancssárga címke a kategóriában", "Az egész kategória rendezése szerint", "Ideális készletezéshez"]),
        "en": ("The real price <em>per piece</em>", "Alza's unit price ignores AlzaPlus+ and discount codes. The extension shows the real one.",
               ["Orange label right in the category", "Sort the whole category by it", "Perfect for stocking up"]),
    },
    "watch": {
        "cs": ("Hlídá za vás <em>na pozadí</em>", "Celé nákupní seznamy i jednotlivé produkty. Změny uvidíte v notifikaci i v přehledu.",
               ["Zlevnění, nové ceny a dostupnost", "Tiché hodiny a vlastní pravidla", "Data zůstávají jen ve vašem prohlížeči"]),
        "sk": ("Stráži za vás <em>na pozadí</em>", "Celé nákupné zoznamy aj jednotlivé produkty. Zmeny uvidíte v notifikácii aj v prehľade.",
               ["Zlacnenie, nové ceny a dostupnosť", "Tiché hodiny a vlastné pravidlá", "Dáta zostávajú len vo vašom prehliadači"]),
        "hu": ("Figyel Ön helyett <em>a háttérben</em>", "Teljes bevásárlólisták és egyes termékek. Minden változást lát értesítésben és áttekintésben.",
               ["Árcsökkenés, új árak és elérhetőség", "Csendes órák és saját szabályok", "Az adatai csak a böngészőben maradnak"]),
        "en": ("Watches prices <em>for you</em>", "Whole shopping lists and single products. See every change in a notification and in one overview.",
               ["Price drops, new prices and availability", "Quiet hours and your own rules", "Your data stays in your browser"]),
    },
}
SLUGS = {
    "cs": ["historie", "seznam", "detail", "cena-za-kus", "hlidani"],
    "sk": ["historia", "zoznam", "detail", "cena-za-kus", "sledovanie"],
    "hu": ["elozmenyek", "lista", "termekoldal", "darabar", "figyeles"],
    "en": ["history", "list", "product-page", "unit-price", "watching"],
}

# Texty „stránky Alzy“ kolem rozšíření (neutrální kostra, ne vzhled Alzy)
MOCK = {
    "cs": dict(list="Vánoce", inStock="Skladem", onOrder="Na objednávku", sub="90 ks v balení · vhodné do všech myček", aplus="s AlzaPlus+",
               cart="Do košíku", cat="Kapsle do myčky", count="3 produkty", tabs=["Nejprodávanější", "Nejlevnější", "Nejlevnější za jednotku"]),
    "sk": dict(list="Vianoce", inStock="Skladom", onOrder="Na objednávku", sub="90 ks v balení · vhodné do všetkých umývačiek", aplus="s AlzaPlus+",
               cart="Do košíka", cat="Kapsule do umývačky", count="3 produkty", tabs=["Najpredávanejšie", "Najlacnejšie", "Najlacnejšie za jednotku"]),
    "hu": dict(list="Karácsony", inStock="Raktáron", onOrder="Rendelésre", sub="90 db a csomagban · minden mosogatógépbe", aplus="AlzaPlus+-szal",
               cart="Kosárba", cat="Mosogatógép-kapszulák", count="3 termék", tabs=["Legnépszerűbb", "Legolcsóbb", "Legolcsóbb egységár"]),
    "en": dict(list="Christmas", inStock="In stock", onOrder="On order", sub="90 pcs per pack · for all dishwashers", aplus="with AlzaPlus+",
               cart="Add to cart", cat="Dishwasher capsules", count="3 products", tabs=["Best sellers", "Cheapest", "Cheapest per unit"]),
}
# Kategorie: (název, kusů, cena, cena s AlzaPlus+ nebo None) – ceny zvlášť pro každý trh, ať je cena za kus čitelná
CATEGORY = {
    "cs": [("Kapsle do myčky Ultra, 60 ks", 60, 329, 289), ("Kapsle do myčky Eco, 120 ks", 120, 559, None), ("Kapsle do myčky All in 1, 90 ks", 90, 449, 399)],
    "sk": [("Kapsule do umývačky Ultra, 60 ks", 60, 14.9, 12.9), ("Kapsule do umývačky Eco, 120 ks", 120, 23.9, None), ("Kapsule do umývačky All in 1, 90 ks", 90, 19.9, 15.9)],
    "hu": [("Ultra mosogatógép-kapszula, 60 db", 60, 4990, 4390), ("Eco mosogatógép-kapszula, 120 db", 120, 8390, None), ("All in 1 mosogatógép-kapszula, 90 db", 90, 6690, 5790)],
    "en": [("Ultra dishwasher capsules, 60 pcs", 60, 329, 289), ("Eco dishwasher capsules, 120 pcs", 120, 559, None), ("All in 1 dishwasher capsules, 90 pcs", 90, 449, 399)],
}
CAPSULE_NAME = {"cs": "Kapsle do myčky All in 1, 90 ks", "sk": "Kapsule do umývačky All in 1, 90 ks", "hu": "All in 1 mosogatógép-kapszula, 90 db", "en": "All in 1 dishwasher capsules, 90 pcs"}
CAPSULE_PRICE = {"cs": (449, 399), "en": (449, 399), "sk": (19.9, 15.9), "hu": (6690, 5790)}


def money(lang, value):
    # Stejně jako AlzaCore.formatPrice: Kč a Ft bez desetin, € se dvěma
    if lang == "sk":
        return f"{value:.2f}".replace(".", ",") + " €"
    return f"{round(value):,}".replace(",", " ") + (" Ft" if lang == "hu" else " Kč")


def unit(lang, value):
    number = f"{value:.2f}".replace(".", ",")
    return {"sk": f"{number} €/ks", "hu": f"{number} Ft/db"}.get(lang, f"{number} Kč/ks")


def copy_html(shot, lang):
    h1, lead, points = COPY[shot][lang]
    items = "".join(f"<li>{p}</li>" for p in points)
    return (f'<div class="copy"><div class="brand"><img src="{X}/img/icon-48.png" alt="" />Alza Price Insight</div>'
            f'<h1>{h1}</h1><p class="lead">{lead}</p><ul class="points">{items}</ul>{BARS}</div>')


def page(shot, lang, stage, css="", script="", extra=(), changes=False):
    scripts = [f"<script>window.LANG = {lang!r}; window.EXT_VERSION = {VERSION!r};</script>", '<script src="../common.js"></script>',
               f'<script src="{X}/src/shared/core.js"></script>', f'<script src="{X}/src/shared/store.js"></script>', '<script src="../after-core.js"></script>']
    if changes:
        scripts.append('<script src="../changes.js"></script>')
    scripts += [f'<script src="{s}"></script>' for s in extra]
    return f"""<!DOCTYPE html>
<html lang="{lang}"><head><meta charset="UTF-8" /><title>{shot}</title>
<link rel="stylesheet" href="{X}/css/main.css" />
<style>{FRAME_CSS}{css}</style></head>
<body>
<div class="frame">{copy_html(shot, lang)}<div class="stage">{stage}</div></div>
{"".join(scripts)}
<script>{script}</script>
</body></html>
"""


# Skripty content scriptu AlzaPriceTracker v pořadí z manifestu (content.js + části v src/content/)
CONTENT = tuple(f"{X}/{name}" for name in json.loads((REPO / "manifest.json").read_text(encoding="utf-8"))["content_scripts"][0]["js"]
                if name == "src/content.js" or name.startswith("src/content/"))
CONTENT_TAGS = "".join(f'<script src="{src}"></script>' for src in CONTENT)
HISTORY_SCRIPT = """
(async () => {
  const T = setupTracker();
  const p = __products.vacuum;
  await T.openHistoryDialog({ url: p.url, name: p.name, image: null }, __records[p.url]);
  document.getElementById("win").appendChild(document.querySelector("dialog.alza-price-tracker-history"));
})();
"""
HISTORY_CSS = """
dialog.alza-price-tracker-history { position: static; max-height: none; margin: 0; box-shadow: none; border-radius: 0; }
.alza-price-tracker-history-close { visibility: hidden; }
.alza-price-tracker-history-target { display: none; }
.alza-price-tracker-history-stats > :nth-child(n+6) { display: none; }
"""


def shot_history(lang):
    return page("history", lang, f'<div class="window w1">{BAR}<div id="win"></div></div>', css=HISTORY_CSS + """
.w1 { width: 790px; }
.w1 dialog.alza-price-tracker-history { width: 790px; }
.w1::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 60px; background: linear-gradient(transparent, #fff); }
""", script=HISTORY_SCRIPT, extra=CONTENT)


def shot_list(lang):
    m = MOCK[lang]
    return page("list", lang, f'<div class="window w2">{BAR}<div class="inner"><div class="list-title">{m["list"]} <span>5</span></div><div id="list"></div></div></div>', css="""
.w2 { width: 790px; }
.w2 .inner { padding: 18px 22px 8px; font-size: 14px; }
.list-title { font-size: 20px; font-weight: 700; margin: 0 0 12px; }
.list-title span { font-size: 13px; font-weight: 400; color: #757575; margin-left: 6px; }
[data-testid="shoppingListItem"] { display: grid; grid-template-columns: 44px 1fr 96px 316px; column-gap: 14px; align-items: center; padding: 11px 16px; border-top: 1px solid #eee; }
.thumb { width: 44px; height: 44px; border-radius: 8px; background: #f2f4f7; display: flex; align-items: center; justify-content: center; font-size: 22px; }
[data-testid="shoppingListItem_name"] { color: #1653a4; font-weight: 600; text-decoration: none; }
[data-testid="shoppingListItem_availability"] { color: #2e7d32; font-size: 13px; }
[data-testid="shoppingListItem_price"] { justify-self: end; display: flex; justify-content: flex-end; align-items: center; gap: 4px; white-space: nowrap; }
/* Ceny stejně široké – rámečky stejně velké a ceny v řádcích pod sebou */
[data-testid="shoppingListItem_price"] .alza-price-tracker-price { box-sizing: border-box; min-width: 84px; padding: 10px 12px !important; text-align: right; }
[data-testid="shoppingListItem_price"] .alza-price-tracker-price[class*="-applus"], [data-testid="shoppingListItem_price"] .alza-price-tracker-price[class*="-discount"] { text-align: center; }
""", script=f"""
(async () => {{
  const T = setupTracker();
  T.state.targets = {{}}; // Terč 🎯 u ceny na snímku nechceme
  const list = document.getElementById("list");
  for (const key of ["headphones", "vacuum", "capsules", "keyboard", "watch"]) {{
    const p = __products[key];
    const item = document.createElement("div");
    item.dataset.testid = "shoppingListItem";
    item.innerHTML = '<div class="thumb">' + p.icon + '</div><a data-testid="shoppingListItem_name"></a><span data-testid="shoppingListItem_availability"></span><span data-testid="shoppingListItem_price"></span>';
    item.querySelector("a").href = p.url;
    item.querySelector("a").textContent = p.name;
    const availability = item.querySelector('[data-testid="shoppingListItem_availability"]');
    availability.textContent = key === "keyboard" ? {m["onOrder"]!r} : {m["inStock"]!r};
    if (key === "keyboard") availability.style.color = "#f26b1d";
    list.appendChild(item);
    await T.displayAllPrices(item, null, __records[p.url]);
  }}
}})();
""", extra=CONTENT)


def shot_detail(lang):
    m = MOCK[lang]
    original, applus = CAPSULE_PRICE[lang]
    return page("detail", lang, f"""<div class="window w3">{BAR}<div class="inner">
  <div id="detailItem"><div class="left-cnt"><div class="gallery">🧼</div></div>
  <div class="right"><div class="title">{CAPSULE_NAME[lang]}</div><div class="sub">{m["sub"]}</div>
    <div class="pricebox"><div class="now">{money(lang, applus)} <span>{m["aplus"]}</span></div><div class="was">{money(lang, original)}</div><div class="cart">{m["cart"]}</div></div>
    <div class="fake" style="width:80%;margin-top:22px"></div><div class="fake" style="width:65%"></div><div class="fake" style="width:72%"></div>
  </div></div></div></div>""", css="""
.w3 { width: 790px; }
.w3 .inner { padding: 20px 22px; }
#detailItem { display: grid; grid-template-columns: 430px 1fr; gap: 22px; align-items: start; }
.gallery { height: 120px; border-radius: 10px; background: #f2f4f7; display: flex; align-items: center; justify-content: center; font-size: 60px; }
.w3 .alza-price-tracker-product { margin-top: 12px; }
.title { font-size: 19px; font-weight: 700; line-height: 1.25; }
.sub { color: #757575; font-size: 13px; margin-top: 6px; }
.pricebox { margin-top: 18px; padding: 14px; border: 1px solid #e6e6e6; border-radius: 10px; }
.now { font-size: 26px; font-weight: 800; }
.now span { font-size: 12px; font-weight: 600; color: #ee771a; }
.was { color: #9e9e9e; text-decoration: line-through; font-size: 14px; }
.cart { margin-top: 12px; padding: 9px; border-radius: 8px; background: #1e1e1e; color: #fff; text-align: center; font-weight: 700; font-size: 14px; }
.fake { height: 12px; margin-top: 10px; background: #e9edf2; border-radius: 6px; }
""", script=f"""
(async () => {{
  const T = setupTracker();
  const p = __products.capsules;
  T.state.product = {{ url: p.url, name: p.name, image: null }};
  T.state.productData = __records[p.url];
  T.getProductPagePrices = () => ({{ original: {original}, applus: {applus} }});
  T.getProductWatchInfo = async () => ({{ watched: false, lists: [MARKET.lists[1]] }});
  await T.renderProductPanel();
}})();
""", extra=CONTENT)


def shot_unit(lang):
    m = MOCK[lang]
    piece = "db" if lang == "hu" else "ks"
    boxes = ""
    for name, count, price, aplus in CATEGORY[lang]:
        per = unit(lang, price / count)
        desc = f"{count} {piece} – " + per.replace(f"/{piece}", f"/1 {piece}")
        coupon = f'<div class="coupon-block coupon-block--applus">{m["aplus"]} <span class="coupon-block__price">{money(lang, aplus)}</span></div>' if aplus else ""
        boxes += (f'<div class="browsingitem canBuy"><div class="img">🧼</div><a class="name">{name}</a><div class="Description">{desc}</div>'
                  f'<div class="price"><span class="js-price-box__primary-price__value">{money(lang, price)}</span>'
                  f'<span class="unit-price__label">{per}</span></div>{coupon}</div>')
    tabs = f"<b>{m['tabs'][0]}</b><span>{m['tabs'][1]}</span><span>{m['tabs'][2]}</span>"
    return page("unit", lang, f"""<div class="window w4">{BAR}<div class="inner">
  <div class="cat">{m["cat"]} <span>{m["count"]}</span></div>
  <div class="js-sorting">{tabs}</div>
  <div id="boxes">{boxes}</div></div></div>""", css="""
/* Zvětšený jen obsah – rám okna stejný jako na ostatních snímcích */
.w4 { width: 790px; }
.w4 .inner { zoom: 1.14; padding: 18px 22px 22px; font-size: 14px; }
.cat { font-size: 20px; font-weight: 700; } .cat span { font-size: 13px; color: #757575; font-weight: 400; margin-left: 6px; }
.js-sorting { display: flex; gap: 18px; margin: 12px 0 0; padding-bottom: 8px; border-bottom: 1px solid #eee; font-size: 13px; color: #616161; }
.js-sorting b { color: #212121; }
.w4 .alza-price-tracker-unit-toolbar { margin: 12px 0; }
#boxes { display: flex; gap: 14px; }
.browsingitem { flex: 1; border: 1px solid #e6e6e6; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.browsingitem .img { height: 86px; border-radius: 8px; background: #f2f4f7; display: flex; align-items: center; justify-content: center; font-size: 40px; }
.browsingitem .name { font-weight: 600; color: #1653a4; min-height: 38px; }
.Description { font-size: 12px; color: #757575; }
.price { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.js-price-box__primary-price__value { font-size: 20px; font-weight: 800; }
.unit-price__label { font-size: 12px; color: #616161; }
.coupon-block { font-size: 12px; color: #ee771a; font-weight: 600; }
.coupon-block__price { font-weight: 800; }
""", script="setTimeout(() => AlzaUnitPrice.startSort(), 300);", extra=(f"{X}/src/category.js",))


def shot_watch(lang):
    return page("watch", lang, f"""<div class="stack"><div id="toasts"></div>
  <div class="window w5">{BAR}<iframe src="popup-{lang}.html" scrolling="no"></iframe></div></div>""", css="""
.stack { position: relative; width: 790px; height: 704px; }
.w5 { position: absolute; left: 0; top: 0; width: 515px; }
.w5 iframe { display: block; width: 509px; height: 672px; border: 0; background: #fff; }
.toast { position: absolute; z-index: 2; right: -14px; width: 320px; padding: 14px 16px; border-radius: 10px; background: #2b2b2b; color: #f2f2f2; font-size: 14px; line-height: 1.4; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45); border-left: 4px solid var(--lime); }
.toast-app { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #bdbdbd; margin-bottom: 6px; }
.toast-app img { width: 18px; height: 18px; background: #fff; border-radius: 4px; padding: 1px; }
.toast b { display: block; margin-bottom: 2px; }
""", script=f"""
// Notifikace s texty z jádra rozšíření (changes.js)
// Pod přehledem změn – širší popup (400 px) by jinak notifikace zakryly ceny
[["headphones", 0, 505], ["watch", 0, 620]].forEach(([key, line, top]) => {{
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.style.top = top + "px";
  toast.innerHTML = '<div class="toast-app"><img src="{X}/img/icon-48.png" alt="" />Alza Price Insight</div><b></b><div></div>';
  toast.querySelector("b").textContent = __products[key].name;
  toast.lastElementChild.textContent = __changes[key][line];
  document.getElementById("toasts").appendChild(toast);
}});
""", changes=True)


def popup_frame(lang):
    # Skutečný popup.html s náhradou chrome.* a absolutními cestami, zvětšený pro čitelnost (popup 400 px + okraje
    # × 1.2 = šířka iframe ve shot_watch). Vzdálené obrázky zakázané: místo favicony Alzy se ukáže text „alza.cz ↗“
    # (na snímcích žádné logo Alzy)
    html = (REPO / "src/popup/popup.html").read_text(encoding="utf-8")
    csp = '<meta http-equiv="Content-Security-Policy" content="img-src file: data:" />'
    html = html.replace('src="../../img/', f'src="{X}/img/').replace("</head>", f"{csp}<style>html {{ zoom: 1.2; overflow: hidden; }}</style></head>")
    core = '<script src="../shared/core.js"></script>'
    assert core in html and '<script src="popup.js"></script>' in html
    store = '<script src="../shared/store.js"></script>'
    assert store in html
    html = html.replace(store, "").replace(core, f'<script>window.LANG = {lang!r}; window.EXT_VERSION = {VERSION!r};</script><script src="../common.js"></script><script src="{X}/src/shared/core.js"></script>'
                              f'<script src="{X}/src/shared/store.js"></script><script src="../after-core.js"></script><script src="../changes.js"></script>')
    return html.replace('<script src="popup.js"></script>', f'<script src="{X}/src/popup/popup.js"></script>')


def tile_small():
    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>tile</title><style>{FRAME_CSS}
.tile {{ position: relative; overflow: hidden; width: 440px; height: 280px; padding: 34px 32px; box-sizing: border-box; }}
.logo {{ display: flex; align-items: center; gap: 14px; }}
.logo img {{ width: 64px; height: 64px; padding: 6px; background: #fff; border-radius: 14px; }}
.name {{ font-size: 34px; line-height: 1.05; font-weight: 800; letter-spacing: -0.3px; }}
.name em {{ font-style: normal; color: var(--lime); }}
.tag {{ color: #d5dbe5; font-size: 17px; line-height: 1.35; margin-top: 22px; max-width: 250px; }}
.tile .bars {{ left: auto; right: 34px; bottom: 34px; gap: 9px; }}
.tile .bars i {{ width: 22px; border-radius: 3px; }}
.tile .bars i:nth-child(1) {{ height: 46px; }} .tile .bars i:nth-child(2) {{ height: 72px; }} .tile .bars i:nth-child(3) {{ height: 58px; }}
.tile .bars i:nth-child(4) {{ height: 92px; }} .tile .bars i:nth-child(5) {{ height: 118px; }}
</style></head><body><div class="tile">
  <div class="logo"><img src="{X}/img/icon-128.png" alt="" /><div class="name">Alza Price<br /><em>Insight</em></div></div>
  <div class="tag">Price history, fake-discount alerts &amp; the real price per piece</div>{BARS}
</div></body></html>"""


def marquee():
    # Koláž skutečných prvků rozšíření: karta historie z detailu produktu, varování před podezřelou slevou, notifikace
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>marquee</title>
<link rel="stylesheet" href="{X}/css/main.css" />
<style>{FRAME_CSS}
.marquee {{ position: relative; width: 1400px; height: 560px; display: grid; grid-template-columns: 600px 1fr; }}
.copy {{ display: flex; flex-direction: column; justify-content: center; padding: 0 40px 0 72px; }}
.copy h1 {{ font-size: 56px; margin: 34px 0 16px; }}
.copy .lead {{ font-size: 21px; max-width: 470px; }}
.pills {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 26px; max-width: 480px; }}
.pills span {{ padding: 6px 12px; border-radius: 999px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); font-size: 14px; color: #eef2f7; }}
.pills span::before {{ content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 8px; background: var(--lime); }}
.pills span:nth-child(3)::before {{ background: var(--orange); }}
.collage {{ position: relative; }}
.card {{ position: absolute; left: 40px; top: 124px; width: 600px; height: auto; }}
.card .alza-price-tracker-product-stats {{ grid-template-columns: repeat(4, 1fr); }}
.card .alza-price-tracker-product-foot {{ display: none; }}
.card .inner {{ padding: 6px 16px 16px; }}
.card .alza-price-tracker-product {{ margin: 0; border: 0; padding: 0; box-shadow: none; }}
.float {{ position: absolute; z-index: 2; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45); }}
.warning {{ top: 72px; left: 260px; width: 470px; border-radius: 10px; overflow: hidden; }}
.warning .alza-price-tracker-history-warning {{ margin: 0; font-size: 13px; }}
.toast {{ bottom: 52px; left: 392px; width: 330px; padding: 13px 15px; border-radius: 10px; background: #2b2b2b; color: #f2f2f2; font-size: 13px; line-height: 1.4; border-left: 4px solid var(--lime); }}
.toast-app {{ display: flex; align-items: center; gap: 8px; font-size: 12px; color: #bdbdbd; margin-bottom: 5px; }}
.toast-app img {{ width: 18px; height: 18px; background: #fff; border-radius: 4px; padding: 1px; }}
.toast b {{ display: block; margin-bottom: 2px; }}
</style></head>
<body><div class="marquee">
  <div class="copy">
    <div class="brand"><img src="{X}/img/icon-48.png" alt="" />Alza Price Insight</div>
    <h1>Is it <em>really</em> a deal?</h1>
    <p class="lead">Price history, honest discount checks and the real price per piece – right on Alza.</p>
    <div class="pills"><span>Price history</span><span>Usual price</span><span>Fake-discount alerts</span><span>Target prices</span><span>Real unit price</span></div>
  </div>
  <div class="collage">
    <div class="window card">{BAR}<div class="inner"><div id="detailItem"><div class="left-cnt"></div></div></div></div>
    <div class="float warning" id="warning"></div>
    <div class="float toast"><div class="toast-app"><img src="{X}/img/icon-48.png" alt="" />Alza Price Insight</div><b id="toastTitle"></b><div id="toastText"></div></div>
  </div>
</div>
<script>window.LANG = "en"; window.EXT_VERSION = {VERSION!r};</script><script src="../common.js"></script><script src="{X}/src/shared/core.js"></script>
<script src="{X}/src/shared/store.js"></script><script src="../after-core.js"></script><script src="../changes.js"></script>{CONTENT_TAGS}
<script>
(async () => {{
  const T = setupTracker();
  const p = __products.headphones;
  T.state.product = {{ url: p.url, name: p.name, image: null }};
  T.state.productData = __records[p.url];
  T.getProductPagePrices = () => ({{ original: MARKET.conv(2999), special: MARKET.conv(2499), applus: MARKET.conv(2399) }});
  T.getProductWatchInfo = async () => ({{ watched: false, lists: [MARKET.lists[0]] }});
  await T.renderProductPanel();
  // Varování z dialogu historie vysavače (podezřelá sleva)
  const v = __products.vacuum;
  const notices = T.createPriceNotices(await T.getDisplayHistory(v.url), __records[v.url]);
  document.getElementById("warning").appendChild(notices[0]);
  document.getElementById("toastTitle").textContent = p.name;
  document.getElementById("toastText").textContent = __changes.headphones[0];
}})();
</script>
</body></html>"""


def render(html_path, png_path, width, height):
    # Headless Chrome s vlastním profilem (jinak by se připojil k otevřenému prohlížeči)
    png_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run([str(CHROME), "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                        "--allow-file-access-from-files", f"--user-data-dir={profile}", f"--window-size={width},{height}",
                        "--virtual-time-budget=6000", f"--screenshot={png_path}", html_path.as_uri()],
                       check=True, capture_output=True, timeout=120)
    # Obchod chce JPEG nebo 24bitové PNG bez průhlednosti, přesně v daném rozměru
    image = Image.open(png_path).convert("RGB")
    assert image.size == (width, height), (png_path, image.size)
    image.save(png_path)


def main():
    PAGES.mkdir(exist_ok=True)
    jobs = []
    for lang in LANGS:
        (PAGES / f"popup-{lang}.html").write_text(popup_frame(lang), encoding="utf-8")
        for index, build in enumerate([shot_history, shot_list, shot_detail, shot_unit, shot_watch]):
            html = PAGES / f"{lang}-{index + 1}.html"
            html.write_text(build(lang), encoding="utf-8")
            jobs.append((html, OUT / lang / f"{index + 1}-{SLUGS[lang][index]}.png", 1280, 800))
    (PAGES / "promo-small.html").write_text(tile_small(), encoding="utf-8")
    (PAGES / "promo-marquee.html").write_text(marquee(), encoding="utf-8")
    jobs += [(PAGES / "promo-small.html", OUT / "promo" / "small-tile-440x280.png", 440, 280),
             (PAGES / "promo-marquee.html", OUT / "promo" / "marquee-1400x560.png", 1400, 560)]
    for html, png, width, height in jobs:
        render(html, png, width, height)
        print(png.relative_to(OUT))
    import release  # Promo novinek verze (potřebuje stránky popupu vygenerované výše)

    release.main(OUT)
    print(f"Hotovo: {OUT}")


if __name__ == "__main__":
    main()
