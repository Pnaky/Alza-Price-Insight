// Audit 2026-11-12, výpisy kategorií (src/category.js): stav řazení viditelný i s vypnutým filtrem slev, úplnost
// výpisu bez počtu položek, atribut výšky bloku ceny jen s cenou za jednotku, úklid po staré instanci skriptu
// a čtení cen dlaždice jednou za průchod. category.js je content script – načte se do izolovaného kontextu
// s jádrem a s náhradou jen těch pár volání DOM, která testované funkce potřebují: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadCore } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "src/category.js"), "utf8");
const LANGUAGES = ["cz", "sk", "hu", "en"];

// Náhrada document: bez výpisu (init při načtení skriptu hned skončí); find / findAll jde v testu přepsat
function createDocument() {
  const attributes = {};
  return {
    attributes,
    find: () => null,
    findAll: () => [],
    querySelector(selector) {
      return this.find(selector);
    },
    querySelectorAll(selector) {
      return this.findAll(selector);
    },
    documentElement: { toggleAttribute: (name, on) => (attributes[name] = on) },
  };
}

function loadCategory() {
  const { AlzaCore, context } = loadCore();
  const document = createDocument();
  Object.assign(context, {
    document,
    window: { location: { hostname: "www.alza.cz", origin: "https://www.alza.cz", hash: "", pathname: "/kapsle/18851136.htm" } },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: () => 0,
  });
  vm.runInContext(source, context, { filename: "src/category.js" });
  return { AlzaCore, context, document, category: vm.runInContext("AlzaUnitPrice", context) };
}

// === 13: stav řazení a „Načíst dalších N“ s vypnutým filtrem slev ===

test("blok v levém panelu je vidět při řazení a načítání i s vypnutým filtrem slev", () => {
  const { category } = loadCategory();
  const visible = (discountEnabled, active, loading) => {
    Object.assign(category.state, { discountEnabled });
    category.state.sort.active = active;
    category.state.load.loading = loading;
    return category.isFilterBlockVisible();
  };
  assert.equal(visible(false, true, false), true, "seřazeno – „Seřazeno 504 z 3000“ a „Načíst dalších N“");
  assert.equal(visible(false, false, true), true, "načítání – „Načítám produkty…“");
  assert.equal(visible(true, false, false), true, "zapnutý filtr slev");
  assert.equal(visible(false, false, false), false, "nic k ukázání – prázdný rámeček se neukazuje");
});

test("blok se neskrývá podle volby filtru slev – tou se skrývá jen prvek filtru", () => {
  const mount = source.slice(source.indexOf("  mountInAlza("), source.indexOf("  isFilterBlockVisible("));
  assert.match(mount, /block\.classList\.toggle\("alza-price-tracker-hidden", !this\.isFilterBlockVisible\(\)\)/);
  assert.doesNotMatch(mount, /discountEnabled/, "mountInAlza volbu filtru slev sám nečte");
  assert.match(source, /discount\.classList\.toggle\("alza-price-tracker-hidden", !this\.state\.discountEnabled\)/);
});

// === Úplnost výpisu bez počtu položek ===

test("výpis bez počtu položek není úplný, dokud Alza nabízí další produkty", () => {
  const { category } = loadCategory();
  assert.equal(category.isListingComplete(24, null, true), false, "bez počtu a s „24 dalších…“");
  assert.equal(category.isListingComplete(24, null, false), true, "bez počtu, výpis končí");
  assert.equal(category.isListingComplete(24, 132, true), false);
  assert.equal(category.isListingComplete(132, 132, true), true, "načtený celý známý počet");
  assert.equal(category.isListingComplete(48, 132, false), true, "Alza další nenabízí");
});

test("stav bez počtu položek nepředstírá celý výpis", () => {
  const { category } = loadCategory();
  const base = { loading: false, failed: false, active: false, filterActive: false, counts: null, loaded: 24, total: null, hasMore: true, small: false, energyListing: false };
  // Přes JSON – pole z izolovaného kontextu mají jiný prototyp než pole testu
  const parts = (change) => JSON.parse(JSON.stringify(category.getStatusParts({ ...base, ...change })));
  const keys = (change) => parts(change).map(([key]) => key);

  assert.deepEqual(parts({ active: true }), [["sortPartialUnknown", 24]]);
  assert.deepEqual(parts({ active: true, failed: true }), [["sortLoadFailedUnknown", 24]]);
  assert.deepEqual(parts({ loading: true, active: true }), [["sortLoadingUnknown", 24]]);
  assert.deepEqual(parts({ filterActive: true, counts: { shown: 2, total: 24 } }), [["filterPartialUnknown", 2, 24], ["filterNarrow"]]);
  // Výpis končí – teprve teď je „Seřazeno N“ a „Vyhovuje X z Y“ pravda
  assert.deepEqual(parts({ active: true, hasMore: false }), [["sortDone", 24]]);
  assert.deepEqual(parts({ active: true, hasMore: false, energyListing: true }), [["sortDoneEnergy", 24]]);
  assert.deepEqual(parts({ filterActive: true, counts: { shown: 2, total: 24 }, hasMore: false }), [["filterStatus", 2, 24]]);
  // Se známým počtem beze změny
  assert.deepEqual(parts({ active: true, loaded: 504, total: 3000 }), [["sortPartial", 504, 3000]]);
  assert.deepEqual(parts({ active: true, failed: true, loaded: 48, total: 132 }), [["sortLoadFailed", 48, 132]]);
  assert.deepEqual(parts({ loading: true, loaded: 48, total: 132 }), [["sortLoading", 48, 132]]);
  assert.deepEqual(parts({ active: true, loaded: 132, total: 132 }), [["sortDone", 132]]);
  assert.deepEqual(keys({ filterActive: true, counts: { shown: 5, total: 48 }, loaded: 48, total: 132, small: true }), ["filterPartial"]);
  assert.deepEqual(keys({ active: true, filterActive: true, counts: { shown: 5, total: 504 }, loaded: 504, total: 3000 }), ["sortPartial", "filterPartial", "filterNarrow"]);
});

test("texty stavu bez počtu položek jsou ve všech jazycích a neodkazují na celkový počet", () => {
  const { category } = loadCategory();
  LANGUAGES.forEach((lang) => {
    category.state.lang = lang;
    ["sortLoadingUnknown", "sortPartialUnknown", "sortLoadFailedUnknown"].forEach((key) => {
      const text = category.translate(key, 24);
      assert.notEqual(text, key, `${lang}: chybí ${key}`);
      assert.match(text, /24/, `${lang} ${key}`);
      assert.doesNotMatch(text, /\{\d\}/, `${lang} ${key}: nevyplněný parametr`);
    });
    const filter = category.translate("filterPartialUnknown", 2, 24);
    assert.match(filter, /2\b.*24/, `${lang} filterPartialUnknown`);
    assert.doesNotMatch(filter, /\{\d\}/, `${lang} filterPartialUnknown: nevyplněný parametr`);
    if (lang !== "cz") assert.notEqual(category.translations[lang].sortPartialUnknown, category.translations.cz.sortPartialUnknown, `${lang}: nepřeloženo`);
  });
});

// === Atribut na <html> (výška bloku ceny Alzy) ===

test("úprava výšky bloku ceny Alzy se zapíná jen s cenou za jednotku, ne kvůli ceně provozu", () => {
  const { category, document } = loadCategory();
  const attribute = "data-alza-price-tracker-unit-price";
  category.state.unitPriceOn = false; // Zapnutá jen cena provozu (energyCost)
  category.setFeatures(true, false);
  assert.equal(document.attributes[attribute], false);
  category.state.unitPriceOn = true;
  category.setFeatures(true, false);
  assert.equal(document.attributes[attribute], true);
  category.state.unitPriceOn = false;
  category.setFeatures(false, true); // Jen filtr slev
  assert.equal(document.attributes[attribute], false);
});

test("štítek ceny provozu má vlastní pravidlo výšky bloku ceny, nezávislé na atributu", () => {
  const css = fs.readFileSync(path.join(ROOT, "css/main.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /#boxes \.price:has\(\.alza-price-tracker-param-price\)\s*\{[^}]*height:\s*auto\s*!important/);
  assert.match(css, /html\[data-alza-price-tracker-unit-price\] #boxes \.price--with-unit-price\s*\{[^}]*height:\s*auto\s*!important/);
  // Štítek ceny provozu nese i třídu štítku ceny za parametr – pravidlo :has() ho pokrývá
  assert.match(source, /element\.className = `\$\{this\.parameterClass\} \$\{this\.parameterClass\}--energy`/);
});

// === Pozůstatky staré instance skriptu (Firefox po aktualizaci rozšíření) ===

test("init uklidí řazení, filtr a zhasnutou záložku Alzy po staré instanci skriptu", async () => {
  const { category, document } = loadCategory();
  const removed = [];
  const tile = (name) => ({ style: { removeProperty: (property) => removed.push(`${name}:${property}`) } });
  const container = { children: [tile("a"), tile("b"), tile("banner")], querySelectorAll: () => [] };
  const hidden = { removeAttribute: (name) => removed.push(`hidden:${name}`) };
  const oldToolbar = { remove: () => removed.push("toolbar") };
  const classes = new Set();
  const dimmedTab = { classList: { add: (name) => classes.add(name) }, removeAttribute: (name) => removed.push(`tab:${name}`) };
  document.find = (selector) => (selector === ".browsingitem" ? {} : selector === "#boxes" ? container : null);
  document.findAll = (selector) => {
    if (selector.includes(".alza-price-tracker-unit-toolbar")) return [oldToolbar];
    if (selector === "[data-alza-price-tracker-discount-hidden]") return [hidden];
    if (selector === "[data-alza-price-tracker-active]") return [dimmedTab];
    return [];
  };

  await category.init();
  assert.ok(removed.includes("toolbar"), "stará lišta pryč");
  ["a:order", "b:order", "banner:order"].forEach((entry) => assert.ok(removed.includes(entry), `CSS order pryč (${entry})`));
  assert.ok(removed.includes("hidden:data-alza-price-tracker-discount-hidden"), "produkty skryté starým filtrem zpět");
  assert.ok(classes.has("sorting__item-link--active") && removed.includes("tab:data-alza-price-tracker-active"), "záložka řazení Alzy zpět");
});

test("úklid v init běží před čtením nastavení a nezávisí na stavu instance", () => {
  const init = source.slice(source.indexOf("  async init() {"), source.indexOf("  setFeatures("));
  const order = ["this.removeControls();", "this.clearSortOrder();", "this.clearFilter();", "await AlzaCore.getSettings()"].map((call) => init.indexOf(call));
  assert.ok(order.every((index) => index > 0), "init volá úklid i nastavení");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "úklid před prvním await");
  const clear = source.slice(source.indexOf("  clearSortOrder() {"), source.indexOf("  // Pořadí přes CSS order"));
  assert.doesNotMatch(clear, /this\.state/, "clearSortOrder čte jen DOM");
});

// === Výkon: ceny dlaždice jednou za průchod, klíč produktu jednou na odkaz ===

test("ceny dlaždice se v jednom průchodu čtou z DOM jednou, mimo průchod vždy znovu", () => {
  const { category, AlzaCore } = loadCategory();
  let reads = 0;
  let quantityDiscount = false;
  AlzaCore.hasListingQuantityDiscount = () => quantityDiscount;
  AlzaCore.extractPricesFromListingItem = () => (reads++, { original: 499, applus: 429 });
  const item = {};
  const other = {};

  category.state.pass = { prices: new WeakMap(), items: null };
  const first = category.getItemPrices(item);
  assert.equal(category.getItemPrices(item), first, "štítek i filtr dostanou tentýž výsledek");
  assert.deepEqual(JSON.parse(JSON.stringify(first)), { quantity: false, prices: { original: 499, applus: 429 } });
  assert.equal(reads, 1);
  category.getItemPrices(other);
  assert.equal(reads, 2, "každá dlaždice zvlášť");

  category.state.pass = { prices: new WeakMap(), items: null }; // Další průchod – DOM se mohl změnit
  category.getItemPrices(item);
  assert.equal(reads, 3);

  category.state.pass = null;
  category.getItemPrices(item);
  category.getItemPrices(item);
  assert.equal(reads, 5, "mimo průchod se nic nedrží");

  quantityDiscount = true; // Cena „od …“ není cena jednoho kusu – ceny se nečtou
  assert.deepEqual(JSON.parse(JSON.stringify(category.getItemPrices(item))), { quantity: true, prices: null });
  assert.equal(reads, 5);
});

test("průchod update() po sobě data průchodu vždy zahodí – i když spadne", () => {
  const { category } = loadCategory();
  category.state.enabled = true;
  let inside = null;
  category.applyFilter = () => (inside = category.state.pass);
  category.update();
  assert.equal(typeof inside?.prices?.get, "function", "uvnitř průchodu jsou sdílená data k dispozici");
  assert.equal(category.state.pass, null);
  category.applyFilter = () => {
    throw new Error("test");
  };
  assert.throws(() => category.update(), /test/);
  assert.equal(category.state.pass, null);
});

test("seznam boxů výpisu se v průchodu čte z DOM jednou", () => {
  const { category, document } = loadCategory();
  let queries = 0;
  const boxes = [{}, {}];
  document.find = (selector) => (selector === "#boxes" ? { querySelectorAll: () => (queries++, boxes) } : null);
  category.state.pass = { prices: new WeakMap(), items: null };
  assert.equal(category.getListItems().length, 2);
  assert.equal(category.getListItems(), category.getListItems());
  assert.equal(queries, 1);
  category.state.pass = null;
  category.getListItems();
  category.getListItems();
  assert.equal(queries, 3, "načítání dalších stránek čte živý DOM");
});

test("klíč produktu se z odkazu dlaždice počítá jednou, při změně odkazu znovu", () => {
  const { category, context, AlzaCore } = loadCategory();
  category.state.domainKey = "alza_cz";
  let parsed = 0;
  const NativeURL = context.URL;
  context.URL = class extends NativeURL {
    constructor(...args) {
      super(...args);
      parsed++;
    }
  };
  let href = "/jar-platinum-plus-d7654321.htm";
  const item = { querySelector: () => ({ getAttribute: () => href }) };
  const key = category.getItemProductKey(item);
  assert.equal(key, AlzaCore.getProductKey("alza_cz", href));
  assert.equal(category.getItemProductKey(item), key);
  assert.equal(parsed, 1);
  href = "/persil-discs-d1234567.htm?dq=99";
  assert.equal(category.getItemProductKey(item), AlzaCore.getProductKey("alza_cz", href));
  assert.equal(parsed, 2);
  assert.equal(category.getItemProductKey({ querySelector: () => null }), null, "dlaždice bez odkazu");
});
