// Content script: lišta nad výpisy kategorií a vyhledávání.
// 1) Cena za jednotku (volba categoryUnitPrice, jen výpisy, kde ji Alza ukazuje): Alza ji počítá z ceny pro
//    všechny (akce, Black Friday) – AlzaPlus+ ani slevový kód do ní nezahrne, ani když členovi AlzaPlus+ ukáže
//    jeho cenu jako hlavní. Před Alzinu cenu za jednotku doplní přepočet z nejnižší ceny v boxu produktu
//    a v liště řazení podle skutečné ceny.
// 2) Filtr slev (volba categoryDiscountFilter, všechny výpisy): „Sleva aspoň X %“, „Jen s kupónem“ a „S množstevní slevou“ –
//    sleva z nejnižší ceny k zaplacení proti obvyklé ceně z historie, jinak proti přeškrtnuté ceně
//    (AlzaCore.getListingDiscount). Nevyhovující produkty jen skryje, DOM Alzy zůstává.
// Řazení nejdřív načte výpis (Alzino "24 dalších…", po dávkách ~500); filtr sám jen výpis do autoLoadMaxItems
const AlzaUnitPrice = {
  selectors: {
    item: ".browsingitem", // box produktu ve výpisu
    unitPrice: ".unit-price__label", // "3,50 Kč/ks"
    parameterAnchor: ".price__price-box-wrapper", // obal cenového boxu – Alza do něj dává cenu za jednotku, my cenu za parametr
    name: "a.name",
    description: ".Description", // "… 360 ks v balení - 3,50 Kč/1 ks"
    // Cenový box – stejné selektory jako ukládání cen z výpisu (AlzaCore.extractPricesFromListingItem)
    ...AlzaCore.listingSelectors,
    container: "#boxes", // flex kontejner boxů – řadí se jen CSS order, DOM Alzy zůstává
    sorting: ".js-sorting", // záložky řazení Alzy – lišta pod ně
    moreButton: ".js-button-more", // "24 dalších…"
    pageLink: "a.pgn", // čísla stránek pod výpisem
    itemCount: "[id^='lblNumberItem']", // "132 položek"
  },
  availableClass: "canBuy", // Box produktu, který jde koupit (jinak "Hlídat" – nedostupné, na objednávku)
  maxLoadSteps: 20, // Nejvýš tolik kliknutí na "24 dalších…" najednou (zhruba 500 produktů)
  defaultPageSize: 24, // Produktů na jedno "24 dalších…", když počet v tlačítku chybí
  // Filtr slev načte celý výpis sám jen do tolika produktů (jedna dávka načítání). Větší výpis (desetitisíce
  // v kategorii) filtruje jen načtené – dál tlačítkem „Načíst dalších…“, nebo ho zúžit filtry Alzy
  autoLoadMaxItems: 500,
  loadStepTimeoutMs: 10000,
  loadStepDelayMs: 300, // Pauza mezi načtením stránek, ať se Alza nezahltí
  // Kupóny s cenou → text u přepočtu. Cashback cenu nemá ("až 650,-"), ostatní typy neznáme
  couponTypes: { applus: "withAlzaPlus", discountcode: "withCode", discountcoupon: "withCode", discountcouponpaywall: "withCode" },
  // Hlavní cena, ze které Alza cenu za jednotku nepočítá (cena pro člena, benefit, B2B)
  personalPriceHeader: /alza\s*plus|benefit|b2b/i,
  memberPriceHeader: /alza\s*plus/i,
  countUnits: ["ks", "db"], // Jednotky, jejichž počet jde přečíst z popisku ("360 ks v balení")
  // Bez počtu v textu se množství dopočítá poměrem cen – jen když zaokrouhlení ceny za jednotku na
  // setiny zkreslí výsledek nanejvýš o 0,5 % (u "0,04 Kč/útržek" by to bylo až 12 %)
  minRatioUnitPrice: 1,
  elementClass: "alza-price-tracker-unit-price",
  parameterClass: "alza-price-tracker-param-price", // Cena za parametr (Kč/TB…) tam, kde Alza cenu za jednotku neukazuje
  discountSteps: [0, 10, 20, 30, 40, 50], // Volby filtru „Sleva aspoň X %“ (0 = vše)
  filteredAttribute: "data-alza-price-tracker-discount-hidden", // Produkt skrytý filtrem slev (main.css)

  translations: {
    cz: {
      withAlzaPlus: "s AlzaPlus+",
      withCode: "se slevovým kódem",
      unitPriceHint: "Alza počítá cenu za jednotku z ceny bez AlzaPlus+ a slevových kódů.\n{0} / {1} = {2}",
      parameterHint: "Price Insight: přepočet z nejnižší ceny, kterou zaplatíte (i s AlzaPlus+ a slevovým kódem).\n{0} / {1} = {2}",
      // Štítek ceny provozu podle počtu let: 1 rok / 2–4 roky / 5 a více let
      energyLabelOne: "provoz 1 rok: {1}",
      energyLabelFew: "provoz {0} roky: {1}",
      energyLabelMany: "provoz {0} let: {1}",
      energyHintYear: "Price Insight: odhad ceny elektřiny (počet let: {4}).\n{0} kWh/rok × {1}/kWh × {4} = {2}\nS pořizovací cenou celkem {3}. Cenu elektřiny a počet let změníte v nastavení rozšíření.",
      energyHintCycles: "Price Insight: odhad ceny elektřiny (počet let: {5}).\n{0} kWh/100 cyklů × {1}× týdně = {2} kWh/rok × {3}/kWh × {5} = {4}\nS pořizovací cenou celkem {6}. Cenu elektřiny, počet let a praní týdně změníte v nastavení rozšíření.",
      sortTabEnergy: "S provozem",
      sortStartEnergy: "Seřadit podle ceny včetně provozu",
      sortStartHintEnergy: "Načte všechny produkty výpisu a seřadí je podle pořizovací ceny a elektřiny za zvolený počet let dohromady – od nejlevnějšího celkem.",
      sortTabActiveHintEnergy: "Price Insight: seřazeno podle ceny včetně provozu. Kliknutím znovu řazení zrušíte.",
      sortDoneEnergy: "Seřazeno {0} produktů podle ceny včetně provozu",
      sortStart: "Seřadit podle skutečné ceny za jednotku",
      sortStartHint: "Načte všechny produkty výpisu a seřadí je podle nejnižší ceny za jednotku – i s AlzaPlus+ a slevovými kódy. Alzino řazení „Nejlevnější za jednotku“ je nezapočítává.",
      sortCancel: "Zrušit řazení",
      sortLoading: "Načítám produkty {0} / {1}…",
      sortDone: "Seřazeno {0} produktů podle skutečné ceny za jednotku",
      sortPartial: "Seřazeno {0} z {1} produktů",
      sortLoadRest: "Načíst dalších {0}",
      sortLoadFailed: "Další produkty se nepodařilo načíst – seřazeno {0} z {1}",
      // Stránka neukazuje počet položek a výpis pokračuje – stav nesmí předstírat celý výpis
      sortLoadingUnknown: "Načítám produkty ({0})…",
      sortPartialUnknown: "Seřazeno prvních {0} produktů, výpis pokračuje",
      sortLoadFailedUnknown: "Další produkty se nepodařilo načíst – seřazeno prvních {0}",
      sortTab: "Za jednotku",
      sortTabActiveHint: "Price Insight: seřazeno podle skutečné ceny za jednotku (i s AlzaPlus+ a slevovými kódy). Kliknutím znovu řazení zrušíte.",
      discountLabel: "Sleva",
      discountAll: "vše",
      discountMin: "aspoň {0} %",
      discountHint: "Sleva z nejnižší ceny, kterou zaplatíte (i s AlzaPlus+ a slevovým kódem). U produktů s historií cen proti obvyklé ceně, u ostatních proti přeškrtnuté ceně Alzy. Výpis do 500 produktů načte celý, větší filtruje jen načtené – zužte ho filtry Alzy.",
      couponOnly: "Jen s kupónem",
      couponOnlyHint: "Jen produkty s cenou s AlzaPlus+ nebo se slevovým kódem",
      bulkOnly: "S množstevní slevou",
      bulkOnlyHint: "Jen produkty s množstevní slevou Alzy „Kup víc, zaplať míň“ – při více kusech je kus levnější",
      filterStatus: "Vyhovuje {0} z {1}",
      filterPartial: "Vyhovuje {0} z {1} načtených (výpis má {2})",
      filterPartialUnknown: "Vyhovuje {0} z {1} načtených (výpis pokračuje)",
      filterNarrow: "Pro výběr ze všech zužte výpis filtry Alzy (do 500 produktů).",
    },
    sk: {
      withAlzaPlus: "s AlzaPlus+",
      withCode: "so zľavovým kódom",
      unitPriceHint: "Alza počíta cenu za jednotku z ceny bez AlzaPlus+ a zľavových kódov.\n{0} / {1} = {2}",
      parameterHint: "Price Insight: prepočet z najnižšej ceny, ktorú zaplatíte (aj s AlzaPlus+ a zľavovým kódom).\n{0} / {1} = {2}",
      energyLabelOne: "prevádzka 1 rok: {1}",
      energyLabelFew: "prevádzka {0} roky: {1}",
      energyLabelMany: "prevádzka {0} rokov: {1}",
      energyHintYear: "Price Insight: odhad ceny elektriny (počet rokov: {4}).\n{0} kWh/rok × {1}/kWh × {4} = {2}\nS obstarávacou cenou spolu {3}. Cenu elektriny a počet rokov zmeníte v nastaveniach rozšírenia.",
      energyHintCycles: "Price Insight: odhad ceny elektriny (počet rokov: {5}).\n{0} kWh/100 cyklov × {1}× týždenne = {2} kWh/rok × {3}/kWh × {5} = {4}\nS obstarávacou cenou spolu {6}. Cenu elektriny, počet rokov a praní týždenne zmeníte v nastaveniach rozšírenia.",
      sortTabEnergy: "S prevádzkou",
      sortStartEnergy: "Zoradiť podľa ceny vrátane prevádzky",
      sortStartHintEnergy: "Načíta všetky produkty výpisu a zoradí ich podľa obstarávacej ceny a elektriny za zvolený počet rokov spolu – od najlacnejšieho celkovo.",
      sortTabActiveHintEnergy: "Price Insight: zoradené podľa ceny vrátane prevádzky. Kliknutím znova zoradenie zrušíte.",
      sortDoneEnergy: "Zoradených {0} produktov podľa ceny vrátane prevádzky",
      sortStart: "Zoradiť podľa skutočnej ceny za jednotku",
      sortStartHint: "Načíta všetky produkty výpisu a zoradí ich podľa najnižšej ceny za jednotku – aj s AlzaPlus+ a zľavovými kódmi. Zoradenie Alzy „Najlacnejšie za jednotku“ ich nezapočítava.",
      sortCancel: "Zrušiť zoradenie",
      sortLoading: "Načítavam produkty {0} / {1}…",
      sortDone: "Zoradených {0} produktov podľa skutočnej ceny za jednotku",
      sortPartial: "Zoradených {0} z {1} produktov",
      sortLoadRest: "Načítať ďalších {0}",
      sortLoadFailed: "Ďalšie produkty sa nepodarilo načítať – zoradených {0} z {1}",
      sortLoadingUnknown: "Načítavam produkty ({0})…",
      sortPartialUnknown: "Zoradených prvých {0} produktov, výpis pokračuje",
      sortLoadFailedUnknown: "Ďalšie produkty sa nepodarilo načítať – zoradených prvých {0}",
      sortTab: "Za jednotku",
      sortTabActiveHint: "Price Insight: zoradené podľa skutočnej ceny za jednotku (aj s AlzaPlus+ a zľavovými kódmi). Kliknutím znova zoradenie zrušíte.",
      discountLabel: "Zľava",
      discountAll: "všetko",
      discountMin: "aspoň {0} %",
      discountHint: "Zľava z najnižšej ceny, ktorú zaplatíte (aj s AlzaPlus+ a zľavovým kódom). Pri produktoch s históriou cien voči obvyklej cene, pri ostatných voči prečiarknutej cene Alzy. Výpis do 500 produktov načíta celý, väčší filtruje len načítané – zúžte ho filtrami Alzy.",
      couponOnly: "Len s kupónom",
      couponOnlyHint: "Len produkty s cenou s AlzaPlus+ alebo so zľavovým kódom",
      bulkOnly: "S množstevnou zľavou",
      bulkOnlyHint: "Len produkty s množstevnou zľavou Alzy „Kúp viac, zaplať menej“ – pri viacerých kusoch je kus lacnejší",
      filterStatus: "Vyhovuje {0} z {1}",
      filterPartial: "Vyhovuje {0} z {1} načítaných (výpis má {2})",
      filterPartialUnknown: "Vyhovuje {0} z {1} načítaných (výpis pokračuje)",
      filterNarrow: "Na výber zo všetkých zúžte výpis filtrami Alzy (do 500 produktov).",
    },
    hu: {
      withAlzaPlus: "AlzaPlus+-szal",
      withCode: "kuponkóddal",
      unitPriceHint: "Az Alza az egységárat az AlzaPlus+ és kuponkódok nélküli árból számolja.\n{0} / {1} = {2}",
      parameterHint: "Price Insight: a legalacsonyabb fizetendő árból számolva (AlzaPlus+-szal és kuponkóddal együtt).\n{0} / {1} = {2}",
      energyLabelOne: "üzemeltetés 1 évre: {1}",
      energyLabelFew: "üzemeltetés {0} évre: {1}",
      energyLabelMany: "üzemeltetés {0} évre: {1}",
      energyHintYear: "Price Insight: az áram becsült költsége (évek száma: {4}).\n{0} kWh/év × {1}/kWh × {4} = {2}\nA vételárral együtt összesen {3}. Az áram árát és az évek számát a bővítmény beállításaiban módosíthatja.",
      energyHintCycles: "Price Insight: az áram becsült költsége (évek száma: {5}).\n{0} kWh/100 ciklus × heti {1}× = {2} kWh/év × {3}/kWh × {5} = {4}\nA vételárral együtt összesen {6}. Az áram árát, az évek és a heti mosások számát a bővítmény beállításaiban módosíthatja.",
      sortTabEnergy: "Üzemeltetéssel",
      sortStartEnergy: "Rendezés üzemeltetéssel együtt számolt ár szerint",
      sortStartHintEnergy: "Betölti a lista összes termékét, és a vételár plusz a választott évekre számolt áramköltség szerint rendezi – a legolcsóbb összköltségtől.",
      sortTabActiveHintEnergy: "Price Insight: üzemeltetéssel együtt számolt ár szerint rendezve. Újra kattintva a rendezés megszűnik.",
      sortDoneEnergy: "{0} termék rendezve üzemeltetéssel együtt számolt ár szerint",
      sortStart: "Rendezés valós egységár szerint",
      sortStartHint: "Betölti a lista összes termékét, és a legalacsonyabb egységár szerint rendezi – AlzaPlus+-szal és kuponkódokkal együtt. Az Alza „Legolcsóbb egységár” rendezése ezeket nem veszi figyelembe.",
      sortCancel: "Rendezés törlése",
      sortLoading: "Termékek betöltése {0} / {1}…",
      sortDone: "{0} termék rendezve valós egységár szerint",
      sortPartial: "{0} / {1} termék rendezve",
      sortLoadRest: "További {0} betöltése",
      sortLoadFailed: "A további termékeket nem sikerült betölteni – {0} / {1} rendezve",
      sortLoadingUnknown: "Termékek betöltése ({0})…",
      sortPartialUnknown: "Az első {0} termék rendezve, a lista folytatódik",
      sortLoadFailedUnknown: "A további termékeket nem sikerült betölteni – az első {0} rendezve",
      sortTab: "Egységár",
      sortTabActiveHint: "Price Insight: valós egységár szerint rendezve (AlzaPlus+-szal és kuponkódokkal együtt). Újra kattintva a rendezés megszűnik.",
      discountLabel: "Kedvezmény",
      discountAll: "mind",
      discountMin: "legalább {0} %",
      discountHint: "Kedvezmény a legalacsonyabb fizetendő árból (AlzaPlus+-szal és kuponkóddal együtt). Árelőzménnyel rendelkező termékeknél a szokásos árhoz, a többinél az Alza áthúzott árához képest. 500 termékig a teljes listát betölti, nagyobbnál csak a betöltötteket szűri – szűkítse az Alza szűrőivel.",
      couponOnly: "Csak kuponnal",
      couponOnlyHint: "Csak AlzaPlus+ vagy kuponkódos árral rendelkező termékek",
      bulkOnly: "Mennyiségi kedvezménnyel",
      bulkOnlyHint: "Csak az Alza mennyiségi kedvezményével kínált termékek – több darabnál olcsóbb a darabár",
      filterStatus: "{0} / {1} megfelel",
      filterPartial: "{0} / {1} betöltött megfelel (a lista {2} tételes)",
      filterPartialUnknown: "{0} / {1} betöltött megfelel (a lista folytatódik)",
      filterNarrow: "A teljes lista szűréséhez szűkítse az Alza szűrőivel (legfeljebb 500 termékre).",
    },
    en: {
      withAlzaPlus: "with AlzaPlus+",
      withCode: "with a discount code",
      unitPriceHint: "Alza calculates the unit price from the price without AlzaPlus+ and discount codes.\n{0} / {1} = {2}",
      parameterHint: "Price Insight: calculated from the lowest price you pay (including AlzaPlus+ and discount codes).\n{0} / {1} = {2}",
      energyLabelOne: "running cost, 1 year: {1}",
      energyLabelFew: "running cost, {0} years: {1}",
      energyLabelMany: "running cost, {0} years: {1}",
      energyHintYear: "Price Insight: estimated electricity cost (number of years: {4}).\n{0} kWh/year × {1}/kWh × {4} = {2}\nWith the purchase price {3} in total. Change the electricity price and the number of years in the extension settings.",
      energyHintCycles: "Price Insight: estimated electricity cost (number of years: {5}).\n{0} kWh/100 cycles × {1}× a week = {2} kWh/year × {3}/kWh × {5} = {4}\nWith the purchase price {6} in total. Change the electricity price, the number of years and washes per week in the extension settings.",
      sortTabEnergy: "With running cost",
      sortStartEnergy: "Sort by price including running cost",
      sortStartHintEnergy: "Loads all products of the listing and sorts them by the purchase price plus electricity for the chosen number of years – cheapest in total first.",
      sortTabActiveHintEnergy: "Price Insight: sorted by price including running cost. Click again to cancel the sorting.",
      sortDoneEnergy: "{0} products sorted by price including running cost",
      sortStart: "Sort by real unit price",
      sortStartHint: "Loads all products of the listing and sorts them by the lowest unit price – including AlzaPlus+ and discount codes. Alza's own unit price sorting ignores them.",
      sortCancel: "Cancel sorting",
      sortLoading: "Loading products {0} / {1}…",
      sortDone: "{0} products sorted by real unit price",
      sortPartial: "{0} of {1} products sorted",
      sortLoadRest: "Load {0} more",
      sortLoadFailed: "Couldn't load more products – {0} of {1} sorted",
      sortLoadingUnknown: "Loading products ({0})…",
      sortPartialUnknown: "First {0} products sorted, the listing continues",
      sortLoadFailedUnknown: "Couldn't load more products – first {0} sorted",
      sortTab: "Unit price",
      sortTabActiveHint: "Price Insight: sorted by the real unit price (including AlzaPlus+ and discount codes). Click again to cancel the sorting.",
      discountLabel: "Discount",
      discountAll: "all",
      discountMin: "at least {0} %",
      discountHint: "Discount from the lowest price you pay (including AlzaPlus+ and discount codes). Products with price history are compared with the usual price, others with Alza's crossed-out price. Listings up to 500 products are loaded whole, larger ones filter only the loaded products – narrow them with Alza's filters.",
      couponOnly: "Coupon only",
      couponOnlyHint: "Only products with an AlzaPlus+ or discount code price",
      bulkOnly: "Volume discount",
      bulkOnlyHint: "Only products with an Alza volume discount – more pieces, lower price per piece",
      filterStatus: "{0} of {1} match",
      filterPartial: "{0} of {1} loaded match (the listing has {2})",
      filterPartialUnknown: "{0} of {1} loaded match (the listing continues)",
      filterNarrow: "To filter all of them, narrow the listing with Alza's filters (to 500 products).",
    },
  },

  state: {
    domainKey: null,
    lang: "cz", // Jazyk textů (AlzaCore.getDisplayLanguage – volba v nastavení, jinak jazyk domény)
    scheduled: false,
    rendered: new WeakMap(), // Box produktu → { signature, shown, sortKey } posledního přepočtu
    parameters: new WeakMap(), // Box produktu → { text, parameter, energy } – hlavní parametr / spotřeba z názvu a popisku (updateParameterItem)
    // Cena provozu (volba energyCost): cena elektřiny za kWh v měně domény, počet let a cyklů týdně z nastavení
    energy: { enabled: false, price: 0, years: 10, cyclesPerWeek: 4 },
    load: { loading: false, failed: false, autoAnchor: null }, // Načítání celého výpisu (řazení i filtr)
    sort: { active: false, anchor: null }, // anchor = box z řazeného výpisu
    filter: { min: 0, coupon: false, bulk: false }, // Filtr slev: aspoň min %, jen s kupónem, jen s množstevní slevou
    filterCounts: null, // { shown, total } posledního průchodu filtru (stav v liště)
    histories: new Map(), // Klíč produktu → historie (getPriceChangeHistory) pro obvyklou cenu; null = načítá se / není
    discounts: new WeakMap(), // Box produktu → { signature, history, discount, quantity } posledního výpočtu (getItemDiscount)
    productKeys: new WeakMap(), // Box produktu → { href, key } – klíč produktu z odkazu (getItemProductKey)
    // Data jednoho průchodu update(): { prices: WeakMap box → { quantity, prices }, items: boxy výpisu }. Mimo průchod
    // null – DOM se mezi průchody mění, čte se vždy znovu
    pass: null,
    toolbar: null,
    unitEnabled: false, // Štítky a řazení zapnuté: cena za jednotku (categoryUnitPrice) nebo cena provozu (energyCost)
    unitPriceOn: false, // Jen volba categoryUnitPrice – cena za jednotku a za parametr; cena provozu má vlastní volbu
    discountEnabled: false,
    enabled: false, // Aspoň jedna z funkcí
    observer: null,
  },

  async init() {
    // Jen stránky s výpisem produktů (kategorie, vyhledávání); jinde nic nesledovat
    if (!document.querySelector(this.selectors.item)) return;
    // Lišta předchozí verze skriptu (Firefox ho po aktualizaci rozšíření vloží znovu) – mrtvá, pryč
    document.querySelectorAll(".alza-price-tracker-unit-toolbar, .alza-price-tracker-sort-tab, .alza-price-tracker-filter-block").forEach((element) => element.remove());
    // S lištou musí pryč i to, co stará instance nechala na prvcích Alzy: řazení (CSS order na dlaždicích), produkty
    // skryté filtrem slev a zhasnutá záložka řazení Alzy – jinak zůstane výpis seřazený po našem a nejde to zrušit.
    // Úklid čte jen DOM, na stavu nové instance nezávisí
    this.removeControls();
    this.clearSortOrder();
    this.clearFilter();

    this.state.domainKey = AlzaCore.getDomainKey(window.location.hostname);
    // Změna v nastavení se projeví hned i v otevřené stránce
    const key = AlzaCore.storageKeys.settings;
    const domainLang = AlzaCore.domains[this.state.domainKey].lang;
    const apply = (settings) => {
      this.state.lang = AlzaCore.getDisplayLanguage(settings, domainLang);
      // Změna se projeví dalším průchodem (nastavení je v podpisu štítku)
      this.state.energy = AlzaCore.getEnergySettings(settings, this.state.domainKey);
      // Cena za jednotku vypnutá, cena provozu dál zapnutá: štítky ceny za jednotku pryč, zbytek se vykreslí znovu
      if (this.state.unitPriceOn && !settings.categoryUnitPrice) {
        document.querySelectorAll(`.${this.elementClass}, .${this.parameterClass}:not(.${this.parameterClass}--energy)`).forEach((element) => element.remove());
        this.state.rendered = new WeakMap();
      }
      this.state.unitPriceOn = Boolean(settings.categoryUnitPrice);
      this.setFeatures(settings.categoryUnitPrice || settings.energyCost, settings.categoryDiscountFilter);
    };
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[key]) apply({ ...AlzaCore.defaultSettings, ...changes[key].newValue });
    });
    apply(await AlzaCore.getSettings());
  },

  setFeatures(unitEnabled, discountEnabled) {
    const { state } = this;
    if (state.unitEnabled && !unitEnabled) {
      // Cena za jednotku vypnutá: pryč se štítky a naším řazením – výpis zůstane, jak ho Alza vykreslila
      Object.assign(state.sort, { active: false, anchor: null });
      this.clearSortOrder();
      document.querySelectorAll(`.${this.elementClass}, .${this.parameterClass}`).forEach((element) => element.remove());
      state.rendered = new WeakMap();
    }
    if (state.discountEnabled && !discountEnabled) {
      Object.assign(state.filter, { min: 0, coupon: false, bulk: false });
      this.clearFilter();
    }
    state.unitEnabled = Boolean(unitEnabled);
    state.discountEnabled = Boolean(discountEnabled);
    // Úprava výšky bloku ceny Alzy (main.css, .price--with-unit-price) jen se zapnutou cenou za jednotku
    // (categoryUnitPrice): potřebuje ji náš štítek vedle Alziny ceny za jednotku. Cena provozu ji nepotřebuje –
    // její štítek (i cena za parametr) je v dlaždicích bez Alziny ceny za jednotku a výšku bloku si řeší vlastním
    // pravidlem #boxes .price:has(.alza-price-tracker-param-price)
    document.documentElement.toggleAttribute("data-alza-price-tracker-unit-price", state.unitEnabled && state.unitPriceOn);

    const enabled = state.unitEnabled || state.discountEnabled;
    if (enabled && !state.enabled) {
      // Další produkty ("24 dalších…"), filtry a řazení Alza dokreslí bez načtení stránky
      state.observer = AlzaCore.createObserver(() => this.scheduleUpdate(), { ignoreOwn: true });
      state.observer.observe(document.body, { childList: true, subtree: true });
    } else if (!enabled && state.enabled) {
      state.observer?.disconnect();
      state.observer = null;
      this.removeControls();
    }
    state.enabled = enabled;
    if (enabled) this.update();
  },

  // Změna jen v našich prvcích (přepočet, lišta) nebo jejich vložení další průchod nepotřebuje. Odebrání
  // našeho prvku Alzou ano – přepočet se musí vrátit
  translate(key, ...params) {
    return AlzaCore.translateFrom(this.translations, this.state.lang, key, params);
  },

  // Sloučí změny DOM do jednoho průchodu za snímek
  scheduleUpdate() {
    if (this.state.scheduled) return;
    this.state.scheduled = true;
    requestAnimationFrame(() => {
      this.state.scheduled = false;
      this.update();
    });
  },

  update() {
    if (!this.state.enabled) return; // Naplánovaný průchod po vypnutí v nastavení
    const { sort, load } = this.state;
    let autoLoad = false;
    // Průchod běží jednou za snímek při jakékoli změně DOM stránky a výpis může mít tisíce dlaždic: ceny dlaždice
    // a seznam boxů se v něm čtou z DOM jednou a sdílí je štítky, filtr slev, řazení i lišta (getItemPrices, getListItems)
    this.state.pass = { prices: new WeakMap(), items: null };
    try {
      if (this.state.unitEnabled) {
        document.querySelectorAll(this.selectors.item).forEach((item) => {
          try {
            this.updateItem(item);
          } catch (error) {
            console.error("Alza Price Tracker – cena za jednotku:", error);
          }
        });
      }

      // Alza výpis nahradila (filtr, vlastní řazení) – naše řazení skončilo; order nesmí zůstat na
      // bannerech a dalším obsahu kontejneru, který výměnu přežil. Filtr slev platí dál i pro nový výpis
      if (sort.active && !load.loading && !sort.anchor?.isConnected) {
        sort.active = false;
        load.failed = false;
        this.clearSortOrder();
      }
      if (sort.active) this.applySort();
      this.applyFilter();
      this.updateToolbar();
      // Alza výpis vyměnila (zúžení jejími filtry) a nový je malý – filtr slev ho načte celý. Jen z první stránky:
      // listování stránkami Alzy nesmí uživatele vracet na začátek
      autoLoad = this.isFilterActive() && !load.loading && this.getListItems()[0] !== load.autoAnchor && this.getFirstLoadedPage() <= 1;
    } finally {
      this.state.pass = null; // Načítání dalších stránek (autoLoadForFilter) už čte živý DOM
    }
    if (autoLoad) this.autoLoadForFilter().catch((error) => console.error("Alza Price Tracker – načtení výpisu pro filtr:", error));
  },

  // Ceny dlaždice: { quantity: množstevní sleva (cena „od …“ není cena jednoho kusu), prices: ceny boxu | null }.
  // V průchodu update() se z DOM čtou jednou pro štítky (cena za parametr, cena provozu) i filtr slev
  getItemPrices(item) {
    const cache = this.state.pass?.prices;
    let entry = cache?.get(item);
    if (!entry) {
      const quantity = AlzaCore.hasListingQuantityDiscount(item);
      entry = { quantity, prices: quantity ? null : AlzaCore.extractPricesFromListingItem(item) };
      cache?.set(item, entry);
    }
    return entry;
  },

  updateItem(item) {
    const unitElement = item.querySelector(this.selectors.unitPrice);
    if (!unitElement) {
      this.updateParameterItem(item);
      return;
    }
    if (!this.state.unitPriceOn) return; // Zapnutá je jen cena provozu

    const data = this.readItem(item, unitElement);
    const signature = JSON.stringify(data);
    const current = item.querySelector(`.${this.elementClass}`);
    const previous = this.state.rendered.get(item);
    // Beze změny cen a s přepočtem stále na místě (Alza ho mohla překreslením smazat)
    if (previous?.signature === signature && previous.shown === Boolean(current)) return;

    current?.remove();
    const result = this.computeUnitPrice(data);
    if (result) unitElement.before(this.createUnitPriceElement(result)); // Skutečná cena první, Alzina za ní
    // Řadí se podle přepočtu, jinak podle Alziny ceny za jednotku (ta je pak správně)
    const unitPrice = result?.unitPrice || AlzaCore.parseUnitPrice(data.unit);
    const sortKey = unitPrice ? { suffix: unitPrice.suffix, value: result ? result.value : unitPrice.value } : null;
    this.state.rendered.set(item, { signature, shown: Boolean(result), sortKey });
  },

  // Dlaždice bez Alziny ceny za jednotku: cena za hlavní parametr (Kč/TB, Kč/GB, Kč/1000 mAh, Kč/Wh –
  // AlzaCore.getListingParameter) z nejnižší ceny k zaplacení, i s AlzaPlus+ a slevovým kódem. Štítek pod cenovým
  // boxem ve vzhledu Alziny ceny za jednotku; řazení „Za jednotku“ ho bere stejně jako cenu za kus
  updateParameterItem(item) {
    const name = this.getText(item, this.selectors.name);
    const description = this.getText(item, this.selectors.description);
    const text = `${name}\n${description}`;
    // Parametr se z textu čte jednou – většina výpisů ho nemá a průchod běží při každé dávce změn DOM
    let known = this.state.parameters.get(item);
    if (known?.text !== text) {
      const parameter = AlzaCore.getListingParameter(name, description);
      known = { text, parameter, energy: parameter ? null : AlzaCore.getListingEnergy(description) };
      this.state.parameters.set(item, known);
    }
    const parameter = this.state.unitPriceOn ? known.parameter : null;
    // Cena provozu (lednice, pračky, sušičky) – spotřeba z popisku × cena elektřiny × roky z nastavení
    const energy = this.state.energy.enabled ? known.energy : null;
    const current = item.querySelector(`.${this.parameterClass}`);
    if (!parameter && !energy) {
      current?.remove();
      this.state.rendered.delete(item);
      return;
    }

    // Cena „od …“ u množstevní slevy není cena jednoho kusu
    const { prices } = this.getItemPrices(item);
    const price = prices ? AlzaCore.getPayNowPrice(AlzaCore.toPriceMap(prices)) : null;
    const signature = JSON.stringify([text, price, energy ? this.state.energy : null, this.state.lang]);
    const previous = this.state.rendered.get(item);
    if (previous?.signature === signature && previous.shown === Boolean(current)) return;

    current?.remove();
    const anchor = price ? item.querySelector(this.selectors.parameterAnchor) : null;
    let sortKey = null;
    if (anchor && parameter) {
      const value = price / parameter.quantity;
      anchor.appendChild(this.createParameterElement(price, parameter, value));
      sortKey = { suffix: parameter.unit, value };
    } else if (anchor) {
      const cost = AlzaCore.getEnergyCost(energy, this.state.energy);
      anchor.appendChild(this.createEnergyElement(price, energy, cost));
      sortKey = { suffix: "energy", value: price + cost.cost }; // Řadí se podle ceny včetně provozu
    }
    this.state.rendered.set(item, { signature, shown: Boolean(anchor), sortKey });
  },

  // „provoz 10 let: 8 400 Kč“ – výpočet a součet s pořizovací cenou v bublině
  createEnergyElement(price, energy, { yearlyKwh, cost }) {
    const { domainKey } = this.state;
    const { locale, currency } = AlzaCore.domains[domainKey];
    const { price: kwhPrice, years, cyclesPerWeek } = this.state.energy;
    const number = (value, digits = 0) => value.toLocaleString(locale, { maximumFractionDigits: digits });
    const money = (value) => AlzaCore.formatPrice(value, domainKey);
    const perKwh = `${number(kwhPrice, 2)} ${currency}`;
    const element = document.createElement("div");
    element.className = `${this.parameterClass} ${this.parameterClass}--energy`;
    const label = document.createElement("span");
    label.className = `${this.parameterClass}-label`;
    const plural = years === 1 ? "One" : years <= 4 ? "Few" : "Many";
    label.textContent = this.translate(`energyLabel${plural}`, years, money(cost));
    label.title =
      energy.per === "year"
        ? this.translate("energyHintYear", number(energy.kwh, 1), perKwh, money(cost), money(price + cost), years)
        : this.translate("energyHintCycles", number(energy.kwh, 1), cyclesPerWeek, number(yearlyKwh), perKwh, money(cost), years, money(price + cost));
    element.appendChild(label);
    return element;
  },

  createParameterElement(price, parameter, value) {
    const { domainKey } = this.state;
    const { locale } = AlzaCore.domains[domainKey];
    const text = AlzaCore.formatParameterPrice(value, parameter.unit, domainKey);
    const amount = `${parameter.amount.toLocaleString(locale, { maximumFractionDigits: 2 })} ${parameter.amountUnit}`;
    const element = document.createElement("div");
    element.className = this.parameterClass;
    const label = document.createElement("span");
    label.className = `${this.parameterClass}-label`;
    label.textContent = text;
    label.title = this.translate("parameterHint", AlzaCore.formatPrice(price, domainKey), amount, text);
    element.appendChild(label);
    return element;
  },

  getText(root, selector) {
    return root.querySelector(selector)?.textContent.replace(/\s+/g, " ").trim() || "";
  },

  getPrice(root, selector) {
    const text = this.getText(root, selector);
    const price = text ? AlzaCore.parsePrice(text) : NaN;
    return price > 0 ? price : null;
  },

  readItem(item, unitElement) {
    return {
      unit: unitElement.textContent.replace(/\s+/g, " ").trim(),
      name: this.getText(item, this.selectors.name),
      description: this.getText(item, this.selectors.description),
      primary: this.getPrice(item, this.selectors.primaryPrice),
      compare: this.getPrice(item, this.selectors.comparePrice),
      // „Bez členství: 499,-“ u ceny s AlzaPlus+ – cena pro všechny, ze které Alza cenu za jednotku spočítala
      nonMember: this.getPrice(item, ".ads-pb__original-price:not(.ads-pb__original-price--strike)"),
      header: this.getText(item, this.selectors.priceHeader),
      coupons: [...item.querySelectorAll(this.selectors.coupon)].map((coupon) => ({
        type: [...coupon.classList].find((name) => name.startsWith("coupon-block--"))?.slice("coupon-block--".length) || null,
        price: this.getPrice(coupon, this.selectors.couponPrice),
      })),
    };
  },

  // { value, unitPrice, offer, quantity } – nejnižší cena za jednotku, je-li nižší než Alzina; jinak null
  computeUnitPrice(data) {
    const unitPrice = AlzaCore.parseUnitPrice(data.unit);
    if (!unitPrice || !data.primary) return null;

    const offers = [];
    if (this.memberPriceHeader.test(data.header)) offers.push({ price: data.primary, label: "withAlzaPlus" });
    data.coupons.forEach(({ type, price }) => {
      if (price && this.couponTypes[type]) offers.push({ price, label: this.couponTypes[type] });
    });
    if (offers.length === 0) return null;
    const offer = offers.reduce((best, next) => (next.price < best.price ? next : best));

    const quantity = this.getQuantity(data, unitPrice, offers);
    if (!quantity) return null;

    const value = offer.price / quantity;
    const factor = 10 ** unitPrice.decimals;
    if (Math.round(value * factor) >= Math.round(unitPrice.value * factor)) return null;
    return { value, unitPrice, offer, quantity };
  },

  // Množství v balení (počet kusů, kg…), ze kterého Alza cenu za jednotku spočítala; null = nejde zjistit
  getQuantity(data, unitPrice, offers) {
    const isPublicPrice = !this.personalPriceHeader.test(data.header);
    const isCountUnit = this.countUnits.includes(unitPrice.unit);

    if (isCountUnit) {
      // Hlavní cena pro všechny je přesně ta, ze které Alza počítala. U ceny pro člena (benefitu…) cenu pro
      // všechny nevidíme – leží někde mezi nejnižší a přeškrtnutou cenou
      const prices = [data.primary, data.compare, data.nonMember, ...offers.map(({ price }) => price)].filter(Boolean);
      const [min, max] = isPublicPrice ? [data.primary, data.primary] : [Math.min(...prices), Math.max(...prices)];
      const count = AlzaCore.getPackCount([data.description, data.name], unitPrice, min, max);
      if (count) return count;
    }

    // Poměrem cen jen z ceny pro všechny a s dost jemným zaokrouhlením ceny za jednotku
    if (!isPublicPrice || unitPrice.value < this.minRatioUnitPrice) return null;
    const ratio = data.primary / unitPrice.value;
    if (!isCountUnit) return ratio;
    const count = Math.round(ratio);
    const tolerance = (count * 0.5 * 10 ** -unitPrice.decimals + 1) / unitPrice.value;
    return count > 0 && Math.abs(ratio - count) <= tolerance ? count : null;
  },

  createUnitPriceElement({ value, unitPrice, offer, quantity }) {
    const { locale } = AlzaCore.domains[this.state.domainKey];
    const format = (number, digits) => number.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const unitText = `${format(value, unitPrice.decimals)} ${unitPrice.suffix}`;
    const quantityText = `${format(quantity, Number.isInteger(quantity) ? 0 : 2)} ${unitPrice.unit}`;

    // Štítek vedle Alziny ceny za jednotku v barvě slevy (AlzaPlus+ oranžově jako u Alzy); popis v tooltipu
    const element = document.createElement("span");
    element.className = `${this.elementClass} ${this.elementClass}--${offer.label}`;
    element.textContent = unitText;
    element.title = `${unitText} ${this.translate(offer.label)}\n${this.translate("unitPriceHint", AlzaCore.formatPrice(offer.price, this.state.domainKey), quantityText, unitText)}`;
    return element;
  },

  // === Řazení celého výpisu podle skutečné ceny za jednotku ===

  // Boxy výpisu; v průchodu update() jedno čtení z DOM pro všechny (vrácené pole neměnit)
  getListItems() {
    const { pass } = this.state;
    if (pass?.items) return pass.items;
    const container = document.querySelector(this.selectors.container);
    const items = container ? [...container.querySelectorAll(`:scope > ${this.selectors.item}`)] : [];
    if (pass) pass.items = items;
    return items;
  },

  // Počet produktů výpisu podle Alzy ("132 položek"); null = nevíme
  getTotalCount() {
    const count = parseInt(document.querySelector(this.selectors.itemCount)?.textContent.replace(/\D/g, ""), 10);
    return count > 0 ? count : null;
  },

  hasMoreItems() {
    return Boolean(document.querySelector(this.selectors.moreButton)?.offsetParent);
  },

  // Načte zbytek výpisu Alzinou cestou ("24 dalších…") – filtry i řazení zůstanou jejich.
  // true = načteno vše, false = Alza další produkty nedodala nebo došel limit kliknutí
  async loadAllItems() {
    if (!(await this.goToFirstPage())) return false;
    for (let step = 0; step < this.maxLoadSteps; step++) {
      if (!this.state.enabled) return false; // Vypnuto v nastavení během načítání
      const loaded = this.getListItems().length;
      const total = this.getTotalCount();
      if ((total && loaded >= total) || !this.hasMoreItems()) return true;

      document.querySelector(this.selectors.moreButton).click();
      if (!(await this.waitFor(() => this.getListItems().length > loaded))) return false;
      this.updateToolbar();
      await new Promise((resolve) => setTimeout(resolve, this.loadStepDelayMs));
    }
    // Dávka je načtená a výpis pokračuje – to není výpadek, další dávku přidá „Načíst dalších…“
    return this.hasMoreItems() ? "limit" : true;
  },

  // První načtená stránka výpisu: "#f&…&pg=6" (Alza načítá přes AJAX), jinak "…-p6.htm"; "pg=1-3" = 1
  getFirstLoadedPage() {
    const { hash, pathname } = window.location;
    const match = hash.match(/[#&]pg=(\d+)/) || pathname.match(/-p(\d+)\.htm$/i);
    return match ? parseInt(match[1], 10) : 1;
  },

  // "24 dalších…" přidává jen stránky za aktuální – z jiné než první stránky se nejdřív vrátit na první
  // (odkaz "1" pod výpisem, Alza ho načte bez přenačtení stránky)
  async goToFirstPage() {
    if (this.getFirstLoadedPage() <= 1) return true;
    const link = [...document.querySelectorAll(this.selectors.pageLink)].find((a) => a.textContent.trim() === "1");
    const first = this.getListItems()[0];
    if (!link || !first) return false;
    link.click();
    return this.waitFor(() => !first.isConnected && this.getListItems().length > 0);
  },

  waitFor(condition) {
    const start = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        if (condition()) resolve(true);
        else if (Date.now() - start > this.loadStepTimeoutMs) resolve(false);
        else setTimeout(check, 100);
      };
      check();
    });
  },

  // Načte celý výpis pro řazení i filtr; false = už se načítá (nebo vypnuto)
  async loadAll() {
    const { load } = this.state;
    if (load.loading) return false;
    load.loading = true;
    load.failed = false;
    this.updateToolbar();
    try {
      load.failed = (await this.loadAllItems()) === false; // "limit" = načtená dávka velkého výpisu, ne chyba
    } catch (error) {
      console.error("Alza Price Tracker – načtení výpisu:", error);
      load.failed = true;
    }
    load.loading = false;
    return this.state.enabled;
  },

  async startSort() {
    if (!(await this.loadAll())) return;
    const { sort } = this.state;
    sort.active = true;
    sort.anchor = this.getListItems()[0] || null;
    this.update();
    this.state.toolbar?.scrollIntoView({ block: "start", behavior: "smooth" });
  },

  cancelSort() {
    Object.assign(this.state.sort, { active: false, anchor: null });
    this.state.load.failed = false;
    this.clearSortOrder();
    this.updateToolbar();
  },

  // "Načíst dalších N" – další dávka velkého výpisu, po výpadku načítání nebo po Alzině výměně výpisu
  async loadRest() {
    if (!(await this.loadAll())) return;
    // Návrat na první stránku výpis vymění – řazení se musí navázat na nový
    if (this.state.sort.active) this.state.sort.anchor = this.getListItems()[0] || null;
    this.update();
  },

  isFilterActive() {
    const { filter } = this.state;
    return this.state.discountEnabled && (filter.min > 0 || filter.coupon || filter.bulk);
  },

  // Změna filtru slev – zapnutí filtru načte celý výpis, ať vybírá ze všech produktů. Další změny už nenačítají
  async setFilter(change) {
    const wasActive = this.isFilterActive();
    Object.assign(this.state.filter, change);
    this.update();
    if (!wasActive && this.isFilterActive()) await this.autoLoadForFilter();
  },

  // Výpis, který filtr slev smí načíst celý sám: počet známe a vejde se do jedné dávky. Kategorie s desetitisíci
  // produktů se nenačítá – filtr projde načtené, dál tlačítkem „Načíst dalších…“ nebo zúžením filtry Alzy
  isSmallListing() {
    const total = this.getTotalCount();
    return Boolean(total) && total <= this.autoLoadMaxItems;
  },

  // Načte celý malý výpis pro filtr slev – po zapnutí filtru a po výměně výpisu Alzou (zúžení jejími filtry).
  // autoAnchor = první produkt výpisu, pro který už se to zkusilo (jeden pokus na výpis)
  async autoLoadForFilter() {
    const { load } = this.state;
    if (load.loading || !this.isFilterActive()) return;
    load.autoAnchor = this.getListItems()[0] || null;
    if (!this.isSmallListing() || !(this.hasMoreItems() || this.getFirstLoadedPage() > 1)) return;
    if (!(await this.loadAll())) return;
    load.autoAnchor = this.getListItems()[0] || null; // Návrat na první stránku výpis vyměnil
    if (this.state.sort.active) this.state.sort.anchor = load.autoAnchor;
    this.update();
  },

  // Kolik produktů přidá další dávka načítání: maxLoadSteps × počet z "24 dalších…", nejvýš zbytek výpisu
  getNextBatchSize() {
    const perStep = parseInt(document.querySelector(this.selectors.moreButton)?.textContent.replace(/\D/g, ""), 10) || this.defaultPageSize;
    const batch = this.maxLoadSteps * perStep;
    const total = this.getTotalCount();
    return total ? Math.max(0, Math.min(batch, total - this.getListItems().length)) : batch;
  },

  clearFilter() {
    document.querySelectorAll(`[${this.filteredAttribute}]`).forEach((item) => item.removeAttribute(this.filteredAttribute));
  },

  // Klíč produktu (doména + číslo) z odkazu v boxu – stejně jako ukládání z procházení (browsing.js)
  getItemProductKey(item) {
    const href = item.querySelector(this.selectors.name)?.getAttribute("href");
    if (!href) return null;
    // Klíč se z odkazu počítá jednou (new URL, regulární výrazy) – filtr ho chce v každém průchodu pro každý box.
    // Znovu jen při změně odkazu (Alza box přepíše jiným produktem)
    const cached = this.state.productKeys.get(item);
    if (cached?.href === href) return cached.key;
    const url = new URL(href, window.location.origin);
    const variant = url.searchParams.get("dq");
    const path = url.pathname + (variant ? `?dq=${variant}` : "");
    const key = AlzaCore.getProductId(path) ? AlzaCore.getProductKey(this.state.domainKey, path) : null;
    this.state.productKeys.set(item, { href, key });
    return key;
  },

  // Historie produktů výpisu pro obvyklou cenu – jedním čtením, jen ty, které ještě nejsou načtené
  async loadHistories(keys) {
    const missing = keys.filter((key) => key && !this.state.histories.has(key));
    if (missing.length === 0) return;
    missing.forEach((key) => this.state.histories.set(key, null));
    const prefix = AlzaCore.storagePrefixes.history;
    const data = await chrome.storage.local.get(missing.map((key) => `${prefix}${key}`));
    const lang = AlzaCore.domains[this.state.domainKey].lang;
    missing.forEach((key) => {
      const raw = data[`${prefix}${key}`];
      if (raw) this.state.histories.set(key, AlzaCore.getPriceChangeHistory(AlzaCore.normalizeHistory(raw, lang)));
    });
    this.scheduleUpdate();
  },

  // Sleva produktu pro filtr: { discount, quantity } – přepočítá se jen při změně cen v boxu nebo po dočtení
  // historie (průchod běží při každé dávce změn DOM, výpis může mít tisíce produktů). Dlaždice s množstevní
  // slevou („od 76,-“ = cena kusu v nejvyšším stupni) slevu nemá – jako browsing.js ji nezapisuje
  getItemDiscount(item, key) {
    const { quantity, prices } = this.getItemPrices(item);
    const signature = quantity ? "quantity" : JSON.stringify(prices);
    const history = this.state.histories.get(key) || null;
    const cached = this.state.discounts.get(item);
    if (cached?.signature === signature && cached.history === history) return cached;
    const discount = quantity ? null : AlzaCore.getListingDiscount(AlzaCore.toPriceMap(AlzaCore.getListingFilterPrices(item, prices)), history || []);
    const result = { signature, history, discount, quantity };
    this.state.discounts.set(item, result);
    return result;
  },

  // Skryje produkty, které filtru nevyhovují (jen atribut – DOM Alzy zůstává); { shown, total } | null
  applyFilter() {
    if (!this.isFilterActive()) {
      this.clearFilter();
      this.state.filterCounts = null;
      return;
    }
    const { min, coupon, bulk } = this.state.filter;
    const items = this.getListItems();
    const keys = items.map((item) => this.getItemProductKey(item));
    this.loadHistories(keys).catch((error) => console.error("Alza Price Tracker – historie pro filtr slev:", error));
    let shown = 0;
    items.forEach((item, index) => {
      const { discount, quantity } = this.getItemDiscount(item, keys[index]);
      // Jen „S množstevní slevou“ slevu nevyžaduje; sleva a kupón ano
      const discountOk = (min === 0 && !coupon) || (Boolean(discount) && discount.percent >= min && (!coupon || discount.coupon));
      const matches = discountOk && (!bulk || quantity);
      if (matches) shown++;
      if (item.hasAttribute(this.filteredAttribute) === matches) item.toggleAttribute(this.filteredAttribute, !matches);
    });
    this.state.filterCounts = { shown, total: items.length };
  },

  clearSortOrder() {
    const container = document.querySelector(this.selectors.container);
    [...(container?.children || [])].forEach((child) => child.style.removeProperty("order"));
  },

  // Pořadí přes CSS order (kontejner je flex): produkty, které jde koupit, před nedostupnými; v nich
  // nejčastější jednotka (Kč/ks) první, další jednotky za ní, bez ceny za jednotku na konec; ostatní
  // obsah kontejneru (bannery…) za produkty
  applySort() {
    const container = document.querySelector(this.selectors.container);
    if (!container) return;
    const items = this.getListItems().map((item, index) => ({
      item,
      index,
      key: this.state.rendered.get(item)?.sortKey,
      unavailable: !item.classList.contains(this.availableClass),
    }));

    const counts = new Map();
    items.forEach(({ key }) => key && counts.set(key.suffix, (counts.get(key.suffix) || 0) + 1));
    const unitRank = new Map([...counts].sort((a, b) => b[1] - a[1]).map(([suffix], rank) => [suffix, rank]));
    const rankOf = (key) => (key ? unitRank.get(key.suffix) : Infinity);

    items.sort((a, b) =>
      a.unavailable - b.unavailable || rankOf(a.key) - rankOf(b.key) || (a.key?.value ?? 0) - (b.key?.value ?? 0) || a.index - b.index
    );
    const order = new Map(items.map(({ item }, position) => [item, String(position + 1)]));
    [...container.children].forEach((child) => {
      const value = order.get(child) || String(items.length + 1);
      if (child.style.order !== value) child.style.order = value;
    });
  },

  createToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "alza-price-tracker-toolbar alza-price-tracker-unit-toolbar";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "alza-price-tracker-toolbar-chip alza-price-tracker-unit-toolbar-sort";
    button.addEventListener("click", () => (this.state.sort.active ? this.cancelSort() : this.startSort()));
    const status = document.createElement("span");
    status.className = "alza-price-tracker-unit-toolbar-status";
    const more = document.createElement("button");
    more.type = "button";
    more.className = "alza-price-tracker-toolbar-chip alza-price-tracker-unit-toolbar-more";
    more.addEventListener("click", () => this.loadRest());

    // Filtr slev: „Sleva [vše | aspoň X %]“ a „Jen s kupónem“
    const discount = document.createElement("span");
    discount.className = "alza-price-tracker-unit-toolbar-discount";
    const label = document.createElement("label");
    label.className = "alza-price-tracker-toolbar-sort";
    const labelText = document.createElement("span");
    const select = document.createElement("select");
    this.discountSteps.forEach((step) => {
      const option = document.createElement("option");
      option.value = String(step);
      select.appendChild(option);
    });
    select.addEventListener("change", () => this.setFilter({ min: Number(select.value) }));
    label.append(labelText, select);
    // „Jen s kupónem“ a „S množstevní slevou“ jako zaškrtávátka filtrů Alzy (čtvereček 18 px), ne tlačítka
    const createCheck = (name, key) => {
      const check = document.createElement("label");
      check.className = `alza-price-tracker-check alza-price-tracker-unit-toolbar-${name}`;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.addEventListener("change", () => this.setFilter({ [key]: input.checked }));
      check.append(input, document.createElement("span"));
      return check;
    };
    discount.append(label, createCheck("coupon", "coupon"), createCheck("bulk", "bulk"));

    toolbar.append(AlzaCore.createToolbarLogo(document), button, discount, status, more);
    // Odkazy na prvky – při umístění do Alzy (záložka řazení, levý panel) nejsou v liště
    this.state.ui = { button, discount, status, more };
    return toolbar;
  },

  // Pryč s naším ovládáním (lišta, záložka, blok v panelu) a zhasnutá záložka Alzy zpět
  removeControls() {
    this.state.toolbar?.remove();
    this.state.sortTab?.remove();
    this.state.filterBlock?.remove();
    // Pokud si Alza mezitím neaktivovala jinou záložku (po staré instanci skriptu mohl atribut zůstat déle)
    const otherActive = document.querySelector(".js-sort-item.sorting__item-link--active");
    document.querySelectorAll("[data-alza-price-tracker-active]").forEach((link) => {
      if (!otherActive) link.classList.add("sorting__item-link--active");
      link.removeAttribute("data-alza-price-tracker-active");
    });
  },

  // Ovládání na místech Alzy: řazení jako další záložka řazení, filtry slev, stav a „Načíst zbývající“ jako blok
  // „Price Insight“ na začátku levého panelu filtrů. Bez záložek nebo panelu (jiný typ výpisu) zůstane lišta.
  // true = umístěno do Alzy
  mountInAlza(sorting, unitAvailable) {
    const wrapper = sorting.querySelector(".sorting__wrapper");
    const panel = document.querySelector(".js-basic-filters");
    if (!wrapper || !panel) return false;
    const { button, discount, status, more } = this.state.ui;

    if (!this.state.sortTab) {
      this.state.sortTab = document.createElement("li");
      this.state.sortTab.className = "sorting__item alza-price-tracker-sort-tab";
    }
    const tab = this.state.sortTab;
    button.classList.add("sorting__item-link");
    if (button.parentElement !== tab) tab.appendChild(button);
    if (unitAvailable && tab.parentElement !== wrapper) wrapper.appendChild(tab);
    if (!unitAvailable) tab.remove();
    // Během našeho řazení je aktivní naše záložka, Alzina se jen zhasne; po zrušení se vrátí – pokud si mezitím
    // Alza neaktivovala jinou (klik na její záložku ukončí naše řazení)
    if (this.state.sort.active) {
      wrapper.querySelectorAll(".js-sort-item.sorting__item-link--active").forEach((link) => {
        link.classList.remove("sorting__item-link--active");
        link.setAttribute("data-alza-price-tracker-active", "");
      });
    } else {
      const otherActive = wrapper.querySelector(".js-sort-item.sorting__item-link--active");
      wrapper.querySelectorAll("[data-alza-price-tracker-active]").forEach((link) => {
        if (!otherActive) link.classList.add("sorting__item-link--active");
        link.removeAttribute("data-alza-price-tracker-active");
      });
    }
    button.classList.toggle("sorting__item-link--active", this.state.sort.active);

    if (!this.state.filterBlock) {
      const block = document.createElement("div");
      block.className = "basic-filter alza-price-tracker-filter-block";
      const name = document.createElement("div");
      name.className = "name alza-price-tracker-filter-block-name";
      name.append(AlzaCore.createToolbarLogo(document));
      block.append(name);
      this.state.filterBlock = block;
    }
    const block = this.state.filterBlock;
    [discount, status, more].forEach((element) => element.parentElement !== block && block.appendChild(element));
    // Blok nese i stav řazení a „Načíst dalších N“ – s vypnutým filtrem slev se skrývá jen prvek filtru (discount),
    // blok až když nemá co ukázat (isFilterBlockVisible)
    block.classList.toggle("alza-price-tracker-hidden", !this.isFilterBlockVisible());
    if (block.parentElement !== panel || panel.firstElementChild !== block) panel.prepend(block);
    this.state.toolbar?.remove();
    return true;
  },

  // Blok „Price Insight“ v levém panelu má co ukázat: filtr slev (volba zapnutá), nebo stav našeho řazení a načítání
  // („Načítám produkty…“, „Seřazeno 504 z 3000“, „Načíst dalších N“) – ten musí být vidět i s vypnutým filtrem slev
  isFilterBlockVisible() {
    const { discountEnabled, sort, load } = this.state;
    return Boolean(discountEnabled || sort.active || load.loading);
  },

  // Výpis je načtený celý: Alza další produkty nenabízí („24 dalších…“), nebo je načtený celý známý počet položek.
  // total = null: stránka počet neukazuje – pak rozhoduje jen pokračování výpisu (dřív se bral jako úplný vždy)
  isListingComplete(loaded, total, hasMore) {
    return !hasMore || (total !== null && loaded >= total);
  },

  // Stav v liště jako [[klíč textu, …parametry]]. Bez známého počtu položek (total = null) a s pokračováním výpisu
  // texty neříkají „Seřazeno N produktů“ / „Vyhovuje 2 z 24“, ale že jde jen o načtenou část
  getStatusParts({ loading, failed, active, filterActive, counts, loaded, total, hasMore, small, energyListing }) {
    const known = total !== null;
    if (loading) return [known ? ["sortLoading", loaded, total] : ["sortLoadingUnknown", loaded]];
    const complete = this.isListingComplete(loaded, total, hasMore);
    const parts = [];
    if (active && failed) parts.push(known ? ["sortLoadFailed", loaded, total] : ["sortLoadFailedUnknown", loaded]);
    else if (active && complete) parts.push([energyListing ? "sortDoneEnergy" : "sortDone", loaded]);
    else if (active) parts.push(known ? ["sortPartial", loaded, total] : ["sortPartialUnknown", loaded]);
    if (filterActive && counts) {
      if (complete) parts.push(["filterStatus", counts.shown, counts.total]);
      else parts.push(known ? ["filterPartial", counts.shown, counts.total, total] : ["filterPartialUnknown", counts.shown, counts.total]);
      if (!complete && !small) parts.push(["filterNarrow"]);
    }
    return parts;
  },

  // Lišta pod záložkami řazení; Alza je může překreslit, pak se vloží znovu
  updateToolbar() {
    const sorting = document.querySelector(this.selectors.sorting);
    if (!sorting || !document.querySelector(this.selectors.container)) return;
    // Řazení podle ceny za jednotku jen ve výpisech, kde ji ukazuje Alza nebo my (cena za parametr); bez něj
    // a bez filtru slev lišta není
    const alzaUnit = this.state.unitPriceOn && Boolean(document.querySelector(`${this.selectors.item} ${this.selectors.unitPrice}`));
    const unitAvailable = this.state.unitEnabled && (alzaUnit || Boolean(document.querySelector(`${this.selectors.item} .${this.parameterClass}`)));
    if (!unitAvailable && !this.state.discountEnabled) {
      this.removeControls();
      return;
    }
    // Výpis jen s cenou provozu (lednice, pračky…): záložka a texty mluví o ceně včetně provozu, ne o ceně za jednotku
    const otherUnits = `${this.selectors.item} .${this.parameterClass}:not(.${this.parameterClass}--energy)`;
    const energyListing = unitAvailable && !alzaUnit && !document.querySelector(otherUnits);
    const sortText = (name) => (energyListing ? `${name}Energy` : name);
    if (!this.state.toolbar) this.state.toolbar = this.createToolbar();
    const toolbar = this.state.toolbar;
    // Přednostně na místa Alzy (záložka řazení, levý panel), jinak lišta pod záložkami
    const inAlza = this.mountInAlza(sorting, unitAvailable);
    if (!inAlza && toolbar.previousElementSibling !== sorting) sorting.after(toolbar);
    if (!inAlza && this.state.ui.button.parentElement !== toolbar) {
      // Zpět do lišty (výpis bez panelu filtrů) – tlačítko a filtry na původní místa
      const { button, discount, status, more } = this.state.ui;
      button.classList.remove("sorting__item-link", "sorting__item-link--active");
      toolbar.append(button, discount, status, more);
      this.state.sortTab?.remove();
      this.state.filterBlock?.remove();
    }
    // Záložka má vzhled záložek Alzy, v liště je to chip
    this.state.ui.button.classList.toggle("alza-price-tracker-toolbar-chip", !inAlza);

    const { loading, failed } = this.state.load;
    const { active } = this.state.sort;
    const filterActive = this.isFilterActive();
    const hasMore = this.hasMoreItems();
    const { button, discount, status, more } = this.state.ui;

    button.classList.toggle("alza-price-tracker-hidden", !unitAvailable);
    discount.classList.toggle("alza-price-tracker-hidden", !this.state.discountEnabled);

    const parts = this.getStatusParts({
      loading,
      failed,
      active,
      filterActive,
      counts: this.state.filterCounts,
      loaded: this.getListItems().length,
      total: this.getTotalCount(),
      hasMore,
      small: this.isSmallListing(),
      energyListing,
    }).map(([key, ...params]) => this.translate(key, ...params));

    // V záložkách Alzy název jako jejich záložky (opětovný klik řazení zruší), v liště tlačítko Seřadit / Zrušit
    // V záložce naše ikona (logo přes CSS) místo ikony řazení
    if (inAlza) button.querySelector(".alza-price-tracker-icon")?.remove();
    this.setText(button, this.translate(inAlza ? sortText("sortTab") : active ? "sortCancel" : sortText("sortStart")), inAlza ? null : "sort");
    if (inAlza && !button.querySelector(".alza-price-tracker-sort-tab-icon")) {
      const icon = document.createElement("span");
      icon.className = "alza-price-tracker-sort-tab-icon";
      icon.setAttribute("aria-hidden", "true");
      button.prepend(icon);
    }
    if (!inAlza) button.querySelector(".alza-price-tracker-sort-tab-icon")?.remove();
    button.title = inAlza ? this.translate(sortText(active ? "sortTabActiveHint" : "sortStartHint")) : active ? "" : this.translate(sortText("sortStartHint"));
    button.disabled = loading;
    button.classList.toggle("alza-price-tracker-toolbar-chip--active", active);

    const label = discount.querySelector("label");
    const [labelText, select] = label.children;
    this.setText(labelText, this.translate("discountLabel"));
    [...select.options].forEach((option) => {
      const step = Number(option.value);
      this.setText(option, step === 0 ? this.translate("discountAll") : this.translate("discountMin", step));
    });
    if (select.value !== String(this.state.filter.min)) select.value = String(this.state.filter.min);
    // Nápověda na popisku (má naši třídu) – kartu tooltipu (price-card.js) pak ukáže popisek i rozbalovací seznam
    label.title = this.translate("discountHint");
    select.disabled = loading;
    [["coupon", "couponOnly"], ["bulk", "bulkOnly"]].forEach(([key, text]) => {
      const check = discount.querySelector(`.alza-price-tracker-unit-toolbar-${key}`);
      const input = check.querySelector("input");
      this.setText(check.querySelector("span"), this.translate(text));
      check.title = this.translate(`${text}Hint`);
      input.disabled = loading;
      if (input.checked !== this.state.filter[key]) input.checked = this.state.filter[key];
    });

    this.setText(status, parts.join(" · "));
    this.setText(more, this.translate("sortLoadRest", this.getNextBatchSize()));
    more.classList.toggle("alza-price-tracker-hidden", !(active || filterActive) || loading || !hasMore);
  },

  // Text prvku lišty jen při změně (lišta se překresluje často); icon = ikona před textem – vloží se jen když chybí
  setText(element, text, icon) {
    if (element.textContent !== text) element.textContent = text;
    if (icon && !element.querySelector(".alza-price-tracker-icon")) AlzaIcons.prepend(element, icon);
  },
};

AlzaUnitPrice.init().catch((error) => console.error("Alza Price Tracker – cena za jednotku:", error));
