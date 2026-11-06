// Náhrada chrome.* API + vymyšlená data pro snímky do Chrome Web Store. Trh podle window.LANG (cs / sk / hu / en)
(() => {
  const D = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const MARKETS = {
    cs: { domain: "alza_cz", host: "www.alza.cz", ui: "cs", browser: "cs", conv: (p) => p },
    en: { domain: "alza_cz", host: "www.alza.cz", ui: "en", browser: "en-GB", conv: (p) => p },
    sk: { domain: "alza_sk", host: "www.alza.sk", ui: "sk", browser: "sk", conv: (p) => Math.floor(p / 25) + 0.9 },
    hu: { domain: "alza_hu", host: "www.alza.hu", ui: "hu", browser: "hu", conv: (p) => Math.round((p * 15) / 100) * 100 - 10 },
  };
  const NAMES = {
    headphones: { cs: "Bezdrátová sluchátka ANC Pro", sk: "Bezdrôtové slúchadlá ANC Pro", hu: "Vezeték nélküli ANC Pro fejhallgató", en: "Wireless ANC Pro headphones" },
    vacuum: { cs: "Robotický vysavač S8 s mopem", sk: "Robotický vysávač S8 s mopom", hu: "S8 robotporszívó felmosóval", en: "S8 robot vacuum with mop" },
    capsules: { cs: "Kapsle do myčky All in 1, 90 ks", sk: "Kapsule do umývačky All in 1, 90 ks", hu: "All in 1 mosogatógép-kapszula, 90 db", en: "All in 1 dishwasher capsules, 90 pcs" },
    keyboard: { cs: "Mechanická klávesnice TKL", sk: "Mechanická klávesnica TKL", hu: "TKL mechanikus billentyűzet", en: "TKL mechanical keyboard" },
    watch: { cs: "Chytré hodinky Active 2", sk: "Inteligentné hodinky Active 2", hu: "Active 2 okosóra", en: "Active 2 smartwatch" },
  };
  // Kapsle: ceny pro každý trh zvlášť, ať je cena za kus čitelná i v € (original, AlzaPlus+, dřívější AlzaPlus+, cíl za kus)
  const CAPSULES = {
    cs: { original: 449, applus: 399, before: 419, unitTarget: 4.2 },
    en: { original: 449, applus: 399, before: 419, unitTarget: 4.2 },
    sk: { original: 19.9, applus: 15.9, before: 17.9, unitTarget: 0.16 },
    hu: { original: 6690, applus: 5790, before: 6190, unitTarget: 60 },
  };
  const LISTS = { cs: ["Vánoce", "Domácnost"], sk: ["Vianoce", "Domácnosť"], hu: ["Karácsony", "Háztartás"], en: ["Christmas", "Household"] };

  const LANG = window.LANG || "cs";
  const M = MARKETS[LANG];
  const c = M.conv;
  window.MARKET = { ...M, lang: LANG, lists: LISTS[LANG], capsules: CAPSULES[LANG] };

  const store = {};
  const listeners = [];
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const pick = (keys) => {
    if (keys == null) return clone(store);
    const r = {};
    [].concat(keys).forEach((k) => k in store && (r[k] = clone(store[k])));
    return r;
  };
  const local = {
    get(keys, cb) { const r = pick(keys); if (cb) setTimeout(() => cb(r), 0); return Promise.resolve(r); },
    set(data, cb) {
      const changes = {};
      Object.entries(data).forEach(([k, v]) => { changes[k] = { oldValue: clone(store[k]), newValue: clone(v) }; store[k] = clone(v); });
      setTimeout(() => listeners.forEach((l) => l(changes, "local")), 0);
      if (cb) setTimeout(cb, 0);
      return Promise.resolve();
    },
    remove(k, cb) { [].concat(k).forEach((x) => delete store[x]); if (cb) setTimeout(cb, 0); return Promise.resolve(); },
    getBytesInUse: async () => 0,
  };
  const noop = { addListener() {} };
  window.chrome = {
    storage: { local, onChanged: { addListener: (l) => listeners.push(l) } },
    runtime: { lastError: null, onMessage: noop, getManifest: () => ({ name: "Alza Price Insight", version: window.EXT_VERSION || "dev" }), getURL: (p) => "chrome-extension://shots/" + p, sendMessage: () => Promise.resolve(), openOptionsPage() {} },
    i18n: { getUILanguage: () => M.browser, getMessage: () => "Alza Price Insight" },
    tabs: { query: (q, cb) => (cb ? cb([]) : Promise.resolve([])), sendMessage: (id, m, cb) => (cb ? cb(null) : Promise.resolve(null)), create() {} },
    alarms: { get: async () => ({ name: "alzaWatchRun", scheduledTime: Date.now() + 38 * 60000 }) }, // Další kontrola v popupu
  };
  window.__store = store;

  // Souvislé úseky historie: [odDní, doDní, ceny, dostupnost] → záznamy { t, s, p, a }
  const history = (segments) => segments.map(([from, to, p, a = "in"]) => ({ t: now - from * D, s: now - to * D - (to === 0 ? 0 : 60000), p, a }));
  const ids = { headphones: 7001, vacuum: 7002, capsules: 7003, keyboard: 7004, watch: 7005 };
  const icons = { headphones: "🎧", vacuum: "🤖", capsules: "🧼", keyboard: "⌨️", watch: "⌚" };
  const products = {};
  Object.keys(ids).forEach((k) => { products[k] = { url: `https://${M.host}/produkt-${k}-d${ids[k]}.htm`, name: NAMES[k][LANG], icon: icons[k] }; });
  window.__products = products;

  const P = (prices) => Object.fromEntries(Object.entries(prices).map(([t, v]) => [t, c(v)]));
  const H = (k) => `alzaHistory_${M.domain}_${ids[k]}`;
  const AlzaCorePriceKey = (url) => `alzaPrice_${M.domain}_${url.match(/-d(\d+)\.htm/)[1]}`;
  const cap = CAPSULES[LANG];
  store[H("headphones")] = history([
    [178, 120, P({ original: 2999 })], [120, 106, P({ original: 2999, special: 2699 })], [106, 40, P({ original: 2999 })],
    [40, 33, P({ original: 2999, applus: 2849 })], [33, 9, P({ original: 2999 })], [9, 0, P({ original: 2999, special: 2499, applus: 2399 })],
  ]);
  store[H("vacuum")] = history([
    [176, 64, P({ original: 9990 })], [64, 52, P({ original: 9990 }), "order"], [52, 21, P({ original: 9990 })],
    [21, 12, P({ original: 9990, special: 8490 })], [12, 0, P({ original: 12990, special: 9990 })],
  ]);
  store[H("capsules")] = history([
    [170, 90, { original: cap.original }], [90, 78, { original: cap.original, applus: cap.before }], [78, 6, { original: cap.original }],
    [6, 0, { original: cap.original, applus: cap.applus }],
  ]);
  store[H("keyboard")] = history([
    [160, 100, P({ original: 1899 })], [100, 92, P({ original: 1899, discount: 1699 })], [92, 14, P({ original: 1899 })], [14, 0, P({ original: 2199 })],
  ]);
  store[H("watch")] = history([
    [175, 130, P({ original: 4490 })], [130, 121, P({ original: 4490, special: 3790 })], [121, 20, P({ original: 4490 })],
    [20, 3, P({ original: 4490, special: 4190 })], [3, 0, P({ original: 4490, special: 3890 })],
  ]);

  const record = (prices, min, max, extra = {}) => ({ ...prices, lastUpdated: now, listId: "1", minPrice: { value: min, timestamp: now - 9 * D }, maxPrice: { value: max, timestamp: now - 12 * D }, ...extra });
  window.__records = {
    [products.headphones.url]: record(P({ original: 2999, special: 2499, applus: 2399 }), c(2399), c(2999), { oldLowestPrice: c(2799), newLowestPrice: c(2399) }),
    [products.vacuum.url]: record(P({ original: 12990, special: 9990 }), c(8490), c(12990)),
    [products.capsules.url]: record({ original: cap.original, applus: cap.applus }, cap.applus, cap.original, { packCount: 90 }),
    [products.keyboard.url]: record(P({ original: 2199 }), c(1699), c(2199), { oldLowestPrice: c(1899), newLowestPrice: c(2199) }),
    [products.watch.url]: record(P({ original: 4490, special: 3890 }), c(3790), c(4490), { oldLowestPrice: c(4190), newLowestPrice: c(3890) }),
  };
  // Záznamy cen po produktech jako v rozšíření (alzaPrice_<doména>_<id>)
  Object.entries(window.__records).forEach(([url, rec]) => (store[AlzaCorePriceKey(url)] = { ...rec, url }));
  store.alzaTargets = {
    [`${M.domain}_7005`]: { price: c(3990), below: true, url: products.watch.url, domain: M.domain, name: products.watch.name, since: now - 30 * D },
    [`${M.domain}_7003`]: { price: Math.round(cap.unitTarget * 90 * 100) / 100, below: false, url: products.capsules.url, domain: M.domain, name: products.capsules.name, since: now - 20 * D, unit: true, packCount: 90 },
  };
  const listUrl = (id) => `https://${M.host}/Order1.htm?listId=${id}`;
  store.alzaWatchLists = {
    [`${M.domain}|1`]: { domain: M.domain, listId: "1", name: LISTS[LANG][0], url: listUrl(1), since: now - 60 * D, products: Object.fromEntries(Object.values(products).map((p) => [p.url, { name: p.name }])) },
    [`${M.domain}|2`]: { domain: M.domain, listId: "2", name: LISTS[LANG][1], url: listUrl(2), since: now - 40 * D, products: {} },
  };
  store.alzaSettings = { categoryUnitPrice: true, uiLanguage: M.ui };

  // Content script po načtení: stav jako na dané Alze, texty v jazyce snímku
  window.setupTracker = () => {
    const T = window.AlzaPriceTracker;
    const { currency, locale, lang } = AlzaCore.domains[M.domain];
    Object.assign(T.state, { currencySymbol: currency, locale, language: lang, uiLanguage: AlzaCore.getDisplayLanguage(store.alzaSettings, lang) });
    T.state.targets = clone(store.alzaTargets);
    return T;
  };
  // Dialog historie nemodálně, aby šel vložit do snímku
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
})();
