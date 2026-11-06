# Promo novinek verze pro sociální sítě (X / Twitter): 4 obrázky 1600x900 (16:9) a text příspěvku, česky a anglicky.
# Spouští ho build.py po snímcích do obchodu (stejné mocky, stejný vzhled); jen pro verzi, která má texty v RELEASES.
#
#   <výstup>/release/cs|en/1-…4-….png + post.txt
#
# Rozhraní rozšíření na obrázcích je skutečné (content.js, popup.js, options.js), data jsou vymyšlená (common.js).
# Pro novou verzi přidat do RELEASES její texty (nadpisy, body, text příspěvku) – obrázky se vyberou podle klíčů.
import build as B

# Verze → jazyk → { kicker, post, shots: { klíč obrázku: (h1, lead, [body]) } }
RELEASES = {
    "2026.11.6": {
        "cs": {
            "kicker": "Nová verze 2026.11.6",
            "post": (
                "Alza Price Insight 2026.11.6 je venku 🎉\n\n"
                "▼ Přehled změn barevně: zlevnění, zdražení, nedostupnost\n"
                "⏳ Vyplatí se počkat? Rytmus akcí a kdy přijde další\n"
                "📦 Levněji rozbalený nebo zánovní kus\n"
                "🧮 Součet při více kusech i s množstevní slevou\n"
                "🛒 Upozornění, když cena platí jen s kódem nebo AlzaPlus+\n"
                "⏰ Kontrola klidně jen jednou denně ve zvolený čas\n\n"
                "Chrome i Firefox, zdarma, data jen ve vašem prohlížeči."
            ),
            "shots": {
                "news": ("Co je <em>nového</em>", "Chytřejší hlídání cen na Alze – v seznamu, na detailu i na pozadí.", [
                    "Barevný přehled změn: zlevnění, zdražení, nedostupnost",
                    "Vyplatí se počkat? Rytmus akcí a příští sleva",
                    "Levněji rozbalený nebo zánovní kus",
                    "Součet při více kusech i s množstevní slevou",
                    "Upozornění před košíkem, když cena platí jen s kódem",
                    "Kontrola každou hodinu, nebo jednou denně",
                ]),
                "list": ("Víc kusů? <em>Spočítá celkem.</em>", "Ceny zůstávají za kus, vedle nich součet i s množstevní slevou. A když nejnižší cena platí "
                         "jen s AlzaPlus+ nebo slevovým kódem, upozorní vás ještě před košíkem.", [
                    "Součet podle počtu kusů", "Množstevní slevy „Kup víc, zaplať míň“", "Varování před vložením do košíku",
                ]),
                "detail": ("Vyplatí se <em>počkat</em>?", "Z historie pozná, jak často bývá produkt v akci, jak hluboko a kdy se čeká další. "
                           "A ukáže, když je stejný kus levněji rozbalený nebo zánovní.", [
                    "Rytmus akcí a příští sleva", "⏳ vyplatí se počkat – i ve filtru seznamu", "Srovnání s cenou, kterou opravdu zaplatíte",
                ]),
                "settings": ("Hlídání <em>podle vás</em>", "Kontrola hlídaných produktů každou hodinu, nebo jen jednou denně ve zvolený čas. "
                             "Přehledné nastavení s nápovědou u každé volby.", [
                    "Každou hodinu až jednou denně", "Zmeškaná kontrola proběhne po spuštění prohlížeče", "Nápověda „?“ hned po najetí myší",
                ]),
            },
        },
        "en": {
            "kicker": "New version 2026.11.6",
            "post": (
                "Alza Price Insight 2026.11.6 is out 🎉\n\n"
                "▼ Colour-coded changes: price drops, increases, out of stock\n"
                "⏳ Worth waiting? Sale rhythm and when the next sale is due\n"
                "📦 Cheaper unpacked or like-new item\n"
                "🧮 Totals for multiple pieces incl. volume discounts\n"
                "🛒 A heads-up when the price needs a code or AlzaPlus+\n"
                "⏰ Check as rarely as once a day at a time you choose\n\n"
                "Chrome and Firefox, free, your data stays in your browser."
            ),
            "shots": {
                "news": ("What's <em>new</em>", "Smarter price watching on Alza – in lists, on product pages and in the background.", [
                    "Colour-coded changes: drops, increases, out of stock",
                    "Worth waiting? Sale rhythm and the next sale",
                    "Cheaper unpacked or like-new item",
                    "Totals for multiple pieces incl. volume discounts",
                    "A heads-up before the cart when a code is needed",
                    "Check every hour, or once a day",
                ]),
                "list": ("More pieces? <em>See the total.</em>", "Prices stay per piece, with the total next to them – volume discounts included. "
                         "And when the lowest price needs AlzaPlus+ or a discount code, you're told before it goes to the cart.", [
                    "Total by number of pieces", "\"Buy more, pay less\" volume discounts", "Warning before adding to the cart",
                ]),
                "detail": ("Worth <em>waiting</em>?", "The history shows how often the product goes on sale, how deep and when the next sale is due. "
                           "Plus a heads-up when the same item is cheaper unpacked or like new.", [
                    "Sale rhythm and the next sale", "⏳ worth waiting – also as a list filter", "Compared with the price you really pay",
                ]),
                "settings": ("Watching <em>your way</em>", "Watched products checked every hour, or just once a day at a time you choose. "
                             "Clear settings with help for every option.", [
                    "Every hour up to once a day", "A missed check runs after the browser starts", "\"?\" help right on hover",
                ]),
            },
        },
    },
}
SLUGS = {"cs": {"news": "novinky", "list": "seznam", "detail": "detail", "settings": "nastaveni"},
         "en": {"news": "whats-new", "list": "list", "detail": "product-page", "settings": "settings"}}
ORDER = ["news", "list", "detail", "settings"]
WIDTH, HEIGHT = 1600, 900

CSS = B.FRAME_CSS + """
.rframe { display: grid; grid-template-columns: 620px 1fr; width: 1600px; height: 900px; }
.rframe .copy { position: relative; padding: 64px 30px 56px 72px; }
.kicker { display: inline-block; margin-top: 54px; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--lime); color: var(--lime);
  font-size: 17px; font-weight: 700; letter-spacing: 0.2px; }
.rframe h1 { font-size: 58px; margin: 22px 0 22px; }
.rframe .lead { font-size: 22px; max-width: 500px; }
.rframe ul.points { font-size: 20px; margin-top: 26px; }
.rframe ul.points li { margin: 11px 0; }
.rframe .bars { left: 72px; bottom: 56px; }
.rstage { position: relative; display: flex; align-items: center; justify-content: center; padding: 56px 64px 56px 0; }
.rstage .window { height: auto; }
.toast { position: absolute; z-index: 3; width: 340px; padding: 14px 16px; border-radius: 10px; background: #2b2b2b; color: #f2f2f2; font-size: 14px;
  line-height: 1.4; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45); border-left: 4px solid var(--lime); }
.toast-app { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #bdbdbd; margin-bottom: 6px; }
.toast-app img { width: 18px; height: 18px; background: #fff; border-radius: 4px; padding: 1px; }
.toast b { display: block; margin-bottom: 2px; }
"""


def copy_html(texts, key):
    h1, lead, points = texts["shots"][key]
    items = "".join(f"<li>{point}</li>" for point in points)
    return (f'<div class="copy"><div class="brand"><img src="{B.X}/img/icon-48.png" alt="" />Alza Price Insight</div>'
            f'<div class="kicker">{texts["kicker"]}</div><h1>{h1}</h1><p class="lead">{lead}</p><ul class="points">{items}</ul>{B.BARS}</div>')


def page(lang, texts, key, stage, css="", script="", content=False, changes=False):
    scripts = [f"<script>window.LANG = {lang!r}; window.EXT_VERSION = {B.VERSION!r};</script>", '<script src="../common.js"></script>',
               f'<script src="{B.X}/src/shared/core.js"></script>', f'<script src="{B.X}/src/shared/store.js"></script>',
               '<script src="../after-core.js"></script>']
    if changes:
        scripts.append('<script src="../changes.js"></script>')
    if content:
        scripts.append(B.CONTENT_TAGS)
    return f"""<!DOCTYPE html>
<html lang="{lang}"><head><meta charset="UTF-8" /><title>{key}</title>
<link rel="stylesheet" href="{B.X}/css/main.css" />
<style>{CSS}{css}</style></head>
<body><div class="rframe">{copy_html(texts, key)}<div class="rstage">{stage}</div></div>
{"".join(scripts)}
<script>{script}</script>
</body></html>
"""


# Popup z build.py a navíc zdražení a konec prodeje mezi novými změnami – barvy všech druhů změn na jednom místě
NEWS_CHANGES = """<script>(() => {
  const M = MARKET, c = M.conv, P = __products, now = Date.now();
  const lang = AlzaCore.getDisplayLanguage(__store.alzaSettings, AlzaCore.domains[M.domain].lang);
  const t = (key, ...params) => AlzaCore.translate(lang, key, ...params);
  const state = __store.alzaWatchState;
  const item = (k, minutes, price, lines) => ({ key: AlzaCore.getProductKey(M.domain, P[k].url), at: now - minutes * 60000, name: P[k].name,
    url: P[k].url, image: null, price, listName: M.lists[0], listUrl: state.recent[0].listUrl, lines });
  const rise = item("vacuum", 8, AlzaCore.formatPrice(c(12990), M.domain), [AlzaCore.formatPriceRise(lang, t("type_original"), c(9990), c(12990), M.domain)]);
  const ended = item("capsules", 8, null, [t("notifyAvailability", AlzaCore.getAvailabilityLabel("in", lang), AlzaCore.getAvailabilityLabel("ended", lang))]);
  state.recent.splice(1, 0, rise);
  state.recent.splice(3, 0, ended);
  state.unseen.push(rise.key, ended.key);
})();</script><style>.changes-list { max-height: none; }</style>"""


def news_popup(lang):
    html = B.popup_frame(lang)
    marker = '<script src="../changes.js"></script>'
    assert marker in html
    return html.replace(marker, marker + NEWS_CHANGES)


def shot_news(lang, texts):
    # Skutečný popup s barevným přehledem změn a jedna notifikace
    return page(lang, texts, "news", f"""<div class="window pop">{B.BAR}<iframe src="popup-news-{lang}.html" scrolling="no"></iframe></div>
<div class="toast" style="right: 6px; bottom: 70px"><div class="toast-app"><img src="{B.X}/img/icon-48.png" alt="" />Alza Price Insight</div><b id="t"></b><div id="x"></div></div>""",
                css=""".pop { width: 520px; } .pop iframe { display: block; width: 514px; height: 760px; border: 0; background: #fff; }""",
                script="""document.getElementById("t").textContent = __products.watch.name; document.getElementById("x").textContent = __changes.watch[0];""",
                changes=True)


def shot_list(lang, texts):
    # Seznam: kapsle 3 ks se stupni množstevní slevy, hodinky 2 ks, sluchátka s nejnižší cenou s AlzaPlus+ → varování před košíkem
    m = B.MOCK[lang]
    return page(lang, texts, "list", f'<div class="window lw">{B.BAR}<div class="inner"><div class="list-title">{m["list"]} <span>3</span></div><div id="list"></div></div></div>',
                css="""
.lw { width: 920px; }
.lw .inner { padding: 20px 24px 150px; font-size: 14px; }
.list-title { font-size: 21px; font-weight: 700; margin: 0 0 14px; }
.list-title span { font-size: 13px; font-weight: 400; color: #757575; margin-left: 6px; }
[data-testid="shoppingListItem"] { display: grid; grid-template-columns: 44px 186px 96px 62px 1fr 40px; column-gap: 10px; align-items: center; padding: 14px 12px;
  border-top: 1px solid #eee; }
.thumb { width: 44px; height: 44px; border-radius: 8px; background: #f2f4f7; display: flex; align-items: center; justify-content: center; font-size: 22px; }
[data-testid="shoppingListItem_name"] { color: #1653a4; font-weight: 600; text-decoration: none; line-height: 1.3; }
.qty { display: flex; align-items: center; gap: 4px; }
.qty button { width: 26px; height: 26px; border-radius: 50%; border: 1px solid #ccc; background: #fff; font-size: 15px; line-height: 1; padding: 0; }
.qty input { width: 34px; height: 26px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 6px; text-align: center; font: inherit; }
[data-testid="shoppingListItem_availability"] { color: #2e7d32; font-size: 13px; }
[data-testid="shoppingListItem_price"] { justify-self: end; display: flex; justify-content: flex-end; align-items: center; gap: 4px; white-space: nowrap; }
[data-testid="shoppingListItem_price"] .alza-price-tracker-price { box-sizing: border-box; min-width: 84px; padding: 10px 12px !important; text-align: right; }
[data-testid="shoppingListItem_addToCartButton"] { width: 36px; height: 36px; border-radius: 8px; border: 0; background: #e8f5e9; font-size: 17px; }
""", script=f"""
(async () => {{
  const T = setupTracker();
  T.state.targets = {{}};
  const cap = __products.capsules.url;
  __records[cap] = {{ ...__records[cap], quantityTiers: [[1, 1, MARKET.capsules.original], [2, 3, MARKET.capsules.before], [4, 99, MARKET.capsules.applus]] }};
  const list = document.getElementById("list");
  const rows = {{}};
  for (const [key, quantity] of [["capsules", 3], ["watch", 2], ["headphones", 1]]) {{
    const p = __products[key];
    const item = document.createElement("div");
    item.dataset.testid = "shoppingListItem";
    item.innerHTML = '<div class="thumb">' + p.icon + '</div><a data-testid="shoppingListItem_name"></a>' +
      '<div class="qty"><button data-testid="button-decrease">−</button><input data-testid="slider/valueInput" /><button data-testid="button-increase">+</button></div>' +
      '<span data-testid="shoppingListItem_availability"></span><span data-testid="shoppingListItem_price"></span>' +
      '<button data-testid="shoppingListItem_addToCartButton">🛒</button>';
    item.querySelector("a").href = p.url;
    item.querySelector("a").textContent = p.name;
    item.querySelector("input").value = String(quantity);
    item.querySelector('[data-testid="shoppingListItem_availability"]').textContent = {m["inStock"]!r};
    list.appendChild(item);
    rows[key] = item;
    await T.displayAllPrices(item, null, __records[p.url]);
  }}
  setTimeout(() => {{
    T.fitQuantityTotals();
    const item = rows.headphones;
    const button = item.querySelector('[data-testid="shoppingListItem_addToCartButton"]');
    T.showCartWarning(button, [{{ item, condition: T.getConditionalLowest(T.state.itemData.get(item).priceMap) }}]);
    // Na obrázku vždy pod tlačítkem – nad ním by zakryl součty v řádcích výš
    const box = document.querySelector(".alza-price-tracker-cart-warning");
    const rect = button.getBoundingClientRect();
    box.style.top = rect.bottom + window.scrollY + 12 + "px";
    box.classList.replace("alza-price-tracker-cart-warning--above", "alza-price-tracker-cart-warning--below");
  }}, 400);
}})();
""", content=True)


def shot_detail(lang, texts):
    # Detail: sluchátka bez akce, v historii pravidelné akce (−17 % zhruba každých 6 týdnů, další za ~8 dní) a levnější stavy
    labels = {"cs": ("Nový", "Rozbalený", "Zánovní"), "en": ("New", "Unpacked", "Like new")}[lang]
    prices = (2999, 2690, 2490)
    buttons = "".join(f'<button class="v a{" sel" if i == 0 else ""}"><div aria-label="{label}">{label}</div><div class="vp">{B.money(lang, price)}</div></button>'
                      for i, (label, price) in enumerate(zip(labels, prices)))
    return page(lang, texts, "detail", f"""<div class="window dw">{B.BAR}<div class="inner">
  <div id="detailItem"><div class="left-cnt"><div class="gallery">🎧</div></div>
  <div class="right"><div class="title" id="name"></div>
    <div class="component detailVariants">{buttons}</div>
    <div class="pricebox"><div class="now">{B.money(lang, 2999)}</div><div class="cart">{B.MOCK[lang]["cart"]}</div></div>
    <div class="fake" style="width:80%;margin-top:22px"></div><div class="fake" style="width:65%"></div>
  </div></div></div></div>""", css="""
.dw { width: 900px; }
.dw .inner { padding: 22px 24px; }
#detailItem { display: grid; grid-template-columns: 500px 1fr; gap: 24px; align-items: start; }
.gallery { height: 110px; border-radius: 10px; background: #f2f4f7; display: flex; align-items: center; justify-content: center; font-size: 56px; }
.dw .alza-price-tracker-product { margin-top: 12px; }
.title { font-size: 19px; font-weight: 700; line-height: 1.25; }
.detailVariants { display: flex; gap: 6px; margin-top: 14px; }
.v { flex: 1; padding: 7px 6px; border: 1px solid #d6d6d6; border-radius: 8px; background: #fff; font: inherit; font-size: 12px; text-align: center; }
.v.sel { border: 2px solid #1e1e1e; font-weight: 700; }
.vp { color: #616161; margin-top: 2px; }
.pricebox { margin-top: 14px; padding: 14px; border: 1px solid #e6e6e6; border-radius: 10px; }
.now { font-size: 26px; font-weight: 800; }
.cart { margin-top: 12px; padding: 9px; border-radius: 8px; background: #1e1e1e; color: #fff; text-align: center; font-weight: 700; font-size: 14px; }
.fake { height: 12px; margin-top: 10px; background: #e9edf2; border-radius: 6px; }
""", script="""
(async () => {
  const T = setupTracker();
  const p = __products.headphones;
  document.getElementById("name").textContent = p.name;
  const D = 86400000, now = Date.now();
  const c = MARKET.conv;
  // Úseky [od dní, do dní, akce]: obvykle 2 999, akce 2 499 na 7 dní každých 42 dní, poslední před 34 dny
  const segments = [[175, 160], [160, 153, true], [153, 118], [118, 111, true], [111, 76], [76, 69, true], [69, 34], [34, 27, true], [27, 0]];
  __store[`alzaHistory_${MARKET.domain}_7001`] = segments.map(([from, to, sale]) => ({
    t: now - from * D, s: now - to * D - (to === 0 ? 0 : 60000), p: sale ? { original: c(2999), special: c(2499) } : { original: c(2999) }, a: "in",
  }));
  const record = { original: c(2999), lastUpdated: now, minPrice: { value: c(2499), timestamp: now - 30 * D }, maxPrice: { value: c(2999), timestamp: now - 20 * D } };
  T.state.targets = {};
  T.state.product = { url: p.url, name: p.name, image: null };
  T.state.productData = record;
  T.getProductPagePrices = () => ({ original: c(2999) });
  T.getProductWatchInfo = async () => ({ watched: true, lists: [MARKET.lists[0]] });
  await T.renderProductPanel();
})();
""", content=True)


def options_frame(lang):
    # Skutečná stránka nastavení s náhradou chrome.* a absolutními cestami: kontrola jednou denně, otevřená nápověda
    # „?“ u frekvence. Vzdálené obrázky zakázané (jako u popupu)
    html = (B.REPO / "src/options/options.html").read_text(encoding="utf-8")
    html = html.replace('"../../', f'"{B.X}/').replace('"../', f'"{B.X}/src/').replace('src="options', f'src="{B.X}/src/options/options')
    core = f'<script src="{B.X}/src/shared/core.js"></script>'
    assert core in html
    mock = (f'<script>window.LANG = {lang!r}; window.EXT_VERSION = {B.VERSION!r};</script><script src="../common.js"></script>'
            '<script>__store.alzaSettings = { ...__store.alzaSettings, checkSchedule: "daily", checkTime: "08:00", quietHours: true };</script>')
    html = html.replace(core, mock + core)
    csp = '<meta http-equiv="Content-Security-Policy" content="img-src file: data:" />'
    force = ("<style>html { zoom: 1.12; overflow: hidden; } "
             ".info.promo-tip::after { visibility: visible; opacity: 1; } .info.promo-tip { border-color: var(--blue); color: var(--blue); }</style>")
    html = html.replace("<head>", f"<head>{csp}", 1).replace("</head>", force + "</head>", 1)
    # Nastavení po načtení posouvá stránku k záložkám dole – na obrázku má být vidět horní část
    tip = """<script>[300, 800, 1500].forEach((ms) => setTimeout(() => {
  document.querySelector('[data-i18n-tip="checkScheduleTip"]')?.classList.add("promo-tip");
  window.scrollTo(0, 0);
}, ms));</script>"""
    return html.replace("</body>", tip + "</body>", 1)


def shot_settings(lang, texts):
    return page(lang, texts, "settings", f'<div class="window ow">{B.BAR}<iframe src="options-{lang}.html" scrolling="no"></iframe></div>',
                css=""".ow { width: 760px; } .ow iframe { display: block; width: 754px; height: 740px; border: 0; background: #f4f5f7; }""")


SHOTS = {"news": shot_news, "list": shot_list, "detail": shot_detail, "settings": shot_settings}


def main(out):
    version = B.VERSION
    release = RELEASES.get(version)
    if not release:
        print(f"Promo novinek: verze {version} nemá texty v release.py (RELEASES) – přeskočeno")
        return
    for lang, texts in release.items():
        (B.PAGES / f"options-{lang}.html").write_text(options_frame(lang), encoding="utf-8")
        (B.PAGES / f"popup-news-{lang}.html").write_text(news_popup(lang), encoding="utf-8")
        target = out / "release" / lang
        for index, key in enumerate(ORDER):
            html = B.PAGES / f"release-{lang}-{index + 1}.html"
            html.write_text(SHOTS[key](lang, texts), encoding="utf-8")
            png = target / f"{index + 1}-{SLUGS[lang][key]}.png"
            B.render(html, png, WIDTH, HEIGHT)
            print(png.relative_to(out))
        (target / "post.txt").write_text(texts["post"] + "\n", encoding="utf-8")
        print((target / "post.txt").relative_to(out))
