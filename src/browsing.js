// Content script: ceny produktů viděných při procházení – výpisy kategorií a vyhledávání (box .browsingitem,
// i "24 dalších…") a karusely na detailu ("Nejčastěji zakoupeno společně", "Alternativy k…", "Naposledy
// navštívené…" – položky data-slot="carousel-item" se stejným cenovým boxem ads-pb), i karusely na homepage
// (DPH tam nejde poznat ze stránky – resolveVat). Nic nezobrazuje, jen ukládá do historie cen (AlzaCore.appendListingObservation)
// a do přehledu procházených produktů (storageKeys.browsed – adresa, název, obrázek pro nastavení a čistku).
// Detail produktu si historii zapisuje sám (content.js) a sem jen hlásí produkt do přehledu (rememberProduct).
// Zapisuje se dávkově – jedna stránka výpisu = jeden zápis do storage
const AlzaBrowsing = {
  // Výpis | karusel (karusel dostupnost neukazuje – v historii zůstane poslední známá)
  selectors: {
    item: '.browsingitem, [data-slot="carousel-item"]',
    name: 'a.name, a[data-slot="carousel-item-link"]',
    image: '[data-slot="carousel-item-image"], img',
    availability: ".avl",
  },
  listPagePattern: /\/Order1\.htm/i, // Nákupní seznam si ceny ukládá sám (content.js)
  flushDelayMs: 2000, // Sloučí dočítání výpisu ("24 dalších…") do jednoho zápisu
  scanDelayMs: 500,

  state: {
    enabled: false,
    domainKey: null,
    lang: "cz",
    observer: null,
    scanTimeout: null,
    flushTimeout: null,
    seen: new Map(), // klíč produktu → podpis cen a dostupnosti zapsaný na této stránce
    pending: new Map(), // klíč produktu → { url, name, image, prices, availability } k zápisu
    queue: Promise.resolve(), // Zápisy po sobě – detail hlásí produkt i během zápisu výpisu
  },

  async init() {
    this.state.domainKey = AlzaCore.getDomainKey(window.location.hostname);
    if (!this.state.domainKey || this.listPagePattern.test(window.location.pathname)) return;
    this.state.lang = AlzaCore.domains[this.state.domainKey].lang; // Dostupnost se čte v jazyce domény

    const key = AlzaCore.storageKeys.settings;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[key]) this.setEnabled({ ...AlzaCore.defaultSettings, ...changes[key].newValue }.saveBrowsing);
    });
    this.setEnabled((await AlzaCore.getSettings()).saveBrowsing);
    // Zavřená nebo opuštěná stránka – zapsat, co čeká (bez čekání na odložený zápis)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flush();
    });
  },

  setEnabled(enabled) {
    if (enabled === this.state.enabled) return;
    this.state.enabled = enabled;
    if (!enabled) {
      this.state.observer?.disconnect();
      this.state.observer = null;
      this.state.pending.clear();
      return;
    }
    this.scan();
    // Další produkty, filtry a řazení Alza dokreslí bez načtení stránky
    this.state.observer = AlzaCore.createObserver(() => this.scheduleScan(), { ignoreOwn: true });
    this.state.observer.observe(document.body, { childList: true, subtree: true });
  },

  scheduleScan() {
    if (this.state.scanTimeout) return;
    this.state.scanTimeout = setTimeout(() => {
      this.state.scanTimeout = null;
      this.scan();
    }, this.scanDelayMs);
  },

  scan() {
    if (!this.state.enabled) return;
    const items = document.querySelectorAll(this.selectors.item);
    if (items.length === 0) return;

    items.forEach((item) => {
      try {
        const product = this.readItem(item);
        if (!product) return;
        const key = AlzaCore.getProductKey(this.state.domainKey, product.url);
        const signature = JSON.stringify([product.prices, product.availability]);
        if (this.state.seen.get(key) === signature) return;
        this.state.seen.set(key, signature);
        this.state.pending.set(key, product);
      } catch (error) {
        console.error("Alza Price Insight – procházení:", error);
      }
    });
    if (this.state.pending.size > 0) this.scheduleFlush();
  },

  readItem(item) {
    const link = item.querySelector(this.selectors.name);
    const href = link?.getAttribute("href");
    if (!href) return null;
    // Bez sledovacích parametrů; skupina variant má číslo produktu jen v ?dq= ("…-100w?dq=63364")
    const url = new URL(href, window.location.origin);
    const variant = url.searchParams.get("dq");
    url.search = variant ? `?dq=${variant}` : "";
    url.hash = "";
    const id = AlzaCore.getProductId(url.pathname + url.search);
    if (!AlzaCore.isAlzaUrl(url.href) || !id) return null;
    // Produkt otevřeného detailu zapisuje content.js (přesnější ceny) – dva zápisy do jedné historie by se přepsaly
    if (id === AlzaCore.getProductId(window.location.pathname + window.location.search)) return null;

    // Cena „od …“ u množstevní slevy není cena kusu – takový produkt si cenu zapíše až z detailu
    if (AlzaCore.hasListingQuantityDiscount(item)) return null;
    const prices = AlzaCore.extractPricesFromListingItem(item);
    if (AlzaCore.getPriceEntries(prices).length === 0) return null; // Box bez ceny (reklama, nedostupné bez ceny)
    const image = item.querySelector(this.selectors.image)?.getAttribute("src");
    const availability = item.querySelector(this.selectors.availability)?.textContent.replace(/\s+/g, " ").trim();
    return {
      url: url.href,
      name: link.textContent.replace(/\s+/g, " ").trim() || null,
      image: AlzaCore.isAlzaImageUrl(image) ? image : null,
      prices,
      availability: availability ? AlzaCore.classifyAvailability(availability, this.state.lang) : null,
    };
  },

  // Detail produktu (content.js) – jen do přehledu procházených produktů, historii zapisuje sám. Volba
  // saveBrowsing už je ověřená tam (init tady ještě nemusí mít nastavení načtené)
  rememberProduct({ url, name, image }) {
    if (!this.state.domainKey || !AlzaCore.isAlzaUrl(url)) return;
    const key = AlzaCore.getProductKey(this.state.domainKey, url);
    this.state.pending.set(key, { url, name, image: AlzaCore.isAlzaImageUrl(image) ? image : null, prices: null, availability: null });
    this.scheduleFlush();
  },

  scheduleFlush() {
    clearTimeout(this.state.flushTimeout);
    this.state.flushTimeout = setTimeout(() => this.flush(), this.flushDelayMs);
  },

  flush() {
    clearTimeout(this.state.flushTimeout);
    if (this.state.pending.size === 0) return this.state.queue;
    const batch = new Map(this.state.pending);
    this.state.pending.clear();
    this.state.queue = this.state.queue
      .then(() => this.write(batch))
      .catch((error) => console.error("Alza Price Insight – uložení cen z procházení:", error));
    return this.state.queue;
  },

  // Ceny s DPH? Znak na stránce (patička boxu "bez DPH …", druhá cena na detailu); stránka bez něj (homepage)
  // A) porovná ceny s nedávno uloženými, B) když nemá s čím, převezme ověření z jiné stránky za poslední
  // hodinu. Náznak cen bez DPH z porovnání má přednost před starším ověřením
  async resolveVat(pageVat, priced, histories, vatChecks) {
    if (pageVat !== null) return pageVat;
    const { domainKey } = this.state;
    const pairs = priced.map((product) => ({ prices: AlzaCore.toPriceMap(product.prices), entries: histories.get(product) }));
    const fromPrices = AlzaCore.getVatFromKnownPrices(pairs, domainKey);
    if (fromPrices !== null) {
      await AlzaCore.recordVatCheck(domainKey, fromPrices);
      return fromPrices;
    }
    return AlzaCore.getRecentVatCheck(vatChecks, domainKey) === true;
  },

  // Ceny jen přihlášeného a s DPH (jako všude jinde) – jinak by se do historie dostaly ceny bez benefitů
  // nebo bez daně. Přehled procházených produktů se doplní jen s uloženými cenami (detail bez cen vždy)
  async write(batch) {
    const { vatCheck: vatKey } = AlzaCore.storageKeys;
    const { domainKey, lang } = this.state;
    const pageVat = AlzaCore.getListingVatState(document);
    if (pageVat !== null) await AlzaCore.recordVatCheck(domainKey, pageVat);

    const priced = [...batch.values()].filter((product) => product.prices);
    const historyKey = (product) => AlzaCore.getHistoryKey(domainKey, product.url);
    const canTry = priced.length > 0 && pageVat !== false && AlzaCore.getLoginState(document) === true;
    const data = await chrome.storage.local.get([vatKey, ...(canTry ? priced.map(historyKey) : [])]);
    const histories = new Map(priced.map((product) => [product, AlzaCore.normalizeHistory(data[historyKey(product)], lang)]));
    const savePrices = canTry && (await this.resolveVat(pageVat, priced, histories, data[vatKey]));

    // Bez přihlášení / bez DPH / neověřené DPH – produkty s cenami nic; detail bez cen (prices: null) vždy
    const products = [...batch.values()].filter((product) => !product.prices || savePrices);
    // Zápis historie i přehledu přes frontu služby na pozadí (AlzaStore) – víc záložek najednou se nepřepíše
    if (products.length > 0) await AlzaStore.run({ type: "recordBrowsing", domain: domainKey, lang, products, now: Date.now() });
  },
};

AlzaBrowsing.init().catch((error) => console.error("Alza Price Insight – procházení:", error));
