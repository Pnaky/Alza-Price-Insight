// Content script: lišta nad výpisy kategorií a vyhledávání.
// 1) Cena za jednotku (volba categoryUnitPrice, jen výpisy, kde ji Alza ukazuje): Alza ji počítá z ceny pro
//    všechny (akce, Black Friday) – AlzaPlus+ ani slevový kód do ní nezahrne, ani když členovi AlzaPlus+ ukáže
//    jeho cenu jako hlavní. Před Alzinu cenu za jednotku doplní přepočet z nejnižší ceny v boxu produktu
//    a v liště řazení podle skutečné ceny.
// 2) Filtr slev (volba categoryDiscountFilter, všechny výpisy): „Sleva aspoň X %“, „Jen s kupónem“ a „S množstevní slevou“ –
//    sleva z nejnižší ceny k zaplacení proti obvyklé ceně z historie, jinak proti přeškrtnuté ceně
//    (AlzaCore.getListingDiscount). Nevyhovující produkty jen skryje, DOM Alzy zůstává.
// Řazení i filtr nejdřív načtou celý výpis (Alzino "24 dalších…")
const AlzaUnitPrice = {
  selectors: {
    item: ".browsingitem", // box produktu ve výpisu
    unitPrice: ".unit-price__label", // "3,50 Kč/ks"
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
  discountSteps: [0, 10, 20, 30, 40, 50], // Volby filtru „Sleva aspoň X %“ (0 = vše)
  filteredAttribute: "data-alza-price-tracker-discount-hidden", // Produkt skrytý filtrem slev (main.css)

  translations: {
    cz: {
      withAlzaPlus: "s AlzaPlus+",
      withCode: "se slevovým kódem",
      unitPriceHint: "Alza počítá cenu za jednotku z ceny bez AlzaPlus+ a slevových kódů.\n{0} / {1} = {2}",
      sortStart: "Seřadit podle skutečné ceny za jednotku",
      sortStartHint: "Načte všechny produkty výpisu a seřadí je podle nejnižší ceny za jednotku – i s AlzaPlus+ a slevovými kódy. Alzino řazení „Nejlevnější za jednotku“ je nezapočítává.",
      sortCancel: "Zrušit řazení",
      sortLoading: "Načítám produkty {0} / {1}…",
      sortDone: "Seřazeno {0} produktů podle skutečné ceny za jednotku",
      sortPartial: "Seřazeno {0} z {1} produktů",
      sortLoadRest: "Načíst zbývající",
      sortLoadFailed: "Další produkty se nepodařilo načíst – seřazeno {0} z {1}",
      sortTab: "Za jednotku",
      sortTabActiveHint: "Price Insight: seřazeno podle skutečné ceny za jednotku (i s AlzaPlus+ a slevovými kódy). Kliknutím znovu řazení zrušíte.",
      discountLabel: "Sleva",
      discountAll: "vše",
      discountMin: "aspoň {0} %",
      discountHint: "Sleva z nejnižší ceny, kterou zaplatíte (i s AlzaPlus+ a slevovým kódem). U produktů s historií cen proti obvyklé ceně, u ostatních proti přeškrtnuté ceně Alzy. Načte celý výpis.",
      couponOnly: "Jen s kupónem",
      couponOnlyHint: "Jen produkty s cenou s AlzaPlus+ nebo se slevovým kódem",
      bulkOnly: "S množstevní slevou",
      bulkOnlyHint: "Jen produkty s množstevní slevou Alzy „Kup víc, zaplať míň“ – při více kusech je kus levnější",
      filterStatus: "Vyhovuje {0} z {1}",
      filterPartial: "Vyhovuje {0} z {1} načtených (výpis má {2})",
    },
    sk: {
      withAlzaPlus: "s AlzaPlus+",
      withCode: "so zľavovým kódom",
      unitPriceHint: "Alza počíta cenu za jednotku z ceny bez AlzaPlus+ a zľavových kódov.\n{0} / {1} = {2}",
      sortStart: "Zoradiť podľa skutočnej ceny za jednotku",
      sortStartHint: "Načíta všetky produkty výpisu a zoradí ich podľa najnižšej ceny za jednotku – aj s AlzaPlus+ a zľavovými kódmi. Zoradenie Alzy „Najlacnejšie za jednotku“ ich nezapočítava.",
      sortCancel: "Zrušiť zoradenie",
      sortLoading: "Načítavam produkty {0} / {1}…",
      sortDone: "Zoradených {0} produktov podľa skutočnej ceny za jednotku",
      sortPartial: "Zoradených {0} z {1} produktov",
      sortLoadRest: "Načítať zvyšné",
      sortLoadFailed: "Ďalšie produkty sa nepodarilo načítať – zoradených {0} z {1}",
      sortTab: "Za jednotku",
      sortTabActiveHint: "Zoradené podľa skutočnej ceny za jednotku (aj s AlzaPlus+ a zľavovými kódmi). Kliknutím znova zoradenie zrušíte.",
      discountLabel: "Zľava",
      discountAll: "všetko",
      discountMin: "aspoň {0} %",
      discountHint: "Zľava z najnižšej ceny, ktorú zaplatíte (aj s AlzaPlus+ a zľavovým kódom). Pri produktoch s históriou cien voči obvyklej cene, pri ostatných voči prečiarknutej cene Alzy. Načíta celý výpis.",
      couponOnly: "Len s kupónom",
      couponOnlyHint: "Len produkty s cenou s AlzaPlus+ alebo so zľavovým kódom",
      bulkOnly: "S množstevnou zľavou",
      bulkOnlyHint: "Len produkty s množstevnou zľavou Alzy „Kúp viac, zaplať menej“ – pri viacerých kusoch je kus lacnejší",
      filterStatus: "Vyhovuje {0} z {1}",
      filterPartial: "Vyhovuje {0} z {1} načítaných (výpis má {2})",
    },
    hu: {
      withAlzaPlus: "AlzaPlus+-szal",
      withCode: "kuponkóddal",
      unitPriceHint: "Az Alza az egységárat az AlzaPlus+ és kuponkódok nélküli árból számolja.\n{0} / {1} = {2}",
      sortStart: "Rendezés valós egységár szerint",
      sortStartHint: "Betölti a lista összes termékét, és a legalacsonyabb egységár szerint rendezi – AlzaPlus+-szal és kuponkódokkal együtt. Az Alza „Legolcsóbb egységár” rendezése ezeket nem veszi figyelembe.",
      sortCancel: "Rendezés törlése",
      sortLoading: "Termékek betöltése {0} / {1}…",
      sortDone: "{0} termék rendezve valós egységár szerint",
      sortPartial: "{0} / {1} termék rendezve",
      sortLoadRest: "A többi betöltése",
      sortLoadFailed: "A további termékeket nem sikerült betölteni – {0} / {1} rendezve",
      sortTab: "Egységár",
      sortTabActiveHint: "Valós egységár szerint rendezve (AlzaPlus+-szal és kuponkódokkal együtt). Újra kattintva a rendezés megszűnik.",
      discountLabel: "Kedvezmény",
      discountAll: "mind",
      discountMin: "legalább {0} %",
      discountHint: "Kedvezmény a legalacsonyabb fizetendő árból (AlzaPlus+-szal és kuponkóddal együtt). Árelőzménnyel rendelkező termékeknél a szokásos árhoz, a többinél az Alza áthúzott árához képest. Betölti a teljes listát.",
      couponOnly: "Csak kuponnal",
      couponOnlyHint: "Csak AlzaPlus+ vagy kuponkódos árral rendelkező termékek",
      bulkOnly: "Mennyiségi kedvezménnyel",
      bulkOnlyHint: "Csak az Alza mennyiségi kedvezményével kínált termékek – több darabnál olcsóbb a darabár",
      filterStatus: "{0} / {1} megfelel",
      filterPartial: "{0} / {1} betöltött megfelel (a lista {2} tételes)",
    },
    en: {
      withAlzaPlus: "with AlzaPlus+",
      withCode: "with a discount code",
      unitPriceHint: "Alza calculates the unit price from the price without AlzaPlus+ and discount codes.\n{0} / {1} = {2}",
      sortStart: "Sort by real unit price",
      sortStartHint: "Loads all products of the listing and sorts them by the lowest unit price – including AlzaPlus+ and discount codes. Alza's own unit price sorting ignores them.",
      sortCancel: "Cancel sorting",
      sortLoading: "Loading products {0} / {1}…",
      sortDone: "{0} products sorted by real unit price",
      sortPartial: "{0} of {1} products sorted",
      sortLoadRest: "Load the rest",
      sortLoadFailed: "Couldn't load more products – {0} of {1} sorted",
      sortTab: "Unit price",
      sortTabActiveHint: "Sorted by the real unit price (including AlzaPlus+ and discount codes). Click again to cancel the sorting.",
      discountLabel: "Discount",
      discountAll: "all",
      discountMin: "at least {0} %",
      discountHint: "Discount from the lowest price you pay (including AlzaPlus+ and discount codes). Products with price history are compared with the usual price, others with Alza's crossed-out price. Loads the whole listing.",
      couponOnly: "Coupon only",
      couponOnlyHint: "Only products with an AlzaPlus+ or discount code price",
      bulkOnly: "Volume discount",
      bulkOnlyHint: "Only products with an Alza volume discount – more pieces, lower price per piece",
      filterStatus: "{0} of {1} match",
      filterPartial: "{0} of {1} loaded match (the listing has {2})",
    },
  },

  state: {
    domainKey: null,
    lang: "cz", // Jazyk textů (AlzaCore.getDisplayLanguage – volba v nastavení, jinak jazyk domény)
    scheduled: false,
    rendered: new WeakMap(), // Box produktu → { signature, shown, sortKey } posledního přepočtu
    load: { loading: false, failed: false }, // Načítání celého výpisu (řazení i filtr)
    sort: { active: false, anchor: null }, // anchor = box z řazeného výpisu
    filter: { min: 0, coupon: false, bulk: false }, // Filtr slev: aspoň min %, jen s kupónem, jen s množstevní slevou
    filterCounts: null, // { shown, total } posledního průchodu filtru (stav v liště)
    histories: new Map(), // Klíč produktu → historie (getPriceChangeHistory) pro obvyklou cenu; null = načítá se / není
    toolbar: null,
    unitEnabled: false, // Vypínače v nastavení (categoryUnitPrice, categoryDiscountFilter)
    discountEnabled: false,
    enabled: false, // Aspoň jedna z funkcí
    observer: null,
  },

  async init() {
    // Jen stránky s výpisem produktů (kategorie, vyhledávání); jinde nic nesledovat
    if (!document.querySelector(this.selectors.item)) return;
    // Lišta předchozí verze skriptu (Firefox ho po aktualizaci rozšíření vloží znovu) – mrtvá, pryč
    document.querySelectorAll(".alza-price-tracker-unit-toolbar, .alza-price-tracker-sort-tab, .alza-price-tracker-filter-block").forEach((element) => element.remove());

    this.state.domainKey = AlzaCore.getDomainKey(window.location.hostname);
    // Změna v nastavení se projeví hned i v otevřené stránce
    const key = AlzaCore.storageKeys.settings;
    const domainLang = AlzaCore.domains[this.state.domainKey].lang;
    const apply = (settings) => {
      this.state.lang = AlzaCore.getDisplayLanguage(settings, domainLang);
      this.setFeatures(settings.categoryUnitPrice, settings.categoryDiscountFilter);
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
      document.querySelectorAll(`.${this.elementClass}`).forEach((element) => element.remove());
      state.rendered = new WeakMap();
    }
    if (state.discountEnabled && !discountEnabled) {
      Object.assign(state.filter, { min: 0, coupon: false, bulk: false });
      this.clearFilter();
    }
    state.unitEnabled = Boolean(unitEnabled);
    state.discountEnabled = Boolean(discountEnabled);
    // Úprava výšky bloku ceny Alzy (main.css) jen se zapnutou cenou za jednotku
    document.documentElement.toggleAttribute("data-alza-price-tracker-unit-price", state.unitEnabled);

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
    const { sort, load } = this.state;
    if (sort.active && !load.loading && !sort.anchor?.isConnected) {
      sort.active = false;
      load.failed = false;
      this.clearSortOrder();
    }
    if (sort.active) this.applySort();
    this.applyFilter();
    this.updateToolbar();
  },

  updateItem(item) {
    const unitElement = item.querySelector(this.selectors.unitPrice);
    if (!unitElement) return;

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

  getListItems() {
    const container = document.querySelector(this.selectors.container);
    return container ? [...container.querySelectorAll(`:scope > ${this.selectors.item}`)] : [];
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
    return !this.hasMoreItems();
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
      load.failed = !(await this.loadAllItems());
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

  // "Načíst zbývající" – po výpadku načítání nebo po Alzině výměně výpisu
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
  // (velký výpis má tisíce produktů – načtení je po maxLoadSteps krocích, dál tlačítkem „Načíst zbývající“)
  async setFilter(change) {
    const wasActive = this.isFilterActive();
    Object.assign(this.state.filter, change);
    this.update();
    if (!wasActive && this.isFilterActive() && (this.hasMoreItems() || this.getFirstLoadedPage() > 1) && (await this.loadAll())) {
      if (this.state.sort.active) this.state.sort.anchor = this.getListItems()[0] || null;
      this.update();
    }
  },

  clearFilter() {
    document.querySelectorAll(`[${this.filteredAttribute}]`).forEach((item) => item.removeAttribute(this.filteredAttribute));
  },

  // Klíč produktu (doména + číslo) z odkazu v boxu – stejně jako ukládání z procházení (browsing.js)
  getItemProductKey(item) {
    const href = item.querySelector(this.selectors.name)?.getAttribute("href");
    if (!href) return null;
    const url = new URL(href, window.location.origin);
    const variant = url.searchParams.get("dq");
    const path = url.pathname + (variant ? `?dq=${variant}` : "");
    return AlzaCore.getProductId(path) ? AlzaCore.getProductKey(this.state.domainKey, path) : null;
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
      const priceMap = AlzaCore.toPriceMap(AlzaCore.extractPricesFromListingItem(item));
      const discount = AlzaCore.getListingDiscount(priceMap, this.state.histories.get(keys[index]) || []);
      // Jen „S množstevní slevou“ slevu nevyžaduje; sleva a kupón ano
      const discountOk = (min === 0 && !coupon) || (Boolean(discount) && discount.percent >= min && (!coupon || discount.coupon));
      const matches = discountOk && (!bulk || AlzaCore.hasListingQuantityDiscount(item));
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
    document.querySelectorAll("[data-alza-price-tracker-active]").forEach((link) => {
      link.classList.add("sorting__item-link--active");
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
    block.classList.toggle("alza-price-tracker-hidden", !this.state.discountEnabled);
    if (block.parentElement !== panel || panel.firstElementChild !== block) panel.prepend(block);
    this.state.toolbar?.remove();
    return true;
  },

  // Lišta pod záložkami řazení; Alza je může překreslit, pak se vloží znovu
  updateToolbar() {
    const sorting = document.querySelector(this.selectors.sorting);
    if (!sorting || !document.querySelector(this.selectors.container)) return;
    // Řazení podle ceny za jednotku jen ve výpisech, kde ji Alza ukazuje; bez něj a bez filtru slev lišta není
    const unitAvailable = this.state.unitEnabled && Boolean(document.querySelector(`${this.selectors.item} ${this.selectors.unitPrice}`));
    if (!unitAvailable && !this.state.discountEnabled) {
      this.removeControls();
      return;
    }
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
    const loaded = this.getListItems().length;
    const total = this.getTotalCount() || loaded;
    const complete = loaded >= total || !this.hasMoreItems();
    const { button, discount, status, more } = this.state.ui;

    button.classList.toggle("alza-price-tracker-hidden", !unitAvailable);
    discount.classList.toggle("alza-price-tracker-hidden", !this.state.discountEnabled);

    const parts = [];
    if (loading) parts.push(this.translate("sortLoading", loaded, total));
    else {
      if (active && failed) parts.push(this.translate("sortLoadFailed", loaded, total));
      else if (active) parts.push(complete ? this.translate("sortDone", loaded) : this.translate("sortPartial", loaded, total));
      const counts = this.state.filterCounts;
      if (filterActive && counts) {
        parts.push(complete ? this.translate("filterStatus", counts.shown, counts.total) : this.translate("filterPartial", counts.shown, counts.total, total));
      }
    }

    // V záložkách Alzy název jako jejich záložky (opětovný klik řazení zruší), v liště tlačítko Seřadit / Zrušit
    // V záložce naše ikona (logo přes CSS) místo ikony řazení
    if (inAlza) button.querySelector(".alza-price-tracker-icon")?.remove();
    this.setText(button, this.translate(inAlza ? "sortTab" : active ? "sortCancel" : "sortStart"), inAlza ? null : "sort");
    if (inAlza && !button.querySelector(".alza-price-tracker-sort-tab-icon")) {
      const icon = document.createElement("span");
      icon.className = "alza-price-tracker-sort-tab-icon";
      icon.setAttribute("aria-hidden", "true");
      button.prepend(icon);
    }
    if (!inAlza) button.querySelector(".alza-price-tracker-sort-tab-icon")?.remove();
    button.title = inAlza ? this.translate(active ? "sortTabActiveHint" : "sortStartHint") : active ? "" : this.translate("sortStartHint");
    button.disabled = loading;
    button.classList.toggle("alza-price-tracker-toolbar-chip--active", active);

    const [labelText, select] = discount.querySelector("label").children;
    this.setText(labelText, this.translate("discountLabel"));
    [...select.options].forEach((option) => {
      const step = Number(option.value);
      this.setText(option, step === 0 ? this.translate("discountAll") : this.translate("discountMin", step));
    });
    if (select.value !== String(this.state.filter.min)) select.value = String(this.state.filter.min);
    select.title = this.translate("discountHint");
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
    this.setText(more, this.translate("sortLoadRest"));
    more.classList.toggle("alza-price-tracker-hidden", !(active || filterActive) || loading || !this.hasMoreItems());
  },

  // Text prvku lišty jen při změně (lišta se překresluje často); icon = ikona před textem – vloží se jen když chybí
  setText(element, text, icon) {
    if (element.textContent !== text) element.textContent = text;
    if (icon && !element.querySelector(".alza-price-tracker-icon")) AlzaIcons.prepend(element, icon);
  },
};

AlzaUnitPrice.init().catch((error) => console.error("Alza Price Tracker – cena za jednotku:", error));
