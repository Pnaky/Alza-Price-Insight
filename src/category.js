// Content script: cena za jednotku ve výpisech kategorií a vyhledávání. Alza ji počítá z ceny pro všechny
// (akce, Black Friday) – AlzaPlus+ ani slevový kód do ní nezahrne, ani když členovi AlzaPlus+ ukáže jeho
// cenu jako hlavní. Před Alzinu cenu za jednotku doplní přepočet z nejnižší ceny v boxu produktu a nad
// výpis lištu, která načte všechny produkty (Alzino "24 dalších…") a seřadí je podle skutečné ceny
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
  couponTypes: { applus: "withAlzaPlus", discountcode: "withCode", discountcouponpaywall: "withCode" },
  // Hlavní cena, ze které Alza cenu za jednotku nepočítá (cena pro člena, benefit, B2B)
  personalPriceHeader: /alza\s*plus|benefit|b2b/i,
  memberPriceHeader: /alza\s*plus/i,
  countUnits: ["ks", "db"], // Jednotky, jejichž počet jde přečíst z popisku ("360 ks v balení")
  // Bez počtu v textu se množství dopočítá poměrem cen – jen když zaokrouhlení ceny za jednotku na
  // setiny zkreslí výsledek nanejvýš o 0,5 % (u "0,04 Kč/útržek" by to bylo až 12 %)
  minRatioUnitPrice: 1,
  elementClass: "alza-price-tracker-unit-price",

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
    },
  },

  state: {
    domainKey: null,
    lang: "cz", // Jazyk textů (AlzaCore.getDisplayLanguage – volba v nastavení, jinak jazyk domény)
    scheduled: false,
    rendered: new WeakMap(), // Box produktu → { signature, shown, sortKey } posledního přepočtu
    sort: { active: false, loading: false, failed: false, anchor: null }, // anchor = box z řazeného výpisu
    toolbar: null,
    enabled: false, // Vypínač v nastavení (categoryUnitPrice)
    observer: null,
  },

  async init() {
    // Jen stránky s výpisem produktů s cenou za jednotku (drogerie, potraviny…); jinde nic nesledovat
    if (!document.querySelector(`${this.selectors.item} ${this.selectors.unitPrice}`)) return;

    this.state.domainKey = AlzaCore.getDomainKey(window.location.hostname);
    // Změna v nastavení se projeví hned i v otevřené stránce
    const key = AlzaCore.storageKeys.settings;
    const domainLang = AlzaCore.domains[this.state.domainKey].lang;
    const apply = (settings) => {
      this.state.lang = AlzaCore.getDisplayLanguage(settings, domainLang);
      this.setEnabled(settings.categoryUnitPrice);
    };
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[key]) apply({ ...AlzaCore.defaultSettings, ...changes[key].newValue });
    });
    apply(await AlzaCore.getSettings());
  },

  setEnabled(enabled) {
    if (enabled === this.state.enabled) return;
    this.state.enabled = enabled;

    if (enabled) {
      this.update();
      // Další produkty ("24 dalších…"), filtry a řazení Alza dokreslí bez načtení stránky
      this.state.observer = AlzaCore.createObserver(() => this.scheduleUpdate(), { ignoreOwn: true });
      this.state.observer.observe(document.body, { childList: true, subtree: true });
      return;
    }

    // Vypnuto: pryč se štítky, lištou i naším řazením – výpis zůstane, jak ho Alza vykreslila
    this.state.observer?.disconnect();
    this.state.observer = null;
    Object.assign(this.state.sort, { active: false, failed: false, anchor: null });
    this.clearSortOrder();
    this.state.toolbar?.remove();
    document.querySelectorAll(`.${this.elementClass}`).forEach((element) => element.remove());
    this.state.rendered = new WeakMap();
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
    document.querySelectorAll(this.selectors.item).forEach((item) => {
      try {
        this.updateItem(item);
      } catch (error) {
        console.error("Alza Price Tracker – cena za jednotku:", error);
      }
    });

    // Alza výpis nahradila (filtr, vlastní řazení) – naše řazení skončilo; order nesmí zůstat na
    // bannerech a dalším obsahu kontejneru, který výměnu přežil
    const { sort } = this.state;
    if (sort.active && !sort.loading && !sort.anchor?.isConnected) {
      sort.active = false;
      sort.failed = false;
      this.clearSortOrder();
    }
    if (sort.active) this.applySort();
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
      const prices = [data.primary, data.compare, ...offers.map(({ price }) => price)].filter(Boolean);
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

  async startSort() {
    const { sort } = this.state;
    if (sort.loading) return;
    sort.loading = true;
    sort.failed = false;
    this.updateToolbar();
    try {
      sort.failed = !(await this.loadAllItems());
    } catch (error) {
      console.error("Alza Price Tracker – načtení výpisu:", error);
      sort.failed = true;
    }
    sort.loading = false;
    if (!this.state.enabled) return;
    sort.active = true;
    sort.anchor = this.getListItems()[0] || null;
    this.update();
    this.state.toolbar?.scrollIntoView({ block: "start", behavior: "smooth" });
  },

  cancelSort() {
    Object.assign(this.state.sort, { active: false, failed: false, anchor: null });
    this.clearSortOrder();
    this.updateToolbar();
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
    more.addEventListener("click", () => this.startSort());
    toolbar.append(button, status, more);
    return toolbar;
  },

  // Lišta pod záložkami řazení; Alza je může překreslit, pak se vloží znovu
  updateToolbar() {
    const sorting = document.querySelector(this.selectors.sorting);
    if (!sorting || !document.querySelector(this.selectors.container)) return;
    if (!this.state.toolbar) this.state.toolbar = this.createToolbar();
    const toolbar = this.state.toolbar;
    if (toolbar.previousElementSibling !== sorting) sorting.after(toolbar);

    const { active, loading, failed } = this.state.sort;
    const loaded = this.getListItems().length;
    const total = this.getTotalCount() || loaded;
    const button = toolbar.querySelector(".alza-price-tracker-unit-toolbar-sort");
    const status = toolbar.querySelector(".alza-price-tracker-unit-toolbar-status");
    const more = toolbar.querySelector(".alza-price-tracker-unit-toolbar-more");

    let statusText = "";
    if (loading) statusText = this.translate("sortLoading", loaded, total);
    else if (active && failed) statusText = this.translate("sortLoadFailed", loaded, total);
    else if (active) statusText = loaded >= total || !this.hasMoreItems() ? this.translate("sortDone", loaded) : this.translate("sortPartial", loaded, total);

    this.setText(button, this.translate(active ? "sortCancel" : "sortStart"));
    button.title = active ? "" : this.translate("sortStartHint");
    button.disabled = loading;
    button.classList.toggle("alza-price-tracker-toolbar-chip--active", active);
    this.setText(status, statusText);
    this.setText(more, this.translate("sortLoadRest"));
    more.classList.toggle("alza-price-tracker-hidden", !active || loading || !this.hasMoreItems());
  },

  setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  },
};

AlzaUnitPrice.init().catch((error) => console.error("Alza Price Tracker – cena za jednotku:", error));
