// Sdílená logika pro content scripty, službu na pozadí, offscreen dokument, popup i nastavení:
// parsování stránky produktu, klasifikace dostupnosti, historie cen, formátování, hodnocení ceny,
// cena za kus a log chyb.
// Nesmí sahat na window/document při načtení – v service workeru neexistují.
// Datové struktury ve storage (JSDoc pro nápovědu editoru; kontrola typů není zapnutá):
/**
 * @typedef {{ [type: string]: number }} PriceMap  typ ceny (original, special, applus…) → cena
 * @typedef {{ t: number, s: number, p: PriceMap, a: string | null, n?: string }} HistoryEntry
 *   t = kdy byl stav poprvé zjištěn, s = poslední kontrola se stejným stavem, a = kód dostupnosti, n = název (jen při změně)
 * @typedef {{ value: number, timestamp: number }} PricePoint
 * @typedef {{ [type: string]: number | { price: number, icon: string | null } | any,
 *   url?: string, lastUpdated?: number, listId?: string | number, minPrice?: PricePoint, maxPrice?: PricePoint,
 *   maxLowestPrice?: PricePoint, oldLowestPrice?: number, newLowestPrice?: number, noPrice?: boolean,
 *   packCount?: number, quantityTiers?: number[][], conditions?: { current: string, prices: object } }} PriceRecord
 *   záznam ceny alzaPrice_<doména>_<id> (mergePriceRecord)
 * @typedef {{ price: number, below: boolean, url: string, domain: string, name?: string, image?: string,
 *   since: number, unit?: true, packCount?: number }} Target  cílová cena (alzaTargets)
 * @typedef {{ domain: string, listId: string, name: string, url: string | null, since: number | null,
 *   syncedAt: number | null, products: { [url: string]: { name?: string, image?: string } } }} WatchList  (alzaWatchLists)
 */
const AlzaCore = {
  historyMaxEntries: 500, // Max. počet změn v historii jednoho produktu (nejstarší se zahazují)
  dayMs: 24 * 60 * 60 * 1000,
  discountWindowDays: 30, // Okno pro porovnání slevy s nejnižší cenou (jako směrnice Omnibus)
  discountWarningMinPercent: 2, // Menší rozdíl (běžné kolísání o pár korun) se za podezřelou slevu nepovažuje
  typicalWindowDays: 180, // Obvyklá cena = medián prodejní ceny za toto období
  verdictMinDays: 14, // S kratší historií se obvyklá cena ani přeškrtnutá cena nehodnotí
  verdictTolerancePercent: 3, // Odchylka od obvyklé ceny, která je ještě „obvyklá“
  saleCycleMinSales: 3, // Rytmus akcí až od tolika akcí se známým začátkem
  saleCycleMaxVariation: 0.5, // Rozptyl odstupů akcí (směrodatná odchylka / průměr), do kterého je rytmus pravidelný
  saleCycleWaitDays: 21, // „Vyplatí se počkat“, když se další akce čeká do tolika dní
  saleCycleMinDepth: 0.05, // … a bývá aspoň o tolik pod obvyklou cenou
  strikethroughStaleDays: 90, // Přeškrtnutá cena, která naposledy platila dřív, je podezřelá
  publicPriceTypes: ["original", "special", "blackfriday"], // Ceny pro všechny – bez členství, benefitů, kódů a cashbacku
  errorLogMaxEntries: 200, // Starší chyby se zahazují
  staleDataDays: 90, // Nehlídaný produkt bez kontroly i otevření déle než tohle se navrhne ke smazání
  staleBrowsedDays: 365, // …a produkt uložený při procházení (výpis, detail) – jeho historie má cenu i po delší době
  cleanupSnoozeDays: 30, // „Připomenout později“ u návrhu čistky
  vatCheckMaxAgeMs: 60 * 60 * 1000, // Ověření DPH z jiné stránky platí pro stránku bez znaku DPH (homepage) tak dlouho
  vatCheckRefreshMs: 10 * 60 * 1000, // Stejný výsledek ověření DPH se zapisuje nejvýš jednou za tuto dobu
  vatCompareMaxAgeDays: 7, // Pro porovnání cen s historií (stránka bez znaku DPH) jen nedávno uložené ceny

  // Klíče ve storage sdílené content scriptem, službou na pozadí, popupem a nastavením
  storageKeys: {
    watchLists: "alzaWatchLists",
    targets: "alzaTargets", // { "<doména>_<id>": { price, below, url, domain, name, image, since, unit?, packCount? } }
    watchProducts: "alzaWatchProducts", // Hlídané produkty mimo seznamy: { "<doména>_<id>": { url, domain, name, image, since } }
    settings: "alzaSettings",
    watchState: "alzaWatchState", // Stav posledního běhu kontroly na pozadí (popup, číslo na ikoně)
    watchLog: "alzaWatchLog", // Log běhů kontroly
    errorLog: "alzaErrorLog", // Chyby ze všech částí rozšíření – pro diagnostiku (Nastavení → Pokročilé)
    cleanup: "alzaCleanup", // Návrh čistky pro modré číslo na ikoně a popup: { count, at, snoozedUntil }
    // Produkty uložené při procházení (výpisy kategorií a vyhledávání, detail): { "<doména>_<id>": { url, domain, name, image, seenAt } }
    // – adresa a název pro přehled uložených dat, delší lhůta čistky
    browsed: "alzaBrowsed",
    // Poslední ověření, jestli jsou ceny s DPH (výpis, detail, kontrola na pozadí): { "<doména>": { withVat, at } }
    // – stránka bez znaku DPH (homepage) ho převezme, když ceny nemá s čím porovnat
    vatCheck: "alzaVatCheck",
  },

  // Klíče po produktech: "<prefix><doména>_<číslo produktu>" (getProductKey). Historie: [{ t, s, p, a, n? }],
  // záznam ceny: { <typ>: cena, …metaKeys } – poslední načtené ceny, min/max, šipka změny (mergePriceRecord).
  // legacyPrices = dřívější jeden objekt na doménu { url: záznam } (migrace v AlzaStore, import starých záloh)
  storagePrefixes: { history: "alzaHistory_", price: "alzaPrice_", legacyPrices: "alzaPrices_" },

  // Nastavení notifikací (stránka nastavení). Na log v popupu nemají vliv – ten ukazuje všechny změny
  defaultSettings: {
    notifyDrops: true,
    minDropPercent: 0, // Zlevnění menší než toto procento se neohlásí
    notifyNewPrices: true, // Nový typ ceny – akce, slevový kód, cashback…
    notifyAvailability: "all", // all = každá změna, inStock = jen naskladnění, off = vůbec
    quietHours: false, // V tichých hodinách se notifikace odloží na první kontrolu po jejich konci
    quietFrom: "22:00",
    quietTo: "07:00",
    checkSchedule: "1h", // Jak často kontrolovat na pozadí: 1h / 3h / 6h / 12h / daily (jednou denně v checkTime)
    checkTime: "08:00",
    categoryUnitPrice: true, // Skutečná cena za jednotku a řazení podle ní ve výpisech kategorií (category.js)
    saveBrowsing: true, // Ukládat ceny produktů viděných při procházení – výpisy (browsing.js) i detail
    uiLanguage: "auto", // Jazyk popupu a nápovědy: auto = podle prohlížeče, jinak cs / sk / hu / en
  },

  // Klíče záznamu ceny, které nejsou cenou
  // packCount = počet kusů v balení z detailu produktu (cena za kus v seznamu)
  // quantityTiers = množstevní slevy [[od, do, cena za kus], …] z detailu produktu (součet v seznamu)
  metaKeys: ["lastUpdated", "listId", "minPrice", "maxPrice", "maxLowestPrice", "oldLowestPrice", "newLowestPrice", "noPrice", "url", "packCount", "quantityTiers", "conditions"],
  laterRefundTypes: ["cashback", "scrappage"], // Peníze se vrací až po nákupu (cashback výrobce, výkup) – nejsou „k zaplacení“
  ignoredPriceTypes: ["neo"], // NEO pronájmy a další nežádoucí typy cen
  minPlausibleRatio: 0.5, // Do historického minima jen cena aspoň v této výši nejbližší vyšší ceny (getPlausibleLowest)

  availabilityCodes: ["in", "order", "expected", "out", "ended"],

  domains: {
    // vatRate = základní sazba DPH (getVatFromKnownPrices – poznat ceny bez DPH na homepage)
    alza_cz: { origin: "https://www.alza.cz", lang: "cz", currency: "Kč", locale: "cs-CZ", vatRate: 21 },
    alza_sk: { origin: "https://www.alza.sk", lang: "sk", currency: "€", locale: "sk-SK", vatRate: 23 },
    // cs-CZ záměrně: hu-HU nepíše u čtyřmístných čísel oddělovač tisíců ("1299 Ft" místo "1 299 Ft")
    alza_hu: { origin: "https://www.alza.hu", lang: "hu", currency: "Ft", locale: "cs-CZ", vatRate: 27 },
  },

  // Texty sdílené s content scriptem (ten je přebírá do svých překladů) a texty notifikací
  texts: {
    cz: {
      onOrder: "Na objednávku",
      currentlyUnavailable: "Momentálně nedostupné",
      notAvailable: "Nedostupné",
      expected: "Očekáváme",
      inStock: "Skladem",
      inTransit: "Na cestě",
      saleEnded: "Prodej skončil",
      type_original: "Původní cena",
      type_special: "Akční cena",
      type_discount: "Slevový kód",
      type_scrappage: "Výkup",
      type_cashback: "Cashback",
      type_applus: "AlzaPlus+",
      type_benefit: "Benefit",
      type_b2b: "B2B",
      type_blackfriday: "Black Friday",
      pieceUnit: "ks",
      notifyPriceDrop: "{0}: {1} → {2} (-{3}, -{4} %)",
      notifyPriceRise: "{0}: {1} → {2} (+{3}, +{4} %)",
      notifyNewPrice: "Nově {0}: {1}",
      notifyAvailability: "{0} → {1}",
      notifyTargetReached: "🎯 Cílová cena {0} – nyní {1}",
      suspiciousGap: "⚠️ {0} {1} je pod polovinou další ceny {2} – možná chyba načtení, ověřte na Alze",
      suspiciousJump: "⚠️ {0} {1} je pod polovinou obvyklé ceny {2} – možná chyba načtení, ověřte na Alze",
      notifySummaryTitle: "Změny na Alze: {0}",
      notifyProblemTitle: "Hlídání cen: kontrola selhala ({0})",
      notifyProblemNoData: "Na stránce nebyla nalezena cena ani dostupnost – Alza možná změnila web",
      notifyProblemNoAvailability: "Nenalezena dostupnost – Alza možná změnila web",
      notifyProblemNotProduct: "Stránka nevypadá jako detail produktu (přihlášení, captcha?)",
      notifyProblemFetch: "Stránku se nepodařilo načíst ({0})",
      notifyProblemNotLogged: "Nejste přihlášeni na Alze – ceny se neukládají, kontrola přerušena",
      notifyProblemLoginUnknown: "Nepodařilo se ověřit přihlášení – Alza možná změnila web, kontrola přerušena",
      notifyProblemWithoutVat: "Zobrazujete ceny bez DPH – ceny se neukládají. Vypněte „Zobrazovat ceny bez DPH“",
      notifyProblemVatUnknown: "Nepodařilo se ověřit, že ceny jsou s DPH – Alza možná změnila web, ceny se neukládají",
      badgeCleanup: "{0} – navrženo ke smazání: {1} starých produktů",
    },
    sk: {
      onOrder: "Na objednávku",
      currentlyUnavailable: "Momentálne nedostupné",
      notAvailable: "Nedostupné",
      expected: "Očakávame",
      inStock: "Skladom",
      inTransit: "Na ceste",
      saleEnded: "Predaj skončil",
      type_original: "Pôvodná cena",
      type_special: "Akciová cena",
      type_discount: "Zľavový kód",
      type_scrappage: "Výkup",
      type_cashback: "Cashback",
      type_applus: "AlzaPlus+",
      type_benefit: "Benefit",
      type_b2b: "B2B",
      type_blackfriday: "Black Friday",
      pieceUnit: "ks",
      notifyPriceDrop: "{0}: {1} → {2} (-{3}, -{4} %)",
      notifyPriceRise: "{0}: {1} → {2} (+{3}, +{4} %)",
      notifyNewPrice: "Novo {0}: {1}",
      notifyAvailability: "{0} → {1}",
      notifyTargetReached: "🎯 Cieľová cena {0} – teraz {1}",
      suspiciousGap: "⚠️ {0} {1} je pod polovicou ďalšej ceny {2} – možno chyba načítania, overte na Alze",
      suspiciousJump: "⚠️ {0} {1} je pod polovicou obvyklej ceny {2} – možno chyba načítania, overte na Alze",
      notifySummaryTitle: "Zmeny na Alze: {0}",
      notifyProblemTitle: "Sledovanie cien: kontrola zlyhala ({0})",
      notifyProblemNoData: "Na stránke sa nenašla cena ani dostupnosť – Alza možno zmenila web",
      notifyProblemNoAvailability: "Nenájdená dostupnosť – Alza možno zmenila web",
      notifyProblemNotProduct: "Stránka nevyzerá ako detail produktu (prihlásenie, captcha?)",
      notifyProblemFetch: "Stránku sa nepodarilo načítať ({0})",
      notifyProblemNotLogged: "Nie ste prihlásený na Alze – ceny sa neukladajú, kontrola prerušená",
      notifyProblemLoginUnknown: "Nepodarilo sa overiť prihlásenie – Alza možno zmenila web, kontrola prerušená",
      notifyProblemWithoutVat: "Zobrazujete ceny bez DPH – ceny sa neukladajú. Vypnite „Zobrazovať ceny bez DPH“",
      notifyProblemVatUnknown: "Nepodarilo sa overiť, že ceny sú s DPH – Alza možno zmenila web, ceny sa neukladajú",
      badgeCleanup: "{0} – navrhnuté na zmazanie: {1} starých produktov",
    },
    hu: {
      onOrder: "Rendelésre",
      currentlyUnavailable: "Pillanatnyilag nem elérhető",
      notAvailable: "Nem elérhető",
      expected: "Várható",
      inStock: "Raktáron",
      inTransit: "Úton",
      saleEnded: "Az értékesítés befejeződött",
      type_original: "Eredeti ár",
      type_special: "Akciós ár",
      type_discount: "Kuponkód",
      type_scrappage: "Beszámítás",
      type_cashback: "Cashback",
      type_applus: "AlzaPlus+",
      type_benefit: "Benefit",
      type_b2b: "B2B",
      type_blackfriday: "Black Friday",
      pieceUnit: "db",
      notifyPriceDrop: "{0}: {1} → {2} (-{3}, -{4} %)",
      notifyPriceRise: "{0}: {1} → {2} (+{3}, +{4} %)",
      notifyNewPrice: "Új {0}: {1}",
      notifyAvailability: "{0} → {1}",
      notifyTargetReached: "🎯 Célár {0} – most {1}",
      suspiciousGap: "⚠️ {0} {1} a következő ár ({2}) felénél is kevesebb – lehet, hogy beolvasási hiba, ellenőrizze az Alzán",
      suspiciousJump: "⚠️ {0} {1} a szokásos ár ({2}) felénél is kevesebb – lehet, hogy beolvasási hiba, ellenőrizze az Alzán",
      notifySummaryTitle: "Változások az Alzán: {0}",
      notifyProblemTitle: "Árfigyelés: sikertelen ellenőrzés ({0})",
      notifyProblemNoData: "Nem található ár és elérhetőség – az Alza talán megváltoztatta az oldalt",
      notifyProblemNoAvailability: "Nem található elérhetőség – az Alza talán megváltoztatta az oldalt",
      notifyProblemNotProduct: "Az oldal nem termékoldal (bejelentkezés, captcha?)",
      notifyProblemFetch: "Az oldal nem tölthető be ({0})",
      notifyProblemNotLogged: "Nincs bejelentkezve az Alzán – az árak nem kerülnek mentésre, ellenőrzés megszakítva",
      notifyProblemLoginUnknown: "A bejelentkezés nem ellenőrizhető – az Alza talán megváltoztatta az oldalt, ellenőrzés megszakítva",
      notifyProblemWithoutVat: "Az árak ÁFA nélkül jelennek meg – az árak nem kerülnek mentésre",
      notifyProblemVatUnknown: "Nem ellenőrizhető, hogy az árak ÁFÁ-val értendők – az árak nem kerülnek mentésre",
      badgeCleanup: "{0} – törlésre javasolt régi termékek: {1}",
    },
    en: {
      onOrder: "On order",
      currentlyUnavailable: "Currently unavailable",
      notAvailable: "Unavailable",
      expected: "Expected",
      inStock: "In stock",
      inTransit: "In transit",
      saleEnded: "Sale ended",
      type_original: "Original price",
      type_special: "Sale price",
      type_discount: "Discount code",
      type_scrappage: "Trade-in",
      type_cashback: "Cashback",
      type_applus: "AlzaPlus+",
      type_benefit: "Benefit",
      type_b2b: "B2B",
      type_blackfriday: "Black Friday",
      pieceUnit: "pc",
      notifyPriceDrop: "{0}: {1} → {2} (-{3}, -{4} %)",
      notifyPriceRise: "{0}: {1} → {2} (+{3}, +{4} %)",
      notifyNewPrice: "New {0}: {1}",
      notifyAvailability: "{0} → {1}",
      notifyTargetReached: "🎯 Target price {0} – now {1}",
      suspiciousGap: "⚠️ {0} {1} is less than half of the next price {2} – possibly a reading error, check on Alza",
      suspiciousJump: "⚠️ {0} {1} is less than half of the usual price {2} – possibly a reading error, check on Alza",
      notifySummaryTitle: "Changes on Alza: {0}",
      notifyProblemTitle: "Price watch: check failed ({0})",
      notifyProblemNoData: "No price or availability found on the page – Alza may have changed its website",
      notifyProblemNoAvailability: "Availability not found – Alza may have changed its website",
      notifyProblemNotProduct: "The page doesn't look like a product page (login, captcha?)",
      notifyProblemFetch: "The page could not be loaded ({0})",
      notifyProblemNotLogged: "You are not logged in to Alza – prices are not saved, check stopped",
      notifyProblemLoginUnknown: "Could not verify that you are logged in – Alza may have changed its website, check stopped",
      notifyProblemWithoutVat: "You are showing prices without VAT – prices are not saved. Turn off showing prices without VAT",
      notifyProblemVatUnknown: "Could not verify that prices include VAT – Alza may have changed its website, prices are not saved",
      badgeCleanup: "{0} – suggested for deletion: {1} old products",
    },
  },

  translate(lang, key, ...params) {
    return this.translateFrom(this.texts, lang, key, params);
  },

  // Text ze slovníku překladů { cz, sk, hu, en } (core, content scripty, popup, nastavení): zvolený jazyk →
  // čeština (zdroj, vždy úplná) → klíč. Jeden způsob dohledání, ať chybějící překlad všude dopadne stejně
  translateFrom(dictionary, lang, key, params = []) {
    return this.fillTemplate(dictionary[lang]?.[key] ?? dictionary.cz?.[key] ?? key, params);
  },

  // Doplní {0}, {1}… v jednom průchodu – "{1}" v názvu produktu se už znovu nenahradí. Funkce místo
  // řetězce – "$&" apod. v názvu produktu nebo chybě se nesmí interpretovat. Jiné hodnoty než text (tvary
  // slov ["den", "dny", "dní"]) vrací beze změny
  fillTemplate(text, params) {
    if (typeof text !== "string") return text;
    return text.replace(/\{(\d+)\}/g, (match, index) => (index < params.length ? String(params[index]) : match));
  },

  // Jen https stránky podporovaných domén Alzy – URL ze storage se stahují s cookies a otevírají
  isAlzaUrl(url) {
    try {
      const { protocol, origin } = new URL(url);
      return protocol === "https:" && Object.values(this.domains).some((domain) => domain.origin === origin);
    } catch {
      return false;
    }
  },

  // Ikony akcí u cen – https z kterékoli subdomény Alzy (www, image, cdn…); ikona ze zálohy nesmí
  // načítat obrázek z cizího serveru
  isAlzaAssetUrl(url) {
    try {
      const { protocol, hostname } = new URL(url);
      return protocol === "https:" && /(^|\.)alza\.(cz|sk|hu)$/.test(hostname);
    } catch {
      return false;
    }
  },

  // Obrázky produktů (ikona notifikace) – jen CDN Alzy
  isAlzaImageUrl(url) {
    try {
      const { protocol, hostname } = new URL(url);
      return protocol === "https:" && /^image\.alza\.(cz|sk|hu)$/.test(hostname);
    } catch {
      return false;
    }
  },

  // Klíč domény ze storage nebo zálohy ("alza_cz"…) – ne zděděné vlastnosti objektu ("constructor")
  isKnownDomain(domainKey) {
    return typeof domainKey === "string" && Object.hasOwn(this.domains, domainKey);
  },

  // Obrázek produktu z CDN Alzy v dané velikosti (Alza ho zmenší sama); null = není obrázek Alzy
  getProductImageUrl(imageUrl, size) {
    if (!this.isAlzaImageUrl(imageUrl)) return null;
    const url = new URL(imageUrl);
    url.searchParams.set("width", size);
    url.searchParams.set("height", size);
    return url.href;
  },

  getDomainKey(hostname) {
    if (hostname.includes("alza.sk")) return "alza_sk";
    if (hostname.includes("alza.hu")) return "alza_hu";
    return "alza_cz";
  },

  // Číslo produktu z URL – stejný produkt má v seznamu i na detailu jinak zapsanou adresu (parametry, slug)
  // Číslo produktu z adresy: "…-d123.htm", nebo "…?dq=123" (skupiny variant, např. kabely podle délky)
  getProductId(productUrl) {
    const match = String(productUrl).match(/-d(\d+)\.htm|[?&]dq=(\d+)/i);
    return match ? match[1] || match[2] : null;
  },

  getProductKey(domainKey, productUrl) {
    return `${domainKey}_${this.getProductId(productUrl) || productUrl}`;
  },

  getHistoryKey(domainKey, productUrl) {
    return `${this.storagePrefixes.history}${this.getProductKey(domainKey, productUrl)}`;
  },

  getPriceKey(domainKey, productUrl) {
    return `${this.storagePrefixes.price}${this.getProductKey(domainKey, productUrl)}`;
  },

  // "alzaPrice_alza_cz_123" / "alzaHistory_alza_cz_123" → { kind: "price" | "history", productKey, domain }; jinak null
  parseProductStorageKey(storageKey) {
    for (const kind of ["history", "price"]) {
      const prefix = this.storagePrefixes[kind];
      if (!storageKey.startsWith(prefix)) continue;
      const productKey = storageKey.slice(prefix.length);
      const domain = Object.keys(this.domains).find((key) => productKey.startsWith(`${key}_`));
      return domain ? { kind, productKey, domain } : null;
    }
    return null;
  },

  uiLanguages: ["cs", "sk", "hu", "en"],

  // Jazyk textů rozšíření na stránkách Alzy a v notifikacích ("cz" / "sk" / "hu" / "en"): volba v nastavení,
  // jinak jazyk domény. Stránka Alzy se čte vždy podle domény (dostupnost…) – tohle je jen zobrazení
  getDisplayLanguage(settings, domainLang) {
    const chosen = settings?.uiLanguage;
    if (!this.uiLanguages.includes(chosen)) return domainLang;
    return this.toTextLanguage(chosen);
  },

  // Dva zápisy jazyka: uiLanguages / nastavení a nápověda "cs", slovníky textů a domény "cz"
  toTextLanguage(uiLanguage) {
    return uiLanguage === "cs" ? "cz" : uiLanguage;
  },

  // Jazyk popupu a nápovědy: volba v nastavení (uiLanguage), jinak jazyk prohlížeče; jiné jazyky → angličtina.
  // Texty na stránkách Alzy a notifikace jsou v jazyce domény – podle něj se čtou i texty stránky (dostupnost…)
  getUiLanguage(settings = null) {
    if (this.uiLanguages.includes(settings?.uiLanguage)) return settings.uiLanguage;
    const browser = chrome.i18n.getUILanguage().split("-")[0];
    return this.uiLanguages.includes(browser) ? browser : "en";
  },

  // Nápověda v daném jazyce (sk, hu a en jsou strojové překlady české)
  getHelpUrl(language = this.getUiLanguage()) {
    const file = { cs: "help.html", sk: "help-sk.html", hu: "help-hu.html" }[language] || "help-en.html";
    return chrome.runtime.getURL(`src/help/${file}`);
  },

  async getSettings() {
    const { [this.storageKeys.settings]: stored } = await chrome.storage.local.get(this.storageKeys.settings);
    return { ...this.defaultSettings, ...stored };
  },

  // Kontrola na pozadí: perioda v minutách, daily = jednou denně ve zvolený čas (bez periody)
  checkSchedules: { "1h": 60, "3h": 180, "6h": 360, "12h": 720, daily: null },

  getCheckPeriodMinutes(settings) {
    const schedule = Object.hasOwn(this.checkSchedules, settings?.checkSchedule) ? settings.checkSchedule : this.defaultSettings.checkSchedule;
    return this.checkSchedules[schedule];
  },

  // Nejbližší čas "HH:MM" po now (dnes, nebo zítra) a poslední před ním – místní čas, takže i přes změnu
  // letního času. Neplatný čas = výchozí
  getDailyRunTimes(time, now = Date.now()) {
    const [hours, minutes] = /^\d{2}:\d{2}$/.test(time) ? time.split(":").map(Number) : this.defaultSettings.checkTime.split(":").map(Number);
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next.getTime() <= now) next.setDate(next.getDate() + 1);
    const previous = new Date(next);
    previous.setDate(previous.getDate() - 1);
    return { next: next.getTime(), previous: previous.getTime() };
  },

  // "22:00"–"07:00" přes půlnoc i "13:00"–"14:00" v rámci dne
  isQuietTime(settings, date = new Date()) {
    if (!settings.quietHours) return false;
    const toMinutes = (time) => {
      const [hours, minutes] = String(time).split(":").map(Number);
      return hours * 60 + (minutes || 0);
    };
    const now = date.getHours() * 60 + date.getMinutes();
    const from = toMinutes(settings.quietFrom);
    const to = toMinutes(settings.quietTo);
    if (Number.isNaN(from) || Number.isNaN(to) || from === to) return false;
    return from < to ? now >= from && now < to : now >= from || now < to;
  },

  formatPrice(price, domainKey) {
    const { currency, locale } = this.domains[domainKey] || this.domains.alza_cz;
    // Kč a Ft bez desetinných míst, € se dvěma
    const digits = currency === "€" ? 2 : 0;
    const formatted = price.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return `${formatted} ${currency}`;
  },

  // === Log chyb ===
  // console.error a nezachycené výjimky ze všech částí rozšíření (služba na pozadí, content scripty, popup,
  // nastavení) se ukládají do storage, aby je uživatel mohl poslat v diagnostice. Kód není minifikovaný:
  // stack ("src/content.js:1234:15") se podle verze dohledá přímo ve zdrojácích dané verze.
  errorLogQueue: [],
  errorLogTimer: null,
  errorLogInstalled: false,

  describeErrorArg(arg) {
    // Chyby i z jiného kontextu a objekty typu chrome.runtime.lastError ({ message }) – JSON by z nich dal "{}"
    if (arg && typeof arg === "object" && (typeof arg.stack === "string" || typeof arg.message === "string")) {
      return arg.stack || `${arg.name || "Error"}: ${arg.message}`;
    }
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  },

  // Kde chyba vznikla: background, /src/popup/popup.html…, u content scriptu stránka Alzy (bez parametrů)
  getErrorSource() {
    if (typeof window === "undefined") return "background";
    const { protocol, hostname, pathname } = globalThis.location;
    return protocol === "chrome-extension:" ? pathname : `${hostname}${pathname}`;
  },

  recordError(args) {
    const message = args.map((arg) => this.describeErrorArg(arg)).join(" ").slice(0, 2000);
    this.errorLogQueue.push({ t: Date.now(), source: this.getErrorSource(), version: chrome.runtime.getManifest().version, message });
    // Zápis dávkově – chyby chodí často v sériích (celý seznam produktů)
    if (!this.errorLogTimer) this.errorLogTimer = setTimeout(() => this.flushErrorLog().catch(() => {}), 1000);
  },

  // Zapisuje služba na pozadí (AlzaStore) – souběžné zápisy z více záložek by se jinak přepsaly.
  // Offscreen dokument AlzaStore nemá, chyby z něj se jen vypíšou do konzole
  async flushErrorLog() {
    this.errorLogTimer = null;
    const queued = this.errorLogQueue.splice(0);
    if (queued.length === 0 || typeof globalThis.AlzaStore === "undefined") return;
    await globalThis.AlzaStore.run({ type: "appendErrors", entries: queued });
  },

  // Volá se při načtení core.js. Chyby z kódu Alzy (stejné okno jako content script) se neukládají
  installErrorLog() {
    if (this.errorLogInstalled || typeof chrome === "undefined" || !chrome.storage?.local || !chrome.runtime?.getURL) return;
    this.errorLogInstalled = true;

    const originalError = console.error.bind(console);
    console.error = (...args) => {
      originalError(...args);
      try {
        this.recordError(args);
      } catch {
        // Log nesmí shodit volajícího (např. po aktualizaci rozšíření v otevřené stránce)
      }
    };

    const isOwn = (text) => typeof text === "string" && text.includes(chrome.runtime.getURL(""));
    globalThis.addEventListener?.("error", (event) => {
      if (isOwn(event.filename) || isOwn(event.error?.stack)) this.recordError([event.error || event.message]);
    });
    globalThis.addEventListener?.("unhandledrejection", (event) => {
      if (isOwn(event.reason?.stack)) this.recordError(["Unhandled rejection:", event.reason]);
    });
  },

  // === Content scripty ===

  // Po aktualizaci nebo vypnutí rozšíření zůstane content script v otevřené stránce bez spojení s rozšířením
  // (chrome.* hází "Extension context invalidated") – pak už nic nedělat
  isContextAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  },

  // Změna DOM jen v našich prvcích (třídy alza-price-tracker…) – na ni nereagovat, jinak by se vlastní
  // vykreslení samo znovu spouštělo
  // Prvky Alzy, kterým jen přidáváme třídu (buňka ceny, záložka seznamu, dostupnost – mají data-testid), naše
  // nejsou: když je React přepíše, reagovat se musí (obnova cen)
  isOwnMutation(record) {
    const isOwn = (node) => {
      const marked = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[class*="alza-price-tracker"]');
      return Boolean(marked) && !marked.hasAttribute("data-testid");
    };
    if (record.type === "attributes") return isOwn(record.target);
    if (isOwn(record.target)) return true;
    return [...record.addedNodes, ...record.removedNodes].every(isOwn);
  },

  // MutationObserver, který se po zneplatnění kontextu rozšíření sám odpojí; ignoreOwn = přeskočit dávky
  // jen s vlastními změnami (isOwnMutation). Použití jako new MutationObserver(callback)
  createObserver(callback, { ignoreOwn = false } = {}) {
    const observer = new MutationObserver((records) => {
      if (!this.isContextAlive()) {
        observer.disconnect();
        return;
      }
      if (ignoreOwn && records.every((record) => this.isOwnMutation(record))) return;
      callback(records, observer);
    });
    return observer;
  },

  // Cena za kus na setiny jako u Alzy ("3,32 Kč")
  formatUnitPrice(price, domainKey) {
    const { currency, locale } = this.domains[domainKey] || this.domains.alza_cz;
    return `${price.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  },

  // Cíl za kus: { unit: true, packCount } u záznamu cílové ceny (price je i tak celková cena balení,
  // aby kontrola na pozadí nemusela nic přepočítávat). null = cíl je na celou cenu
  getTargetPackCount(target) {
    const count = target?.packCount;
    return target?.unit === true && Number.isInteger(count) && count > 0 ? count : null;
  },

  // Cena ve tvaru cílové ceny: u cíle za kus "2,50 Kč/ks (900 Kč)", jinak "900 Kč"
  formatTargetValue(value, target, domainKey, lang) {
    const total = this.formatPrice(value, domainKey);
    const packCount = this.getTargetPackCount(target);
    if (!packCount) return total;
    return `${this.formatUnitPrice(value / packCount, domainKey)}/${this.translate(lang, "pieceUnit")} (${total})`;
  },

  // Převod libovolné hodnoty na číslo (umí i "9 549 Kč", "-5"): parsePrice + znaménko na začátku; NaN = není číslo
  toNumber(val) {
    if (typeof val === "number") return Number.isFinite(val) ? val : NaN;
    if (val == null) return NaN;
    const text = String(val);
    const n = this.parsePrice(text);
    if (!Number.isFinite(n)) return NaN;
    return /^\s*[-−]/.test(text) ? -n : n;
  },

  // Produkty navržené ke smazání ze snímku celého storage: nehlídané (seznam, detail, cílová cena) a déle
  // než staleDataDays bez kontroly – čas z historie i z uložených cen seznamu (otevřený seznam nebo detail
  // ho obnovuje); produkty uložené při procházení až po staleBrowsedDays.
  // [{ key, historyKey, priceKey, browsed, checkedAt }]
  findStaleProducts(all, now = Date.now()) {
    const cutoff = now - this.staleDataDays * this.dayMs;
    const browsedCutoff = now - this.staleBrowsedDays * this.dayMs;
    const browsed = all[this.storageKeys.browsed] || {};
    const tracked = new Set([...Object.keys(all[this.storageKeys.watchProducts] || {}), ...Object.keys(all[this.storageKeys.targets] || {})]);
    Object.values(all[this.storageKeys.watchLists] || {}).forEach((list) =>
      Object.keys(list?.products || {}).forEach((url) => tracked.add(this.getProductKey(list?.domain, url)))
    );

    const products = new Map();
    const get = (key) => {
      if (!products.has(key)) {
        const seenAt = Number(browsed[key]?.seenAt) || 0;
        products.set(key, { key, historyKey: null, priceKey: null, browsed: Object.hasOwn(browsed, key), checkedAt: seenAt });
      }
      return products.get(key);
    };
    Object.keys(browsed).forEach(get); // I bez historie (výpis bez cen) – smaže se jen záznam v přehledu
    Object.entries(all).forEach(([storageKey, value]) => {
      const parsed = this.parseProductStorageKey(storageKey);
      if (!parsed) return;
      const product = get(parsed.productKey);
      if (parsed.kind === "history") {
        product.historyKey = storageKey;
        const last = Array.isArray(value) ? value[value.length - 1] : null;
        product.checkedAt = Math.max(product.checkedAt, Number(last?.s) || 0);
      } else {
        product.priceKey = storageKey;
        product.checkedAt = Math.max(product.checkedAt, Number(value?.lastUpdated) || 0);
      }
    });
    return [...products.values()].filter(
      (product) => !tracked.has(product.key) && product.checkedAt < (product.browsed ? browsedCutoff : cutoff)
    );
  },

  // Sloučí nově stažené ceny do záznamu stránky seznamu (alzaPrices_<doména>): typy cen, historické
  // min/max, prodejní maximum, šipka změny (old/newLowestPrice) a čas aktualizace. Mění a vrací record.
  // Sdílí stránka seznamu i služba na pozadí – po kontrole na pozadí pak seznam ceny znovu nestahuje
  mergePriceRecord(record, incoming = {}, listId = null, now = Date.now()) {
    const keepKeys = new Set(this.metaKeys);
    const blockFromIncoming = new Set(["minPrice", "maxPrice", "maxLowestPrice", "oldLowestPrice", "newLowestPrice", "lastUpdated", "listId"]); // tyto nikdy nepřebírat z incoming
    const toNumber = (val) => this.toNumber(val);

    // očistit dynamické price klíče, ale ponechat meta (min/max, noPrice, url, listId, lastUpdated)
    Object.keys(record).forEach((k) => {
      if (!keepKeys.has(k)) delete record[k];
    });

    // sloučit nové hodnoty (discount, special, original, apod.)
    let productChanged = false;
    for (const [k, v] of Object.entries(incoming)) {
      if (blockFromIncoming.has(k)) continue; // min/max/listId/lastUpdated NIKDY nepřebírat z incoming
      if (v !== null && v !== undefined) {
        record[k] = v;
        productChanged = true;
      } else {
        delete record[k];
      }
    }

    // NORMALIZACE starých hodnot min/max (kdyby byly uložené jako stringy)
    if (record.minPrice && typeof record.minPrice.value !== "number") {
      const coerced = toNumber(record.minPrice.value);
      if (Number.isFinite(coerced)) record.minPrice.value = coerced;
    }
    if (record.maxPrice && typeof record.maxPrice.value !== "number") {
      const coerced = toNumber(record.maxPrice.value);
      if (Number.isFinite(coerced)) record.maxPrice.value = coerced;
    }

    // z incoming vyber všechny číselné ceny (discount/special/benefit/b2b/original/…),
    // meta klíče ignorujeme
    const numericValues = [];
    for (const [k, v] of Object.entries(incoming)) {
      if (keepKeys.has(k)) continue;
      const n = typeof v === "object" && v !== null && "price" in v ? v.price : v;
      const num = toNumber(n);
      if (Number.isFinite(num)) numericValues.push(num);
    }

    // aktualizace historického min/max pouze pokud máme nové číselné ceny
    if (numericValues.length > 0) {
      delete record.noPrice; // produkt se znovu prodává
      const newMax = Math.max(...numericValues);
      // Nesmyslně nízká cena (getPlausibleLowest) se nepromítne do minima, prodejního maxima ani šipky
      const plausibleMin = this.getPlausibleLowest(numericValues);

      const currentMin = toNumber(record.minPrice?.value);
      const currentMax = toNumber(record.maxPrice?.value);

      // MIN – přepiš jen když je NOVĚ menší než dosavadní (bez nesmyslně nízkých cen, viz getPlausibleLowest)
      if (!Number.isFinite(currentMin) || plausibleMin < currentMin) {
        record.minPrice = { value: plausibleMin, timestamp: now };
      }

      // MAX – přepiš jen když je NOVĚ větší než dosavadní
      if (!Number.isFinite(currentMax) || newMax > currentMax) {
        record.maxPrice = { value: newMax, timestamp: now };
      }

      // PRODEJNÍ MAX – nejvyšší z nejnižších cen, tj. nejvíc, za kolik šel produkt reálně koupit
      // (maxPrice bývá ceníková cena, za kterou se s benefitem/kódem nekupuje)
      const currentMaxLowest = toNumber(record.maxLowestPrice?.value);
      if (!Number.isFinite(currentMaxLowest) || plausibleMin > currentMaxLowest) {
        record.maxLowestPrice = { value: plausibleMin, timestamp: now };
      }

      // Logika pro sledování změn ceny:
      // 1. Pokud existuje newLowestPrice z minulého fetch → přesuň do oldLowestPrice
      // 2. Pokud oldLowestPrice neexistuje (první uložení) → nastav ji
      // 3. Pokud se cena změnila → ulož do newLowestPrice (pro zobrazení šipky)
      const existingNewLowest = toNumber(record.newLowestPrice);

      if (Number.isFinite(existingNewLowest)) {
        // Existuje newLowestPrice z minulého fetch → přesun do oldLowestPrice
        record.oldLowestPrice = existingNewLowest;
        delete record.newLowestPrice;
      }

      // Po přesunu zkontroluj jestli se aktuální cena liší
      const currentOldLowest = toNumber(record.oldLowestPrice);

      if (!Number.isFinite(currentOldLowest)) {
        // První uložení - nastav oldLowestPrice
        record.oldLowestPrice = plausibleMin;
      } else if (plausibleMin !== currentOldLowest) {
        // Cena se změnila - ulož do newLowestPrice pro zobrazení šipky
        record.newLowestPrice = plausibleMin;
      }
    }

    // metadata + čas aktualizace
    if (productChanged || incoming.noPrice === true) {
      record.lastUpdated = now;
    }
    record.listId = listId ?? record.listId;
    return record;
  },

  // Pokles pod 1 % s desetinným místem – "-0 %" u malé slevy mate
  formatPercent(percent, domainKey) {
    const { locale } = this.domains[domainKey] || this.domains.alza_cz;
    return percent.toLocaleString(locale, { maximumFractionDigits: percent < 1 ? 1 : 0 });
  },

  // Text poklesu ceny: "Benefit: 2 253 Kč → 2 250 Kč (-3 Kč, -0,1 %)"
  formatPriceDrop(lang, label, previous, price, domainKey) {
    const format = (value) => this.formatPrice(value, domainKey);
    const percent = this.formatPercent(((previous - price) / previous) * 100, domainKey);
    return this.translate(lang, "notifyPriceDrop", label, format(previous), format(price), format(previous - price), percent);
  },

  // Zdražení – jen do přehledu změn v popupu a logu (neoznamuje se)
  formatPriceRise(lang, label, previous, price, domainKey) {
    const format = (value) => this.formatPrice(value, domainKey);
    const percent = this.formatPercent(((price - previous) / previous) * 100, domainKey);
    return this.translate(lang, "notifyPriceRise", label, format(previous), format(price), format(price - previous), percent);
  },

  // Starší uložené texty poklesu "Benefit: 228 Kč → 226 Kč (-1 %)" (log, přehled změn) převést
  // na nový tvar s částkou a desetinným místem. Ostatní texty beze změny
  upgradePriceDropText(text, url) {
    const match = text.match(/^(.+): (\S.*?) → (\S.*?) \(-\d+ %\)$/);
    if (!match || !this.isAlzaUrl(url)) return text;
    const domainKey = this.getDomainKey(new URL(url).hostname);
    const previous = this.parsePrice(match[2]);
    const price = this.parsePrice(match[3]);
    if (!(previous > price)) return text;
    return this.formatPriceDrop(this.domains[domainKey].lang, match[1], previous, price, domainKey);
  },

  // === Parsování stránky produktu ===

  // Cena z textu Alzy ("29 490,-", "1 299,90 €") bez znaménka – rozdíl ceny se znaménkem: parsePriceDifference,
  // obecné číslo: toNumber. Desetinná je čárka (Alza tisíce odděluje mezerou)
  parsePrice(priceText) {
    return parseFloat(String(priceText).replace(/[^\d,.]/g, "").replace(",", "."));
  },

  findPromoPriceElement(doc, dataTypes) {
    // Pro každý typ hledat jeho vlastní row a price element
    const selector = dataTypes.map((type) => `.promo-action-prices__row[data-type="${type}"]`).join(",");
    const parent = doc.querySelector(selector);

    if (!parent) return { element: null, parent: null };

    const priceElement = parent.querySelector(".promo-action-prices__price");
    return { element: priceElement, parent };
  },

  extractPromoPrice(element, parent, promoIconUrl) {
    if (!element || !parent) return null;

    return {
      price: this.parsePrice(element.textContent),
      icon: promoIconUrl,
    };
  },

  extractOriginalPrice(element) {
    if (!element) return null;
    return this.parsePrice(element.textContent);
  },

  getSpecialPriceIcon(container) {
    if (!container) return null;

    const imgElement = container.querySelector(".price-box__header img, .ads-pb__header img");
    return imgElement ? imgElement.getAttribute("src") : null;
  },

  getSpecialPriceText(element) {
    return element ? element.textContent.toLowerCase() : "";
  },

  processSpecialPrice(price, text, container, icon) {
    if (price === null) return {};

    if (text.includes("b2b")) {
      return {
        b2b: {
          price,
          icon: container ? icon : null,
        },
      };
    }

    if (text.includes("benefit")) {
      return { benefit: price };
    }

    return { special: price };
  },

  cleanPriceObject(prices) {
    const cleanedPrices = { ...prices };
    Object.keys(cleanedPrices).forEach((key) => {
      if (cleanedPrices[key] === null) delete cleanedPrices[key];
    });
    return cleanedPrices;
  },

  extractPricesFromDocument(doc) {
    // Extract icon
    const promoIconElement = doc.querySelector(".promo-action-prices__icon");
    const promoIconUrl = promoIconElement ? promoIconElement.getAttribute("src") : null;

    // Extract base prices (support both old and new Alza layout)
    const comparePriceElement = doc.querySelector(".price-box__compare-price, .js-compare-price, .ads-pb__original-price--strike");
    const originalPrice = this.extractOriginalPrice(comparePriceElement);

    // Find promo elements
    const discountInfo = this.findPromoPriceElement(doc, ["discountcode", "discountcouponpaywall"]);
    const scrappageInfo = this.findPromoPriceElement(doc, ["scrappage"]);
    const cashbackInfo = this.findPromoPriceElement(doc, ["cashback"]);
    const applusInfo = this.findPromoPriceElement(doc, ["applus"]);

    // Extract promo prices
    const discount = this.extractPromoPrice(discountInfo.element, discountInfo.parent, promoIconUrl);
    const scrappage = this.extractPromoPrice(scrappageInfo.element, scrappageInfo.parent, promoIconUrl);
    const cashback = this.extractPromoPrice(cashbackInfo.element, cashbackInfo.parent, promoIconUrl);
    const applus = this.extractPromoPrice(applusInfo.element, applusInfo.parent, promoIconUrl);

    // Build prices object
    const prices = {
      discount,
      scrappage,
      cashback,
      applus,
      original: originalPrice,
    };

    // Process special prices - look for main price box only, excluding NEO and alternative boxes
    const mainPriceBoxWrapper = doc.querySelector(".js-price-detail__main-price-box-wrapper");
    let specialPriceElement = null;
    let specialPriceHeader = null;
    let specialPriceHeaderContainer = null;
    let priceBox = null;

    if (mainPriceBoxWrapper) {
      specialPriceElement = mainPriceBoxWrapper.querySelector(".price-box__primary-price, .js-price-box__primary-price__value, .ads-pb__price-value");
      specialPriceHeader = mainPriceBoxWrapper.querySelector(".price-box__header-text, .ads-pb__header");
      specialPriceHeaderContainer = mainPriceBoxWrapper;
      priceBox = mainPriceBoxWrapper.querySelector(".price-box, .js-price-box, .ads-pb");
    }

    const specialPrice = specialPriceElement ? this.parsePrice(specialPriceElement.textContent) : null;
    const specialPriceText = this.getSpecialPriceText(specialPriceHeader);
    const specialPriceIcon = this.getSpecialPriceIcon(specialPriceHeaderContainer);

    // Black Friday box: hlavní cena je typu blackfriday, ne special
    const { isBlackFriday, isNormal: isNormalPriceBox } = this.classifyPriceBox(priceBox);
    const blackFridayPrice = isBlackFriday ? specialPrice : null;
    const hasHeaderText = specialPriceText && specialPriceText.trim().length > 0;
    let specialPrices = {};

    if (blackFridayPrice === null) {
      if (hasHeaderText) {
        // Special prices with header (b2b, benefit, etc.) - even if in normal box
        specialPrices = this.processSpecialPrice(specialPrice, specialPriceText, specialPriceHeaderContainer, specialPriceIcon);
      } else if (isNormalPriceBox && specialPrice !== null && !originalPrice) {
        // Normal price box without compare price and without header - use it as original
        specialPrices = { original: specialPrice };
      }
    }

    // Merge prices and clean nulls
    return this.cleanPriceObject({
      ...prices,
      ...specialPrices,
      blackfriday: blackFridayPrice,
    });
  },

  // Výsledek fetchProductPage ({ ok: false, error, status }) – má smysl stahovat znovu? Síť, timeout, 429
  // a chyby serveru ano; 404, přesměrování mimo Alzu a jiné 4xx ne (opakování by jen zatěžovalo Alzu)
  isRetryableFetchError({ status = 0, error = "" } = {}) {
    if (status === 429 || status >= 500) return true;
    return status === 0 && !/mimo Alzu/.test(error);
  },

  // Je to vůbec detail produktu? (jinak nejspíš přihlášení, captcha nebo chybová stránka)
  isProductDocument(doc) {
    return Boolean(doc.querySelector("#detailItem, #h1c h1, .js-price-detail__main-price-box-wrapper, [data-testid='component-availability']"));
  },

  // Ceny (benefit, B2B…) se liší podle účtu – bez přihlášení se nesmí nic zapsat. Více nezávislých
  // znaků, ať jedna změna na webu Alzy hned nerozbije detekci. Přísně: stačí jeden znak
  // nepřihlášení → false; true jen když ho aspoň jeden znak potvrdí; null = nepodařilo se poznat
  getLoginState(doc) {
    const signals = [];

    // Záhlaví: nepřihlášený má tlačítko "Přihlásit se"
    const headerToggle = doc.querySelector('[data-testid="headerContextMenuToggle"]');
    if (headerToggle) signals.push(!headerToggle.querySelector('[data-testid="headerContextMenuToggleLogin"]'));

    // Komponenta dostupnosti: třída userIsLogged a API pro uživatele/anonymního
    if (doc.querySelector(".userIsLogged, [data-api-url*='/v1/users/']")) signals.push(true);
    if (doc.querySelector("[data-api-url*='/v1/anonymous/']")) signals.push(false);

    // Konfigurace stránky v inline skriptu
    for (const script of doc.querySelectorAll("script")) {
      const match = script.textContent.match(/"isUserLogged"\s*:\s*(true|false)/);
      if (match) {
        signals.push(match[1] === "true");
        break;
      }
    }

    if (signals.includes(false)) return false;
    return signals.length > 0 ? true : null;
  },

  // Přepínač "Zobrazovat ceny bez DPH" prohodí hlavní a vedlejší cenu v boxu. Hlavní cena je s DPH,
  // když vedlejší říká "bez DPH". true = s DPH, false = bez DPH, null = nepodařilo se poznat
  getVatState(doc) {
    const secondary = doc.querySelector(".js-price-detail__main-price-box-wrapper .js-secondary-price, .js-secondary-price");
    const text = secondary?.textContent.replace(/\s+/g, " ").trim().toLowerCase();
    if (!text) return null;
    if (this.vatTextPatterns.mainWithVat.test(text)) return true;
    if (this.vatTextPatterns.mainWithoutVat.test(text)) return false;
    return null;
  },

  // Vedlejší cena v boxu: "bez DPH 22 306,-" = hlavní cena je s DPH; "s DPH …" = hlavní je bez DPH (přepínač)
  vatTextPatterns: {
    mainWithVat: /^(bez dph|áfa nélkül|nettó)/,
    mainWithoutVat: /^(s dph|vč\. dph|áfával|áfa-val|bruttó)/,
  },

  // Smí se ceny z dokumentu uložit? Vrací klíč textu s důvodem, nebo null. Bez přihlášení chybí
  // benefit/B2B ceny, s přepínačem bez DPH by se uložily ceny bez daně – obojí by rozbilo historii
  getSaveProblem(doc, prices) {
    const loggedIn = this.getLoginState(doc);
    if (loggedIn === false) return "notifyProblemNotLogged";
    if (loggedIn === null) return "notifyProblemLoginUnknown";

    if (this.getPriceEntries(prices).length > 0) {
      const withVat = this.getVatState(doc);
      if (withVat === false) return "notifyProblemWithoutVat";
      if (withVat === null) return "notifyProblemVatUnknown";
    }
    return null;
  },

  getProductImage(doc) {
    const url = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
    return this.isAlzaImageUrl(url) ? url : null;
  },

  // Nadpis stránky produktu – zdroj názvu do historie pro seznam, službu na pozadí i detail (stejné znění)
  getProductName(doc) {
    return doc.querySelector("#h1c h1, h1")?.textContent.replace(/\s+/g, " ").trim() || null;
  },

  // Nejnovější název z historie (záznam ho má jen tam, kde se změnil)
  getLatestName(entries) {
    for (let i = (entries?.length || 0) - 1; i >= 0; i--) {
      if (entries[i].n) return entries[i].n;
    }
    return null;
  },

  // Historie pro zobrazení (tabulka, počet změn, graf): záznamy lišící se jen názvem sloučit – ukazují
  // se změny cen a dostupnosti. Vrací kopie, uložená historie se nemění
  getPriceChangeHistory(entries) {
    const result = [];
    (entries || []).forEach((entry) => {
      const prev = result[result.length - 1];
      if (prev && prev.a === entry.a && this.isSamePriceMap(prev.p, entry.p)) {
        prev.s = Math.max(prev.s, entry.s);
      } else {
        result.push({ ...entry });
      }
    });
    return result;
  },

  // Dostupnost na detailu produktu (v seznamu se čte z položky seznamu). Alza markup mění,
  // proto více variant: React komponenta (přihlášený), starší span (anonymní HTML), schema.org
  extractAvailabilityFromDocument(doc) {
    const element = doc.querySelector('[data-testid*="availabilityText"], .avlVal');
    const text = element?.textContent.replace(/\s+/g, " ").trim();
    if (text) return text;

    const schemaCodes = { InStock: "in", PreOrder: "order", BackOrder: "order", OutOfStock: "out", SoldOut: "out", Discontinued: "ended" };
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      const match = script.textContent.match(/"availability"\s*:\s*"https?:\/\/schema\.org\/(\w+)"/);
      if (match && schemaCodes[match[1]]) return schemaCodes[match[1]];
    }
    return null;
  },

  // === Dostupnost a historie ===

  // Text dostupnosti → kód (in/order/expected/out/ended); neznámý text se uloží zkrácený
  classifyAvailability(raw, lang) {
    if (raw === null || raw === undefined) return null;
    if (this.availabilityCodes.includes(raw)) return raw;

    const text = raw.toLowerCase();
    const startsWith = (key) => text.startsWith(this.translate(lang, key).toLowerCase());
    if (startsWith("saleEnded")) return "ended";
    if (startsWith("inStock")) return "in";
    if (startsWith("onOrder")) return "order";
    if (startsWith("expected") || startsWith("inTransit")) return "expected";
    if (startsWith("currentlyUnavailable") || startsWith("notAvailable")) return "out";
    return raw.slice(0, 40);
  },

  getAvailabilityLabel(code, lang) {
    if (code === null || code === undefined) return "–";
    const keys = { in: "inStock", order: "onOrder", expected: "expected", out: "notAvailable", ended: "saleEnded" };
    return keys[code] ? this.translate(lang, keys[code]) : code;
  },

  // Ceny záznamu jako [{ type, price, icon }] vzestupně podle ceny
  getPriceEntries(prices) {
    const result = [];

    for (const [key, value] of Object.entries(prices)) {
      if (this.metaKeys.includes(key) || this.ignoredPriceTypes.includes(key)) continue;

      const numericPrice = typeof value === "object" && value !== null ? value.price : value;
      if (typeof numericPrice !== "number" || Number.isNaN(numericPrice)) continue;

      result.push({
        price: numericPrice,
        type: key,
        icon: typeof value === "object" && value?.icon ? value.icon : null,
      });
    }

    return result.sort((a, b) => a.price - b.price);
  },

  toPriceMap(prices) {
    return Object.fromEntries(this.getPriceEntries(prices || {}).map(({ type, price }) => [type, price]));
  },

  isSamePriceMap(a, b) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
  },

  // Prodejní cena = nejnižší z nabízených cen ({ typ: cena }), null = produkt se neprodává
  getLowestPrice(priceMap) {
    const values = Object.values(priceMap || {});
    return values.length > 0 ? Math.min(...values) : null;
  },

  // Cena k zaplacení při nákupu: nejnižší bez cashbacku a výkupu (ty se vrací až potom); null = jen takové ceny
  getPayNowPrice(priceMap) {
    const values = Object.entries(priceMap || {})
      .filter(([type]) => !this.laterRefundTypes.includes(type))
      .map(([, price]) => price);
    return values.length > 0 ? Math.min(...values) : null;
  },

  // Množstevní slevy ze záznamu – i z importu zálohy, proto kontrola tvaru; null = produkt je nemá
  getQuantityTiers(record) {
    const tiers = record?.quantityTiers;
    const valid = Array.isArray(tiers) && tiers.length > 1 && tiers.every(
      (tier) => Array.isArray(tier) && tier.length === 3 && tier.every(Number.isFinite) && tier[0] >= 1 && tier[1] >= tier[0] && tier[2] > 0
    );
    return valid ? tiers : null;
  },

  // Cena za kus při daném počtu kusů: stupeň množstevní slevy, ale nejvýš nejnižší nabízená cena. Jestli se
  // slevový kód nebo AlzaPlus+ se stupni sčítá, nevíme – počítáme opatrně tu nižší z obou
  getQuantityUnitPrice(tiers, lowest, quantity) {
    const tier = tiers?.find(([from, to]) => quantity >= from && quantity <= to);
    return tier && tier[2] < lowest ? tier[2] : lowest;
  },

  // Nejnižší cena pro historické minimum: cena pod polovinou nejbližší vyšší ceny z téhož načtení je
  // chyba čtení (dřív např. měsíční pronájem NEO 776 Kč u telefonu za 29 490 Kč), ne sleva. Minimum se
  // jen snižuje, taková hodnota by v něm zůstala navždy. Srovnává se s nejbližší vyšší cenou, ne
  // s ceníkovou – slevový kód pod polovinou ceníkové ceny (3mk: 73 Kč z 199 Kč, benefit 145 Kč) je skutečný
  getPlausibleLowest(values) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    let index = 0;
    while (index < sorted.length - 1 && sorted[index] < sorted[index + 1] * this.minPlausibleRatio) index++;
    return sorted.length > 0 ? sorted[index] : null;
  },

  getPlausibleMinPrice(priceMap) {
    return this.getPlausibleLowest(Object.values(priceMap || {}));
  },

  // Ceny bez nesmyslně nízkých (getPlausibleLowest) – pro odvozené údaje: šipku změny, hodnocení ceny,
  // podezřelou slevu, nejnižší cenu za 30 dní. Zobrazují se dál všechny ceny, podezřelé s výstrahou
  getPlausiblePriceMap(priceMap) {
    const plausible = this.getPlausibleMinPrice(priceMap);
    return Object.fromEntries(Object.entries(priceMap || {}).filter(([, price]) => price >= plausible));
  },

  // Podezřelé ceny (možná chyba čtení): ukážou se s výstrahou ⚠ a upozornění se pošle s ní – neschovají
  // se, ať se neztratí skutečná sleva. [{ type, price, reason, reference }] vzestupně podle ceny
  //   gap  = pod polovinou nejbližší vyšší ceny z téhož načtení – do minima, šipky, hodnocení ceny ani
  //          podezřelé slevy se nepočítá (reference = nejnižší věrohodná cena)
  //   jump = věrohodná cena pod polovinou obvyklé ceny za posledních 30 dní (cena se skokově propadla) –
  //          jen výstraha, počítá se normálně: skutečné zlevnění o víc než polovinu se nesmí ztratit.
  //          Po ustálení nové ceny (víc než půlku okna) výstraha zmizí (reference = obvyklá cena)
  getSuspiciousPrices(entries, priceMap, now = Date.now()) {
    const prices = this.getPriceEntries(priceMap || {});
    if (prices.length === 0) return [];
    const plausible = this.getPlausibleLowest(prices.map(({ price }) => price));
    const typical = this.getWeightedMedian(this.getPriceSegments(entries, this.discountWindowDays, now));

    const result = [];
    prices.forEach(({ type, price }) => {
      if (price < plausible) result.push({ type, price, reason: "gap", reference: plausible });
      else if (typical !== null && price < typical * this.minPlausibleRatio) result.push({ type, price, reason: "jump", reference: typical });
    });
    return result;
  },

  formatSuspiciousPrice(lang, { type, price, reason, reference }, domainKey) {
    const key = reason === "gap" ? "suspiciousGap" : "suspiciousJump";
    return this.translate(lang, key, this.translate(lang, `type_${type}`), this.formatPrice(price, domainKey), this.formatPrice(reference, domainKey));
  },

  // Cílová cena se ohlásí jednou při poklesu na ni nebo pod ni. Znovu až poté, co cena vystoupá nad
  // cíl a zase klesne. Vrací { below, reached } – reached = právě teď hranici překročila směrem dolů
  evaluateTarget(target, lowest) {
    if (!target || lowest === null) return { below: Boolean(target?.below), reached: false };
    const below = lowest <= target.price;
    return { below, reached: below && !target.below };
  },

  // Nejnižší prodejní cena v posledních `days` dnech historie (cena platí až do další změny, bez
  // nesmyslně nízkých cen – getPlausibleMinPrice).
  // { value, at = kdy naposledy platila, days = kolik dní historie okno pokrývá, complete }
  getLowestInWindow(entries, days = this.discountWindowDays, now = Date.now()) {
    if (!entries?.length) return null;
    const from = now - days * this.dayMs;
    let best = null;

    entries.forEach((entry, index) => {
      const end = entries[index + 1]?.t ?? entry.s;
      if (end < from) return;
      const lowest = this.getPlausibleMinPrice(entry.p);
      if (lowest === null) return;
      if (!best || lowest < best.value || (lowest === best.value && end > best.at)) best = { value: lowest, at: end };
    });

    if (!best) return null;
    const start = Math.max(entries[0].t, from);
    return { ...best, days: Math.max(0, Math.floor((now - start) / this.dayMs)), complete: entries[0].t <= from };
  },

  // Podezřelá sleva: produkt je ve slevě (víc cen), ale za posledních 30 dní byl k mání znatelně levněji.
  // Vrací výsledek getLowestInWindow nebo null, když je sleva v pořádku / není s čím srovnat
  getDiscountWarning(entries, currentPriceMap, now = Date.now()) {
    const values = Object.values(this.getPlausiblePriceMap(currentPriceMap));
    if (values.length < 2) return null;
    const current = Math.min(...values);
    if (current >= Math.max(...values)) return null;

    const lowest = this.getLowestInWindow(entries, this.discountWindowDays, now);
    return lowest && lowest.value < current * (1 - this.discountWarningMinPercent / 100) ? lowest : null;
  },

  // Úseky prodejní ceny (bez nesmyslně nízkých – getPlausibleMinPrice) v posledních `days` dnech:
  // [{ from, to, value }]. Cena platí do další změny,
  // poslední do poslední kontroly; záznamy bez ceny (neprodává se) se vynechají
  getPriceSegments(entries, days, now = Date.now()) {
    const from = now - days * this.dayMs;
    const result = [];
    (entries || []).forEach((entry, index) => {
      const value = this.getPlausibleMinPrice(entry.p);
      const end = entries[index + 1]?.t ?? entry.s;
      if (value === null || end < from) return;
      result.push({ from: Math.max(entry.t, from), to: end, value });
    });
    return result;
  },

  // Medián vážený dobou platnosti – krátká akce obvyklou cenu nestáhne, dlouhodobá cena ano
  getWeightedMedian(segments) {
    const total = segments.reduce((sum, segment) => sum + segment.to - segment.from, 0);
    if (total <= 0) return null;
    const sorted = [...segments].sort((a, b) => a.value - b.value);
    let accumulated = 0;
    for (const segment of sorted) {
      accumulated += segment.to - segment.from;
      if (accumulated >= total / 2) return segment.value;
    }
    return sorted[sorted.length - 1].value;
  },

  // Je aktuální prodejní cena dobrá? Srovnání s obvyklou cenou za posledních 180 dní historie.
  // { level, typical, lowest, days, complete, sales: { count, days } }, null = málo historie
  //   level: lowest = nejnižší za sledované období, good = pod obvyklou, usual, high = nad obvyklou
  //   sales = kolikrát byl produkt levnější než obvykle a kolik dní to v průměru trvalo
  getPriceVerdict(entries, current, now = Date.now()) {
    if (typeof current !== "number") return null;
    const segments = this.getPriceSegments(entries, this.typicalWindowDays, now);
    if (segments.length === 0) return null;
    const days = Math.floor((segments[segments.length - 1].to - segments[0].from) / this.dayMs);
    const typical = this.getWeightedMedian(segments);
    if (days < this.verdictMinDays || typical === null) return null;

    const tolerance = this.verdictTolerancePercent / 100;
    const cheap = typical * (1 - tolerance);
    const lowest = Math.min(...segments.map((segment) => segment.value));

    const sales = this.getSaleRuns(segments, cheap).map((sale) => sale.duration);

    let level = "usual";
    if (current < cheap) level = current <= lowest ? "lowest" : "good";
    else if (current > typical * (1 + tolerance)) level = "high";

    return {
      level,
      typical,
      lowest,
      days,
      complete: entries[0].t <= now - this.typicalWindowDays * this.dayMs,
      sales: {
        count: sales.length,
        days: sales.length > 0 ? sales.reduce((sum, duration) => sum + duration, 0) / sales.length / this.dayMs : 0,
      },
    };
  },

  // Akce = souvislý úsek prodejní ceny pod hranicí cheap (přerušený výpadkem prodeje se počítá zvlášť).
  // [{ from, to, lowest, duration = součet délek úseků, openStart = běžela už na začátku historie }]
  getSaleRuns(segments, cheap) {
    const runs = [];
    segments.forEach((segment, index) => {
      if (segment.value >= cheap) return;
      const previous = segments[index - 1];
      const last = runs[runs.length - 1];
      const duration = segment.to - segment.from;
      if (last && previous && previous.value < cheap && previous.to >= segment.from) {
        last.to = segment.to;
        last.lowest = Math.min(last.lowest, segment.value);
        last.duration += duration;
      } else {
        runs.push({ from: segment.from, to: segment.to, lowest: segment.value, duration, openStart: index === 0 });
      }
    });
    return runs;
  },

  // Rytmus akcí z historie (posledních typicalWindowDays dní): jak často, na jak dlouho a jak hluboko bývá produkt
  // pod obvyklou cenou a kdy se dá čekat další akce. null = málo historie nebo méně než saleCycleMinSales akcí
  // se známým začátkem (akce, která běžela už na začátku historie, se do rytmu nepočítá).
  // { count, interval, duration, depth, regular, onSale, lastStart, nextAt, wait }
  //   interval / duration ve dnech, depth = podíl pod obvyklou cenou (0,15 = −15 %),
  //   nextAt = kdy se čeká další akce (jen bez běžící akce a při pravidelném rytmu), wait = vyplatí se počkat
  getSaleCycle(entries, current, now = Date.now()) {
    const verdict = this.getPriceVerdict(entries, current, now);
    if (!verdict) return null;
    const segments = this.getPriceSegments(entries, this.typicalWindowDays, now);
    const cheap = verdict.typical * (1 - this.verdictTolerancePercent / 100);

    const sales = this.getSaleRuns(segments, cheap);
    const started = sales.filter((sale) => !sale.openStart);
    if (started.length < this.saleCycleMinSales) return null;

    const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const gaps = started.slice(1).map((sale, index) => (sale.from - started[index].from) / this.dayMs);
    const interval = average(gaps);
    const deviation = Math.sqrt(average(gaps.map((gap) => (gap - interval) ** 2)));
    const regular = interval > 0 && deviation / interval <= this.saleCycleMaxVariation;
    const onSale = typeof current === "number" && current < cheap;
    // Délka jen u skončených akcí – běžící by průměr zkreslila
    const finished = onSale ? sales.slice(0, -1) : sales;
    const duration = average((finished.length > 0 ? finished : sales).map((sale) => (sale.to - sale.from) / this.dayMs));
    const depth = average(sales.map((sale) => (verdict.typical - sale.lowest) / verdict.typical));
    const lastStart = started[started.length - 1].from;

    let nextAt = null;
    if (!onSale && regular) {
      nextAt = lastStart + interval * this.dayMs;
      // Rytmus zjevně skončil (další akce se nekoná už přes polovinu odstupu) – nic nepředpovídat
      if (now - nextAt > (interval / 2) * this.dayMs) nextAt = null;
    }
    const wait = nextAt !== null && nextAt - now <= this.saleCycleWaitDays * this.dayMs && depth >= this.saleCycleMinDepth;
    return { count: started.length, interval, duration, depth, regular, onSale, lastStart, nextAt, wait };
  },

  // Cena pro všechny (hlavní cenový box): akce nebo Black Friday, jinak běžná cena; null = není
  getPublicPrice(priceMap) {
    const values = this.publicPriceTypes.map((type) => priceMap?.[type]).filter((value) => typeof value === "number");
    return values.length > 0 ? Math.min(...values) : null;
  },

  // Vymyšlená přeškrtnutá cena: produkt je v akci, ale za přeškrtnutou cenu se za sledování nikdy
  // neprodával (never), nebo naposledy před víc než 90 dny. Srovnává se jen veřejná cena – členské
  // a benefitní ceny přeškrtnutou cenu nezpochybňují.
  // { claimed, never, at = kdy naposledy platila, highest = nejvyšší veřejná cena, days = délka historie }
  getStrikethroughWarning(entries, priceMap, now = Date.now()) {
    const currentPriceMap = this.getPlausiblePriceMap(priceMap);
    const claimed = currentPriceMap.original;
    const publicNow = this.getPublicPrice(currentPriceMap);
    if (typeof claimed !== "number" || publicNow === null || publicNow >= claimed * 0.99) return null;
    if (!entries?.length) return null;
    const days = Math.floor((now - entries[0].t) / this.dayMs);
    if (days < this.verdictMinDays) return null;

    let highest = null;
    let lastCharged = null;
    entries.forEach((entry, index) => {
      const value = this.getPublicPrice(entry.p);
      if (value === null) return;
      const end = entries[index + 1]?.t ?? entry.s;
      if (!highest || value > highest.value) highest = { value, at: end };
      if (value >= claimed * 0.99) lastCharged = end; // 1 % tolerance na zaokrouhlení
    });

    if (!highest) return null; // Starší historie bez veřejných cen – není s čím srovnat
    if (lastCharged === null) return { claimed, never: true, at: null, highest, days };
    if (now - lastCharged > this.strikethroughStaleDays * this.dayMs) return { claimed, never: false, at: lastCharged, highest, days };
    return null;
  },

  // Starší záznamy mohou mít dostupnost jako text (např. "Na cestě 1 ks") – překlasifikovat
  // a sloučit sousední záznamy, které se tím stanou shodnými (uloží se při dalším zápisu)
  normalizeHistory(entries, lang) {
    const result = [];
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      entry.a = this.classifyAvailability(entry.a, lang);
      const prev = result[result.length - 1];
      // Záznam se změnou názvu zůstává samostatný
      if (prev && !entry.n && prev.a === entry.a && this.isSamePriceMap(prev.p, entry.p)) {
        prev.s = entry.s;
      } else {
        result.push(entry);
      }
    });
    return result;
  },

  // Přidá kontrolu do historie (mění entries). Záznam { t, s, p, a, n? }:
  //   t = kdy byl stav poprvé zjištěn, s = poslední kontrola se stejným stavem,
  //   p = { typ: cena }, a = kód dostupnosti (in/order/expected/out, jinak text, null = neznámá),
  //   n = název produktu – jen u záznamu, kde se název změnil (Alza přidává a odebírá akce);
  //       změna názvu založí nový záznam i při stejných cenách
  appendHistory(entries, prices, availability, previousRecord, { now = Date.now(), name = null } = {}) {
    const snapshot = this.toPriceMap(prices);

    // První záznam navážeme na dosud uložené ceny, aby byla případná změna vidět hned
    if (entries.length === 0 && previousRecord?.lastUpdated) {
      const seed = this.toPriceMap(previousRecord);
      if (Object.keys(seed).length > 0) {
        entries.push({ t: previousRecord.lastUpdated, s: previousRecord.lastUpdated, p: seed, a: null, ...(name && { n: name }) });
      }
    }

    const last = entries[entries.length - 1];
    const sameAvailability = !last || last.a === null || availability === null || last.a === availability;
    // Starší historie ještě bez názvu – první zjištěný název připsat k poslednímu záznamu (bez nového řádku)
    if (name && last && this.getLatestName(entries) === null) last.n = name;
    const nameChanged = Boolean(name) && name !== this.getLatestName(entries);

    if (last && sameAvailability && !nameChanged && this.isSamePriceMap(last.p, snapshot)) {
      last.s = now;
      last.a ??= availability;
    } else {
      entries.push({ t: now, s: now, p: snapshot, a: availability, ...(nameChanged && { n: name }) });
      this.trimHistory(entries);
    }

    return entries;
  },

  // === Ceny z výpisů (kategorie, vyhledávání) ===
  // Box produktu ve výpisu má stejný cenový box jako detail (ads-pb), jen místo řádků akcí (promo-action-prices)
  // ukazuje kupóny (coupon-block). Typy cen se určují stejně jako v extractPricesFromDocument, ať se historie
  // z výpisu a z detailu nestřídá

  // Cenový box produktu ve výpisu (browsing.js, category.js) – starý (price-box) i nový (ads-pb) vzhled Alzy
  listingSelectors: {
    box: ".ads-pb, .price-box, .js-price-box",
    primaryPrice: ".js-price-box__primary-price__value, .ads-pb__price-value, .price-box__primary-price",
    comparePrice: ".js-compare-price, .ads-pb__original-price--strike, .price-box__compare-price", // přeškrtnutá cena
    priceHeader: ".ads-pb__header, .price-box__header, .price-box__header-text", // "BLACK FRIDAY -10 %", "-14 % S ALZAPLUS+"
    coupon: ".coupon-block", // AlzaPlus+, slevový kód, výkup… pod názvem produktu
    couponPrice: ".coupon-block__price",
  },

  // Druh cenového boxu (detail i výpis): Black Friday, nebo běžný box bez akce (hlavní cena = původní cena)
  classifyPriceBox(box) {
    const classes = box?.classList;
    if (!classes) return { isBlackFriday: false, isNormal: false };
    const isBlackFriday = classes.contains("price-box--black-friday") || classes.contains("ads-pb--black-friday");
    const isNormal =
      classes.contains("price-box--normal") || !["ads-pb--discount", "ads-pb--benefit", "price-box--black-friday", "ads-pb--black-friday"].some((name) => classes.contains(name));
    return { isBlackFriday, isNormal };
  },

  listingCouponTypes: { scrappage: "scrappage", applus: "applus", discountcode: "discount", discountcouponpaywall: "discount" },
  listingMainTypes: ["original", "special", "blackfriday", "benefit", "b2b"], // Z cenového boxu – výpis je ukazuje vždy

  extractPricesFromListingItem(item) {
    const priceOf = (element) => {
      const price = element ? this.parsePrice(element.textContent) : NaN;
      return price > 0 ? price : null;
    };
    const selectors = this.listingSelectors;
    const primary = priceOf(item.querySelector(selectors.primaryPrice));
    const original = priceOf(item.querySelector(selectors.comparePrice));
    const header = this.getSpecialPriceText(item.querySelector(selectors.priceHeader)).trim();
    const { isBlackFriday, isNormal: isNormalBox } = this.classifyPriceBox(item.querySelector(selectors.box));

    let main = {};
    if (isBlackFriday) main = { blackfriday: primary };
    else if (header) main = this.processSpecialPrice(primary, header, null, null);
    else if (isNormalBox && primary !== null && !original) main = { original: primary };

    const coupons = {};
    item.querySelectorAll(selectors.coupon).forEach((coupon) => {
      const name = [...coupon.classList].find((className) => className.startsWith("coupon-block--"))?.slice("coupon-block--".length);
      const type = this.listingCouponTypes[name];
      const price = priceOf(coupon.querySelector(selectors.couponPrice));
      if (type && price !== null) coupons[type] = price;
    });

    return this.cleanPriceObject({ original, ...main, ...coupons });
  },

  // Jsou ceny výpisu s DPH? Patička boxu ukazuje druhou cenu ("bez DPH 22 306,-" = hlavní je s DPH).
  // true / false / null = nejde poznat (bez patičky). Stačí jediný box bez DPH → false
  getListingVatState(root) {
    let state = null;
    for (const footer of root.querySelectorAll(".ads-pb__footer, .js-secondary-price")) {
      const text = footer.textContent.replace(/\s+/g, " ").trim().toLowerCase();
      if (this.vatTextPatterns.mainWithoutVat.test(text)) return false;
      if (this.vatTextPatterns.mainWithVat.test(text)) state = true;
    }
    return state;
  },

  // Stránka bez znaku DPH (homepage – patičky boxů prázdné): ceny s DPH, když se aspoň jeden produkt shoduje
  // s nedávno uloženou cenou (ta je vždy s DPH); bez DPH, když aspoň jeden vychází na uloženou cenu po
  // odečtení základní sazby. Jediný náznak cen bez DPH rozhoduje – raději neuložit nic.
  // pairs = [{ prices: { typ: cena } z boxu, entries: historie produktu }]; true / false / null = nejde poznat
  getVatFromKnownPrices(pairs, domainKey, now = Date.now()) {
    const rate = 1 + (this.domains[domainKey]?.vatRate || 0) / 100;
    if (rate === 1) return null;
    let withVat = 0;
    let withoutVat = 0;
    pairs.forEach(({ prices, entries }) => {
      const last = entries?.[entries.length - 1];
      if (!last || now - last.s > this.vatCompareMaxAgeDays * this.dayMs) return;
      const types = this.listingMainTypes.filter((type) => prices[type] !== undefined && last.p[type] !== undefined);
      if (types.length === 0) return;
      if (types.every((type) => prices[type] === last.p[type])) withVat++;
      else if (types.every((type) => Math.abs(prices[type] * rate - last.p[type]) <= Math.max(1, last.p[type] * 0.005))) withoutVat++;
    });
    if (withoutVat > 0) return false;
    return withVat > 0 ? true : null;
  },

  // Platné ověření DPH z jiné stránky (storageKeys.vatCheck) – true / false / null = žádné nebo staré
  getRecentVatCheck(vatChecks, domainKey, now = Date.now()) {
    const check = vatChecks?.[domainKey];
    return check && now - check.at <= this.vatCheckMaxAgeMs ? check.withVat : null;
  },

  // Zapíše výsledek ověření DPH (content script, služba na pozadí). Stejný výsledek nejvýš jednou za
  // vatCheckRefreshMs – kontrola na pozadí ověřuje u každého produktu
  // Zápis přes AlzaStore (operace recordVatCheck) – ověřují souběžně záložky i služba na pozadí
  async recordVatCheck(domainKey, withVat, now = Date.now()) {
    if (typeof withVat !== "boolean" || !this.isKnownDomain(domainKey)) return;
    await globalThis.AlzaStore.run({ type: "recordVatCheck", domain: domainKey, withVat, now });
  },

  // Nový stav ověření DPH, nebo null = beze změny (stejný výsledek mladší než vatCheckRefreshMs)
  nextVatChecks(checks, domainKey, withVat, now) {
    const previous = checks?.[domainKey];
    if (previous?.withVat === withVat && now - previous.at < this.vatCheckRefreshMs) return null;
    return { ...checks, [domainKey]: { withVat, at: now } };
  },

  // Pozorování z výpisu do historie (mění entries; vrací true, když se něco zapsalo). Výpis ukazuje jen část
  // cen detailu (bez cashbacku, ne vždy všechny kupóny), proto se srovnává jen to, co ukázal: ceny z boxu
  // (listingMainTypes) přesně, kupóny jen když je výpis ukazuje. Shoda → jen se posune poslední kontrola;
  // jinak nový záznam s cenami z výpisu. Název se zapíše jen produktu bez názvu (detail ho má přesnější)
  appendListingObservation(entries, prices, availability, { now = Date.now(), name = null } = {}) {
    const snapshot = this.toPriceMap(prices);
    if (Object.keys(snapshot).length === 0) return false;
    const last = entries[entries.length - 1];

    const sameMain = last && this.listingMainTypes.every((type) => last.p[type] === snapshot[type]);
    const sameCoupons = last && Object.entries(snapshot).every(([type, price]) => last.p[type] === price);
    const sameAvailability = !last || last.a === null || availability === null || last.a === availability;
    if (last && sameMain && sameCoupons && sameAvailability) {
      last.s = Math.max(last.s, now);
      last.a ??= availability;
      if (name && this.getLatestName(entries) === null) last.n = name;
      return true;
    }

    const withName = name && this.getLatestName(entries) === null ? { n: name } : {};
    entries.push({ t: now, s: now, p: snapshot, a: availability ?? last?.a ?? null, ...withName });
    this.trimHistory(entries);
    return true;
  },

  // Nejvýš historyMaxEntries nejnovějších záznamů (mění entries). Zahozením nejstarších se nesmí ztratit
  // platný název – záznam s ním mohl být jediný
  trimHistory(entries) {
    if (entries.length <= this.historyMaxEntries) return entries;
    const latestName = this.getLatestName(entries);
    entries.splice(0, entries.length - this.historyMaxEntries);
    if (latestName && !this.getLatestName(entries)) entries[0] = { ...entries[0], n: latestName };
    return entries;
  },

  // Dvě historie téhož produktu dohromady (import zálohy) podle času zjištění, ať import starší zálohy nesmaže
  // novější záznamy. Stejný čas = stejný záznam, ponechá se ten s pozdější kontrolou. Vrací novou historii
  mergeHistories(existing, imported) {
    const byTime = new Map();
    [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(imported) ? imported : [])].forEach((entry) => {
      const current = byTime.get(entry.t);
      if (!current || entry.s > current.s) byTime.set(entry.t, entry);
    });
    return this.trimHistory([...byTime.values()].sort((a, b) => a.t - b.t));
  },

  // Cena za jednotku z výpisu Alzy: "3,50 Kč/ks" → { value: 3.5, decimals: 2, suffix: "Kč/ks", unit: "ks" };
  // null = neznámý formát
  parseUnitPrice(text) {
    const match = String(text || "").replace(/\s+/g, " ").trim().match(/^(\d[\d ]*(?:[.,]\d+)?)\s*(\S*\s?\/\s*(\S.*))$/);
    if (!match) return null;
    const value = parseFloat(match[1].replace(/ /g, "").replace(",", "."));
    if (!(value > 0)) return null;
    return { value, decimals: (match[1].split(/[.,]/)[1] || "").length, suffix: match[2], unit: match[3].trim().toLowerCase() };
  },

  // Počet kusů v balení z popisku nebo názvu ("360 ks v balení", "(200 ks)", "70 kusů v balení").
  // Ověří se proti Alzině ceně za kus: počet × cena za kus musí vyjít mezi minPrice a maxPrice (Alza ji
  // počítá z ceny pro všechny – zaokrouhlenou na desetinná místa ceny za kus). null = nic nesedí
  getPackCount(texts, unitPrice, minPrice, maxPrice) {
    const step = 0.5 * 10 ** -unitPrice.decimals;
    const pattern = /(\d+(?:[  ]\d{3})*)\s*(?:ks|kusů|kusy|kus|db)(?!\p{L})/giu;
    for (const text of texts) {
      for (const match of String(text || "").matchAll(pattern)) {
        // "vel. 4 152 ks" – mezera může být oddělovač tisíců i konec předchozího čísla, zkusit obojí
        const groups = match[1].split(/\D/);
        for (const candidate of new Set([groups.join(""), groups.at(-1)])) {
          const count = parseInt(candidate, 10);
          if (!(count > 0)) continue;
          const total = count * unitPrice.value;
          const tolerance = count * step + 1; // zaokrouhlení ceny za kus + celé koruny u ceny
          if (total >= minPrice - tolerance && total <= maxPrice + tolerance) return count;
        }
      }
    }
    return null;
  },

  // Cena v hlavním cenovém boxu detailu (ta, ke které Alza vztahuje rozdíly cen ve výběru velikosti); null = není
  getDocumentMainPrice(doc) {
    const box = doc.querySelector(".js-price-detail__main-price-box-wrapper");
    const element = box?.querySelector(".price-box__primary-price, .js-price-box__primary-price__value, .ads-pb__price-value");
    const price = element ? this.parsePrice(element.textContent) : NaN;
    return price > 0 ? price : null;
  },

  // Velikost balení z popisku varianty: "150 ks" → { amount: 150, unit: "ks" }, "500 g" → { amount: 0.5, unit: "kg" },
  // "1,5 l" → { amount: 1.5, unit: "l" }, "50 cm" → { amount: 0.5, unit: "m" }; množství může být i za názvem
  // ("Sparkle 120 ks") a s násobkem ("2× 60 ks" → 120 ks); null = není množství (barva…)
  parseVariantSize(text) {
    const match = String(text || "")
      .trim()
      .match(/(?:^|[^\p{L}\d.,])(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(ks|db|kg|g|ml|l|mm|cm|m)(?![\p{L}\d²])/iu);
    if (!match) return null;
    const amount = parseFloat(match[2].replace(",", ".")) * (match[1] ? parseInt(match[1], 10) : 1);
    const unit = match[3].toLowerCase();
    if (!(amount > 0)) return null;
    if (unit === "g") return { amount: amount / 1000, unit: "kg" };
    if (unit === "ml") return { amount: amount / 1000, unit: "l" };
    if (unit === "cm") return { amount: amount / 100, unit: "m" };
    if (unit === "mm") return { amount: amount / 1000, unit: "m" };
    return { amount, unit: unit === "db" ? "ks" : unit };
  },

  // Rozdíl ceny ve výběru varianty: "+ 105,-" → 105, "- 72,-" → -72 (znaménko jen na začátku – „,-“ je konec ceny)
  parsePriceDifference(text) {
    const value = this.parsePrice(String(text || ""));
    if (!Number.isFinite(value)) return 0;
    return /^\s*[-−]/.test(text) ? -value : value;
  },

  // Stejný produkt v jiném stavu – přepínač Nový / Rozbalený / Zánovní na detailu (každý stav je samostatný produkt).
  // { current, prices: { new, unpacked, used } } – ceny jednotlivých stavů z přepínače (bez členských slev, srovnávat
  // jen mezi sebou); null = přepínač není nebo nejde poznat aktuální stav
  conditionPatterns: {
    new: /^(nov|új|new)/i,
    unpacked: /^(rozbal|kibont|bontott|unpack|open)/i,
    used: /^(zánov|újszerű|használt|like new|used)/i,
  },

  getDocumentConditions(doc, url = "") {
    // Živá stránka má data-testid, HTML ze serveru (stahování seznamu) jen třídy
    const buttons = [...doc.querySelectorAll('[data-testid="component-detailVariants"] button, .component.detailVariants button')]
      .map((button) => {
        const label = button.querySelector("div[aria-label]");
        const text = label?.firstChild?.textContent.trim() || "";
        const condition = Object.keys(this.conditionPatterns).find((key) => this.conditionPatterns[key].test(text));
        const price = this.parsePrice(label?.nextElementSibling?.textContent || "");
        return condition && price > 0 ? { button, condition, price } : null;
      })
      .filter(Boolean);
    if (buttons.length < 2) return null;

    // Zvolený stav má jednu třídu navíc (název třídy je generovaný); záloha podle adresy (-levne- / -sleva-)
    const classCounts = buttons.map(({ button }) => button.classList.length);
    const most = Math.max(...classCounts);
    const marked = classCounts.filter((count) => count === most).length === 1 ? buttons[classCounts.indexOf(most)] : null;
    const fromUrl = /-levne-d\d+\.htm/i.test(url) ? "unpacked" : /-sleva-d\d+\.htm/i.test(url) ? "used" : null;
    const current = marked?.condition || fromUrl || (buttons.some(({ condition }) => condition === "new") ? "new" : null);
    if (!current) return null;

    const prices = {};
    buttons.forEach(({ condition, price }) => (prices[condition] = price));
    return prices[current] ? { current, prices } : null;
  },

  // Levnější stavy proti aktuálnímu: [{ condition, price, diff, percent }] od nejlevnějšího; prázdné = žádný.
  // ownPrice = nejnižší cena, kterou za tento produkt zaplatíte (i s AlzaPlus+, benefitem, kódem) – nový kus
  // s ní bývá levnější než rozbalený nebo zánovní; bez ní se srovná cena z přepínače
  getCheaperConditions(conditions, ownPrice = null) {
    if (!conditions?.prices) return [];
    const own = ownPrice > 0 ? ownPrice : conditions.prices[conditions.current];
    if (!(own > 0)) return [];
    return Object.entries(conditions.prices)
      .filter(([condition, price]) => condition !== conditions.current && price < own)
      .map(([condition, price]) => ({ condition, price, diff: own - price, percent: Math.round(((own - price) / own) * 100) }))
      .sort((a, b) => a.price - b.price);
  },

  // Množstevní slevy „Kup víc, zaplať míň“ ze stránky produktu: [[od, do, cena za kus], …] vzestupně, poslední
  // stupeň má „do“ 100000 (= a více). Tabulka je ve stránce i bez rozkliknutí. null = produkt je nemá
  getDocumentQuantityTiers(doc) {
    const tiers = [...doc.querySelectorAll(".quantityRepeater .row[data-cntfrom]")]
      .map((row) => [parseInt(row.dataset.cntfrom, 10), parseInt(row.dataset.cntto, 10), this.parsePrice(row.querySelector(".colValue")?.textContent || "")])
      .sort((a, b) => a[0] - b[0]);
    return this.getQuantityTiers({ quantityTiers: tiers });
  },

  // Počet kusů v balení ze stránky produktu: parametr "Počet kusů: 360 ks", jinak popis "360 ks v balení -
  // 3,50 Kč/1 ks" ověřený cenami. null = produkt se neprodává po kusech (nebo to nepoznáme)
  getDocumentPackCount(doc, prices) {
    for (const label of doc.querySelectorAll(".typeName")) {
      if (!/počet\s+kus|darabszám/i.test(label.textContent)) continue;
      const value = label.parentElement?.nextElementSibling?.textContent.replace(/\s+/g, " ").trim() || "";
      const match = value.match(/^(\d[\d ]*)\s*(?:ks|db)$/i);
      const count = match ? parseInt(match[1].replace(/\D/g, ""), 10) : NaN;
      if (count > 0) return count;
    }

    const description = doc.querySelector(".nameextc")?.textContent.replace(/\s+/g, " ") || "";
    const unitMatch = description.match(/(\d+(?:[.,]\d+)?)\s*(\S+)\/\s*1?\s*(ks|db)(?!\p{L})/u);
    const unitPrice = unitMatch && this.parseUnitPrice(`${unitMatch[1]} ${unitMatch[2]}/${unitMatch[3]}`);
    const values = this.getPriceEntries(prices || {}).map(({ price }) => price);
    if (!unitPrice || values.length === 0) return null;
    return this.getPackCount([description], unitPrice, Math.min(...values), Math.max(...values));
  },
};

globalThis.AlzaCore = AlzaCore;
AlzaCore.installErrorLog();
