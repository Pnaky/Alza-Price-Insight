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
  // Stránka „Moje objednávky“ (stejná cesta na alza.cz, .sk i .hu) – odkaz u koupeného zboží v přehledu změn
  ordersPath: "/my-account/orders.htm",
  purchaseReturnDays: 14, // Hlídání po nákupu: zákonná lhůta pro vrácení zboží koupeného na internetu (od objednávky – opatrně)
  purchaseSyncHours: 6, // Objednávky se načítají celé nejvýš jednou za tuto dobu
  purchaseProbeMinutes: 10, // Mezitím jen seznam aktivních objednávek – nová objednávka se načte hned (purchases.js)
  // Trezor kódů a přehled cashbacků (mergePrices): jen posun seenAt se zapisuje nejvýš jednou za tuto dobu
  registrySeenRefreshMs: 60 * 60 * 1000,
  codeSeenDays: 30, // Kód v trezoru, který jsme tak dlouho neviděli, se maže (nejspíš už neplatí)
  // Připomínka cashbacku: cashback viděný na detailu (storageKeys.cashbacks) se k nákupu přiřadí, když platil kolem
  // data nákupu – naposledy viděný nejvýš cashbackMatchDays před nákupem, poprvé nejpozději cashbackLateDays po něm
  cashbackMatchDays: 7,
  cashbackLateDays: 2,
  cashbackSeenDays: 60, // Starší záznamy o cashbacku z detailu se mažou
  cashbackSoonDays: 7, // Druhé upozornění tolik dní před koncem registrace
  cashbackKeepDays: 120, // Připomínka bez známé lhůty registrace se po této době od nákupu smaže
  cashbackTermsTries: 3, // Pokusy o načtení podmínek akce (lhůty registrace)
  cashbackTermsMaxAgeMs: 24 * 60 * 60 * 1000, // Termíny akce (storageKeys.cashbackTerms) se načtou znovu nejvýš jednou denně
  cashbackTermsRetryMs: 60 * 60 * 1000, // … po nepovedeném načtení za hodinu
  cashbackTermsKeepDays: 30, // Nepoužívané termíny akcí se mažou
  cashbackTermsVersion: 4, // Verze čtení termínů (readCashbackTerms) – po změně se uložené termíny načtou znovu
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
    cleanups: "alzaCleanups", // Jednorázové opravy uložených dat, které už proběhly: { "<název>": čas }
    watchLists: "alzaWatchLists",
    targets: "alzaTargets", // { "<doména>_<id>": { price, below, url, domain, name, image, since, unit?, packCount? } }
    watchProducts: "alzaWatchProducts", // Hlídané produkty mimo seznamy: { "<doména>_<id>": { url, domain, name, image, since } }
    settings: "alzaSettings",
    watchState: "alzaWatchState", // Stav posledního běhu kontroly na pozadí (popup, číslo na ikoně)
    watchLog: "alzaWatchLog", // Log běhů kontroly
    errorLog: "alzaErrorLog", // Chyby ze všech částí rozšíření – pro diagnostiku (Nastavení → Obecné → Diagnostika)
    cleanup: "alzaCleanup", // Návrh čistky pro modré číslo na ikoně a popup: { count, at, snoozedUntil }
    // Produkty uložené při procházení (výpisy kategorií a vyhledávání, detail): { "<doména>_<id>": { url, domain, name, image, seenAt } }
    // – adresa a název pro přehled uložených dat, delší lhůta čistky
    browsed: "alzaBrowsed",
    // Trezor slevových kódů (popup): { "<doména>_<id>": { code, price, url, domain, since, seenAt } } – z každého uložení
    // záznamu ceny se slevovým kódem (AlzaStore.mergePrices, AlzaCore.updateCodeRegistry)
    codes: "alzaCodes",
    // Hlídání po nákupu: koupené zboží z „Moje objednávky“ ve lhůtě pro vrácení (purchases.js → kontrola na pozadí):
    // { "<doména>_<id>": { url, domain, name, image, price, count, boughtAt, returnUntil, notifiedPrice? } }
    purchases: "alzaPurchases",
    purchasesSync: "alzaPurchasesSync", // Načtení objednávek: { "<doména>": čas, "<doména>:probe": čas kontroly, "<doména>:mark": otisk }
    // Cashback viděný na detailu produktu (AlzaStore.mergePrices, AlzaCore.updateCashbackRegistry):
    // { "<doména>_<id>": { terms, title, price, refund, domain, since, seenAt } } – terms = stránka akce na Alze
    cashbacks: "alzaCashbacks",
    // Připomínky registrace cashbacku u koupeného zboží (background.js updateCashbackReminders, popup):
    // { "<doména>_<id>": { url, domain, name, image, terms, title, refund, boughtAt, registerFrom, registerUntil,
    //   termsRead, termsTries, notifiedOpen, notifiedSoon, done } }
    cashbackReminders: "alzaCashbackReminders",
    // Termíny akcí s cashbackem ze stránek akcí (background.js getCashbackTerms – tooltip cashbacku, detail,
    // připomínky): { "<adresa akce>|<název akce>": { ok, fetchedAt, purchaseEnds, registerEnds, registerDays, waitDays } }
    cashbackTerms: "alzaCashbackTerms",
    // Poslední ověření, jestli jsou ceny s DPH (výpis, detail, kontrola na pozadí): { "<doména>": { withVat, at } }
    // – stránka bez znaku DPH (homepage) ho převezme, když ceny nemá s čím porovnat
    vatCheck: "alzaVatCheck",
    // Moje nákupy – všechno koupené z archivu objednávek (volba ownedItems; AlzaOwned v shared/orders.js):
    // { "<doména>_<id>": { url, domain, name, image, brand, cat: [..], buys: [{ t, n, o, p?, claim?, ret?, rma?, biz?, w?, at?, dv?, notified? }] } }
    // – buys = nákupy (t čas objednávky, n kusů, o číslo objednávky; z detailu objednávky p cena kusu, claim lze
    // reklamovat, ret vráceno, rma reklamováno, biz firemní nákup, at čas načtení detailu, dv verze čtení; w = měsíce záruky
    // z detailu produktu – getDocumentWarranty; notified = připomínka konce záruky odeslána)
    owned: "alzaOwned",
    ownedOrders: "alzaOwnedOrders", // Objednávky s koupeným zbožím: { "<doména>": { "<číslo>": [čas, částka] } } – přehled výdajů
    // Načítání archivu: { "<doména>": { at (poslední načtení), offset (kam došlo první načtení), done (archiv načten celý), total,
    // fails: { "<číslo objednávky>": počet nepovedených načtení detailu } } }
    ownedSync: "alzaOwnedSync",
    // Novinky po aktualizaci (průvodce #news, popup): { seen: "<verze>" } – nejnovější vydání, jehož novinky uživatel viděl
    news: "alzaNews",
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
    quietHours: false, // V tichých hodinách se notifikace odloží a odejdou po jejich konci (alarm alzaQuietEnd)
    quietFrom: "22:00",
    quietTo: "07:00",
    checkSchedule: "1h", // Jak často kontrolovat na pozadí: 1h / 3h / 6h / 12h / daily (jednou denně v checkTime)
    checkTime: "08:00",
    categoryUnitPrice: true, // Skutečná cena za jednotku a řazení podle ní ve výpisech kategorií (category.js)
    categoryDiscountFilter: true, // Filtr „Sleva aspoň X %“ / „Jen s kupónem“ v liště výpisů kategorií (category.js)
    // Cena provozu lednic, praček a sušiček ve výpisech (category.js): spotřeba z popisku × cena elektřiny × roky
    energyCost: true,
    energyPriceCZK: 6, // Cena elektřiny za kWh včetně distribuce – orientační výchozí hodnoty, uživatel zadá svou
    energyPriceEUR: 0.2,
    energyPriceHUF: 70,
    energyYears: 10, // Na kolik let provozu se počítá
    energyCyclesPerWeek: 4, // Praní / sušení týdně (spotřeba praček a sušiček je na 100 cyklů)
    energyHoursPerDay: 4, // Hodin denně u televizí a monitorů (spotřeba je na 1000 hodin; jen detail produktu)
    watchPurchases: true, // Hlídání po nákupu – načítání „Moje objednávky“ (purchases.js) a upozornění na zlevnění ve lhůtě pro vrácení
    remindCashback: true, // Připomínka registrace cashbacku u koupeného zboží (potřebuje watchPurchases – objednávky)
    ownedItems: false, // Moje nákupy: načíst z archivu objednávek všechno koupené (záložka v nastavení, štítek na detailu) – zapíná uživatel
    remindWarranty: true, // Připomenout konec záruky u dražšího zboží (potřebuje ownedItems)
    saveBrowsing: true, // Ukládat ceny produktů viděných při procházení – výpisy (browsing.js) i detail
    uiLanguage: "auto", // Jazyk popupu a nápovědy: auto = podle prohlížeče, jinak cs / sk / hu / en
    primaryDomain: "auto", // Hlavní Alza (průvodce – ověření přihlášení a DPH, odkazy): auto = podle jazyka, jinak alza_cz / alza_sk / alza_hu
  },

  // Novinky pro uživatele po vydáních, nejnovější první. version = verze vydání v obchodech (při vydání přepsat na
  // skutečnou – docs/vydani.md), settings = nové volby: průvodce (#news) je ukáže zeleně a po aktualizaci se sám
  // otevře jen u vydání s novou volbou; jinak jen značka Novinky v popupu. Odrážky jsou v RELEASE_NEWS
  // (src/welcome/welcome-texts.js); úplnost hlídá tests/welcome.test.js
  releases: [{ version: "2026.11.12", settings: ["ownedItems", "remindWarranty", "energyCost"] }],

  // Porovnání verzí "RRRR.M.D(.N)" po číslech: záporné = a je starší. Chybějící část je 0 (2026.11.12 < 2026.11.12.1)
  compareVersions(a, b) {
    const parts = (version) => String(version || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
    const [left, right] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const difference = (left[i] || 0) - (right[i] || 0);
      if (difference) return difference;
    }
    return 0;
  },

  // Vydání novější než since a ne novější než nainstalovaná verze (since chybí = žádná)
  getReleaseNews(since, current) {
    if (!since) return [];
    return this.releases.filter(({ version }) => this.compareVersions(version, since) > 0 && this.compareVersions(version, current) <= 0);
  },

  // Klíče záznamu ceny, které nejsou cenou
  // packCount = počet kusů v balení z detailu produktu (cena za kus v seznamu)
  // quantityTiers = množstevní slevy [[od, do, cena za kus], …] z detailu produktu (součet v seznamu)
  metaKeys: ["lastUpdated", "listId", "minPrice", "maxPrice", "maxLowestPrice", "oldLowestPrice", "newLowestPrice", "noPrice", "url", "packCount", "quantityTiers", "conditions", "warranty"],
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

  // Srovnávače cen pro odkazy na detailu produktu ({q} = název produktu) – odkaz do nové záložky.
  // Ikona = favicona načítaná živě z webu srovnávače (loga se do rozšíření nebalí); když se nenačte, ukáže se název
  comparators: {
    alza_cz: [
      {
        id: "heureka",
        name: "Heureka.cz",
        url: "https://www.heureka.cz/?h%5Bfraze%5D={q}",
        icon: "https://cdn.heureka.group/fe/hasty-images/latest/brand/heureka-cz/icons/favicon-32x32.png",
      },
      { id: "zbozi", name: "Zboží.cz", url: "https://www.zbozi.cz/hledej/?q={q}", icon: "https://www.zbozi.cz/img/favicon/apple-touch-icon-57x57.png" },
    ],
    alza_sk: [
      {
        id: "heureka",
        name: "Heureka.sk",
        url: "https://www.heureka.sk/?h%5Bfraze%5D={q}",
        icon: "https://cdn.heureka.group/fe/hasty-images/latest/brand/heureka-sk/icons/favicon-32x32.png",
      },
    ],
    alza_hu: [{ id: "arukereso", name: "Árukereső", url: "https://www.arukereso.hu/CategorySearch.php?st={q}", icon: "https://static.arukereso.hu/hu/favicon/favicon-32x32.png" }],
  },

  // Štítek na horní hraně lišt nad nákupním seznamem a výpisem kategorie (logo + „Price Insight“) – lišta vypadá jako
  // box Alzy, ale je jasné, že je z rozšíření. Logo je v css/main.css (data URI, bez web_accessible_resources)
  createToolbarLogo(doc) {
    const logo = doc.createElement("span");
    logo.className = "alza-price-tracker-toolbar-logo";
    logo.title = "Alza Price Insight";
    logo.textContent = "Price Insight";
    return logo;
  },

  getComparatorLinks(domainKey, productName) {
    const query = productName?.replace(/\s+/g, " ").trim();
    if (!query) return [];
    return (this.comparators[domainKey] || []).map(({ url, ...comparator }) => ({ ...comparator, url: url.replace("{q}", encodeURIComponent(query)) }));
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
      notifyNewCode: "Nový slevový kód {0}: {1}",
      notifyPurchaseDrop: "Koupili jste za {0}, teď stojí {1}. Do {2} ho můžete vrátit a koupit znovu.",
      purchaseOrdersLink: "Objednávky", // Odkaz u změny koupeného zboží (popup) – stránka Moje objednávky
      notifyCashbackOpen: "Cashback až {0}: nákup zaregistrujte u výrobce do {1}. Kliknutím otevřete podmínky akce.",
      notifyCashbackOpenNoAmount: "Cashback: nákup zaregistrujte u výrobce do {0}. Kliknutím otevřete podmínky akce.",
      notifyCashbackOpenNoDate: "Cashback až {0}: nezapomeňte nákup zaregistrovat u výrobce – lhůtu najdete v podmínkách akce (po kliknutí).",
      notifyCashbackSoon: "Registrace cashbacku až {0} končí {1} – máte nákup zaregistrovaný?",
      notifyWarrantyEnding: "Záruka končí kolem {0} (koupeno {1}). Vyzkoušejte, jestli vše funguje, dokud jde zboží reklamovat.",
      notifyAvailability: "{0} → {1}",
      notifyTargetReached: "Cílová cena {0} – nyní {1}",
      suspiciousGap: "{0} {1} je pod polovinou další ceny {2} – možná chyba načtení, ověřte na Alze",
      suspiciousJump: "{0} {1} je pod polovinou obvyklé ceny {2} – možná chyba načtení, ověřte na Alze",
      notifySummaryTitle: "Změny na Alze: {0}",
      notifyProblemTitle: "Hlídání cen: kontrola selhala ({0})",
      notifyProblemNoData: "Na stránce nebyla nalezena cena ani dostupnost – Alza možná změnila web",
      notifyProblemNoAvailability: "Nenalezena dostupnost – Alza možná změnila web",
      notifyProblemNotProduct: "Stránka nevypadá jako detail produktu (přihlášení, captcha?)",
      notifyProblemFetch: "Stránku se nepodařilo načíst ({0})",
      // Důvody selhání načtení (localizeError) – do logu běhu a do závorky notifyProblemFetch
      errorOffsite: "adresa mimo Alzu",
      errorRedirected: "přesměrováno mimo Alzu",
      errorNotJson: "odpověď není JSON (nepřihlášen?)",
      errorUnexpected: "neočekávaná odpověď",
      errorOrders: "objednávky se nepodařilo načíst",
      errorArchive: "archiv objednávek má neznámý tvar",
      errorTimeout: "vypršel čas",
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
      notifyNewCode: "Nový zľavový kód {0}: {1}",
      notifyPurchaseDrop: "Kúpili ste za {0}, teraz stojí {1}. Do {2} ho môžete vrátiť a kúpiť znova.",
      purchaseOrdersLink: "Objednávky", // Odkaz u změny koupeného zboží (popup) – stránka Moje objednávky
      notifyCashbackOpen: "Cashback až {0}: nákup zaregistrujte u výrobcu do {1}. Kliknutím otvoríte podmienky akcie.",
      notifyCashbackOpenNoAmount: "Cashback: nákup zaregistrujte u výrobcu do {0}. Kliknutím otvoríte podmienky akcie.",
      notifyCashbackOpenNoDate: "Cashback až {0}: nezabudnite nákup zaregistrovať u výrobcu – lehotu nájdete v podmienkach akcie (po kliknutí).",
      notifyCashbackSoon: "Registrácia cashbacku až {0} končí {1} – máte nákup zaregistrovaný?",
      notifyWarrantyEnding: "Záruka končí okolo {0} (kúpené {1}). Vyskúšajte, či všetko funguje, kým sa dá tovar reklamovať.",
      notifyAvailability: "{0} → {1}",
      notifyTargetReached: "Cieľová cena {0} – teraz {1}",
      suspiciousGap: "{0} {1} je pod polovicou ďalšej ceny {2} – možno chyba načítania, overte na Alze",
      suspiciousJump: "{0} {1} je pod polovicou obvyklej ceny {2} – možno chyba načítania, overte na Alze",
      notifySummaryTitle: "Zmeny na Alze: {0}",
      notifyProblemTitle: "Sledovanie cien: kontrola zlyhala ({0})",
      notifyProblemNoData: "Na stránke sa nenašla cena ani dostupnosť – Alza možno zmenila web",
      notifyProblemNoAvailability: "Nenájdená dostupnosť – Alza možno zmenila web",
      notifyProblemNotProduct: "Stránka nevyzerá ako detail produktu (prihlásenie, captcha?)",
      notifyProblemFetch: "Stránku sa nepodarilo načítať ({0})",
      errorOffsite: "adresa mimo Alzy",
      errorRedirected: "presmerované mimo Alzy",
      errorNotJson: "odpoveď nie je JSON (neprihlásený?)",
      errorUnexpected: "neočakávaná odpoveď",
      errorOrders: "objednávky sa nepodarilo načítať",
      errorArchive: "archív objednávok má neznámy tvar",
      errorTimeout: "vypršal čas",
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
      notifyNewCode: "Új kuponkód: {0} – {1}",
      notifyPurchaseDrop: "{0}-ért vásárolta, most {1}. {2}-ig visszaküldheti és újra megveheti.",
      purchaseOrdersLink: "Rendelések", // Odkaz u změny koupeného zboží (popup) – stránka Moje objednávky
      notifyCashbackOpen: "Akár {0} cashback: regisztrálja a vásárlást a gyártónál, határidő: {1}. Kattintson az akció feltételeiért.",
      notifyCashbackOpenNoAmount: "Cashback: regisztrálja a vásárlást a gyártónál, határidő: {0}. Kattintson az akció feltételeiért.",
      notifyCashbackOpenNoDate: "Akár {0} cashback: ne felejtse el regisztrálni a vásárlást a gyártónál – a határidő az akció feltételeiben van (kattintásra).",
      notifyCashbackSoon: "Akár {0} cashback: a regisztráció határideje {1} – regisztrálta már a vásárlást?",
      notifyWarrantyEnding: "A jótállás {0} körül lejár (vásárlás: {1}). Próbálja ki, hogy minden működik-e, amíg még reklamálható.",
      notifyAvailability: "{0} → {1}",
      notifyTargetReached: "Célár {0} – most {1}",
      suspiciousGap: "{0} {1} a következő ár ({2}) felénél is kevesebb – lehet, hogy beolvasási hiba, ellenőrizze az Alzán",
      suspiciousJump: "{0} {1} a szokásos ár ({2}) felénél is kevesebb – lehet, hogy beolvasási hiba, ellenőrizze az Alzán",
      notifySummaryTitle: "Változások az Alzán: {0}",
      notifyProblemTitle: "Árfigyelés: sikertelen ellenőrzés ({0})",
      notifyProblemNoData: "Nem található ár és elérhetőség – az Alza talán megváltoztatta az oldalt",
      notifyProblemNoAvailability: "Nem található elérhetőség – az Alza talán megváltoztatta az oldalt",
      notifyProblemNotProduct: "Az oldal nem termékoldal (bejelentkezés, captcha?)",
      notifyProblemFetch: "Az oldal nem tölthető be ({0})",
      errorOffsite: "a cím nem az Alzán van",
      errorRedirected: "átirányítás az Alzán kívülre",
      errorNotJson: "a válasz nem JSON (nincs bejelentkezve?)",
      errorUnexpected: "váratlan válasz",
      errorOrders: "a rendeléseket nem sikerült betölteni",
      errorArchive: "a rendelések archívuma ismeretlen formátumú",
      errorTimeout: "időtúllépés",
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
      notifyNewCode: "New discount code {0}: {1}",
      notifyPurchaseDrop: "You bought it for {0}, now it costs {1}. You can return it and buy it again until {2}.",
      purchaseOrdersLink: "Orders", // Odkaz u změny koupeného zboží (popup) – stránka Moje objednávky
      notifyCashbackOpen: "Cashback up to {0}: register your purchase with the manufacturer by {1}. Click to open the promotion terms.",
      notifyCashbackOpenNoAmount: "Cashback: register your purchase with the manufacturer by {0}. Click to open the promotion terms.",
      notifyCashbackOpenNoDate: "Cashback up to {0}: don't forget to register your purchase with the manufacturer – the deadline is in the promotion terms (click).",
      notifyCashbackSoon: "Cashback up to {0}: registration ends {1} – have you registered your purchase?",
      notifyWarrantyEnding: "The warranty ends around {0} (bought {1}). Check that everything works while you can still make a claim.",
      notifyAvailability: "{0} → {1}",
      notifyTargetReached: "Target price {0} – now {1}",
      suspiciousGap: "{0} {1} is less than half of the next price {2} – possibly a reading error, check on Alza",
      suspiciousJump: "{0} {1} is less than half of the usual price {2} – possibly a reading error, check on Alza",
      notifySummaryTitle: "Changes on Alza: {0}",
      notifyProblemTitle: "Price watch: check failed ({0})",
      notifyProblemNoData: "No price or availability found on the page – Alza may have changed its website",
      notifyProblemNoAvailability: "Availability not found – Alza may have changed its website",
      notifyProblemNotProduct: "The page doesn't look like a product page (login, captcha?)",
      notifyProblemFetch: "The page could not be loaded ({0})",
      errorOffsite: "address outside Alza",
      errorRedirected: "redirected away from Alza",
      errorNotJson: "the response is not JSON (not signed in?)",
      errorUnexpected: "unexpected response",
      errorOrders: "orders could not be loaded",
      errorArchive: "the order archive has an unknown format",
      errorTimeout: "timed out",
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

  // Důvod selhání načtení v jazyce rozhraní. Kód (product-page.js, background.js, orders.js) ho hlásí česky –
  // do logu běhu a do slovenské / maďarské / anglické notifikace patří přeložený. Neznámý text (HTTP 403…) zůstane
  errorTextKeys: {
    "URL mimo Alzu": "errorOffsite",
    "přesměrováno mimo Alzu": "errorRedirected",
    "odpověď není JSON (nepřihlášen?)": "errorNotJson",
    "neočekávaná odpověď": "errorUnexpected",
    "objednávky se nepodařilo načíst": "errorOrders",
    "archiv objednávek má neznámý tvar": "errorArchive",
    timeout: "errorTimeout",
  },

  localizeError(lang, message) {
    const text = String(message ?? "");
    const key = this.errorTextKeys[text];
    return key ? this.translate(lang, key) : text;
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

  // Obsah hlídaného seznamu z API Alzy (getCommodityLists/{id} – stejný zdroj, ze kterého stránku seznamu vykresluje
  // React). previous = uložené položky { url: { name, image } }. Vrací { name, products, added, removed } (added /
  // removed = názvy), nebo null, když odpověď nesedí (chyba, jiný seznam, chybí položky) – pak zůstane uložený obsah.
  // Produkt, který už v seznamu byl, si nechá uloženou adresu (historie a cílové ceny se na ni váží)
  parseCommodityList(json, { domain, listId, products: previous = {} } = {}) {
    const origin = this.domains[domain]?.origin;
    if (!origin || !json || json.err !== 0 || !Array.isArray(json.data)) return null;
    const list = json.data.find((entry) => String(entry?.id) === String(listId));
    if (!list || !Array.isArray(list.items) || list.items.length !== list.itemCount) return null;

    const known = new Map(Object.keys(previous || {}).map((url) => [this.getProductKey(domain, url), url]));
    const products = {};
    const added = [];
    let unreadable = 0;
    for (const item of list.items) {
      const url = typeof item?.navigationUrl === "string" ? item.navigationUrl : null;
      if (!url || !this.isAlzaUrl(url) || new URL(url).origin !== origin || !this.getProductId(url)) {
        unreadable++;
        continue;
      }
      const key = this.getProductKey(domain, url);
      const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : previous?.[known.get(key)]?.name || url;
      const image = typeof item.img === "string" && /^https:\/\//.test(item.img) ? item.img : previous?.[known.get(key)]?.image || null;
      if (!known.has(key)) added.push(name);
      products[known.get(key) || url] = { name, image };
    }
    const current = new Set(Object.keys(products).map((url) => this.getProductKey(domain, url)));
    const removed = [...known].filter(([key]) => !current.has(key)).map(([, url]) => previous[url]?.name || url);
    // Položka, kterou neumíme přečíst (jiný tvar adresy po změně API), může být některá z „odebraných“ – nejde
    // to rozlišit, uložený obsah proto zůstane (jinak by se hlídané produkty přestaly kontrolovat)
    if (unreadable > 0 && removed.length > 0) return null;
    const name = typeof list.name === "string" && list.name.trim() ? list.name.trim() : null;
    return { name, products, added, removed };
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

  // Datum do textu v jazyce textu (ne podle domény): anglická notifikace na alza.cz „until 18/11.“, ne „18. 11..“
  textLocales: { cz: "cs-CZ", sk: "sk-SK", hu: "hu-HU", en: "en-GB" },
  formatTextDate(time, lang, withYear = false) {
    return new Date(time).toLocaleDateString(this.textLocales[lang] || "cs-CZ", { day: "numeric", month: "numeric", ...(withYear && { year: "numeric" }) });
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

  // Hlavní Alza: volba v nastavení (primaryDomain), jinak podle jazyka rozšíření (sk → alza.sk, hu → alza.hu, jinak alza.cz)
  getPrimaryDomain(settings = null) {
    if (Object.hasOwn(this.domains, settings?.primaryDomain)) return settings.primaryDomain;
    return { sk: "alza_sk", hu: "alza_hu" }[this.getUiLanguage(settings)] || "alza_cz";
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
  // Platný čas "HH:MM" (00:00–23:59) – nastavení, import, denní kontrola, tiché hodiny
  timePattern: /^([01]\d|2[0-3]):[0-5]\d$/,

  getDailyRunTimes(time, now = Date.now()) {
    const [hours, minutes] = (this.timePattern.test(time) ? time : this.defaultSettings.checkTime).split(":").map(Number);
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
      if (!this.timePattern.test(time)) return NaN;
      const [hours, minutes] = time.split(":").map(Number);
      return hours * 60 + minutes;
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
    const formatted = (Number(price) || 0).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
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
    // Stránky účtu jen jako „/my-account/“ – adresa detailu objednávky obsahuje její číslo
    if (!protocol.endsWith("-extension:")) return `${hostname}${pathname.replace(/^(\/my-account\/).*/i, "$1")}`; // chrome-extension: i moz-extension:
    return pathname.includes("_generated_background") ? "background" : pathname; // Firefox: stránka na pozadí
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
  // nejsou: když je React přepíše, reagovat se musí (obnova cen). Hledání nahoru končí na prvním prvku Alzy
  // s data-testid – naše třída na vzdálenějším předkovi Alzy (kontejner seznamu) celý podstrom za náš neudělá.
  // Na prvky Alzy bez data-testid (kontejner, <html>) dávat jen atributy data-alza-price-tracker-…, ne třídy
  isOwnMutation(record) {
    const isOwn = (node) => {
      const marked = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[class*="alza-price-tracker"], [data-testid]');
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

  // Pokles pod 1 % s desetinným místem, pod 0,1 % s jednou platnou číslicí – "-0 %" u malé slevy mate
  formatPercent(percent, domainKey) {
    const { locale } = this.domains[domainKey] || this.domains.alza_cz;
    const options = percent > 0 && percent < 0.1 ? { maximumSignificantDigits: 1 } : { maximumFractionDigits: percent < 1 ? 1 : 0 };
    return percent.toLocaleString(locale, options);
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

  // Ikona řádku změny: warning = výstraha k podezřelé ceně (suspiciousGap / suspiciousJump), target = dosažená cílová
  // cena (notifyTargetReached), jinak null. Pozná texty ve všech jazycích podle jejich šablon; starší uložené řádky
  // začínají emoji (⚠️ / 🎯) – ty se poznají podle něj (zobrazení ho odstraní přes stripChangeEmoji)
  getChangeIcon(text) {
    if (typeof text !== "string") return null;
    if (text.startsWith("⚠️")) return "warning";
    if (text.startsWith("🎯")) return "target";
    this.changeIconPatterns ??= Object.entries({ warning: ["suspiciousGap", "suspiciousJump"], target: ["notifyTargetReached"] }).flatMap(([icon, keys]) =>
      ["cz", "sk", "hu", "en"].flatMap((lang) =>
        keys.map((key) => {
          const parts = this.translate(lang, key, "\u0001", "\u0001", "\u0001").split("\u0001");
          return { icon, pattern: new RegExp(`^${parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+?")}$`) };
        })
      )
    );
    return this.changeIconPatterns.find(({ pattern }) => pattern.test(text))?.icon ?? null;
  },

  // Text řádku změny bez emoji na začátku (starší uložené řádky – ikonu teď přidá zobrazení)
  stripChangeEmoji(text) {
    return typeof text === "string" ? text.replace(/^(?:⚠️|🎯)\s*/u, "") : text;
  },

  // Druh řádku změny podle jeho textu (notifyPriceDrop / notifyPriceRise / notifyTargetReached / notifyNewPrice /
  // notifyNewCode / notifyPurchaseDrop / notifyAvailability) ve všech jazycích textů: down = zlevnění, nová cena,
  // nový kód, zlevnění po nákupu, cílová cena, naskladnění; up = zdražení; off = jiná změna dostupnosti
  // (nedostupné, prodej skončil…); warning = výstraha k podezřelé ceně; jinak null
  getChangeTone(text) {
    if (typeof text !== "string") return null;
    const langs = ["cz", "sk", "hu", "en"];
    if (this.getChangeIcon(text) === "warning") return "warning";
    // Nový kód a zlevnění po nákupu celým textem – „Nový slevový kód“ nezačíná jako „Nově“ (cz/sk), hu/en ano
    this.downLinePatterns ??= langs.flatMap((lang) =>
      ["notifyNewCode", "notifyPurchaseDrop"].map((key) => {
        const parts = this.translate(lang, key, "\u0001", "\u0001", "\u0001").split("\u0001");
        return new RegExp(`^${parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+?")}$`);
      })
    );
    if (this.downLinePatterns.some((pattern) => pattern.test(text))) return "down";
    if (/\(\+[^()]*%\)$/.test(text)) return "up";
    // Začátky textu „Nově …“ ve všech jazycích – spočítat jednou (volá se pro každý řádek přehledu i čísla na ikoně)
    this.newPricePrefixes ??= langs.map((lang) => this.translate(lang, "notifyNewPrice", "", "").split(" ")[0] + " ");
    if (/\(-[^()]*%\)$/.test(text) || this.getChangeIcon(text) === "target" || this.newPricePrefixes.some((prefix) => text.startsWith(prefix))) return "down";
    const availability = text.match(/ → (.+)$/);
    if (availability) return langs.some((lang) => this.getAvailabilityLabel("in", lang) === availability[1]) ? "down" : "off";
    return null;
  },

  // Barva čísla na ikoně pro nové změny (kaskáda): down = aspoň jedno zlevnění (zdražení ani ukončení neřeší),
  // up = aspoň jedno zdražení (ukončení neřeší), off = jen ukončení / nedostupnost. recent = přehled změn
  // ({ key, lines }), keys = nové (neviděné) produkty
  getBadgeTone(recent = [], keys = []) {
    const tones = new Set(
      (Array.isArray(recent) ? recent : []).filter((item) => item && keys.includes(item.key)).flatMap((item) => (item.lines || []).map((text) => this.getChangeTone(text)))
    );
    return ["down", "up", "off"].find((tone) => tones.has(tone)) || "down";
  },

  // === Parsování stránky produktu ===

  // Cena z textu Alzy ("29 490,-", "1 299,90 €") bez znaménka – rozdíl ceny se znaménkem: parsePriceDifference,
  // obecné číslo: toNumber. Desetinná je čárka (Alza tisíce odděluje mezerou)
  parsePrice(priceText) {
    return parseFloat(String(priceText).replace(/[^\d,.]/g, "").replace(",", "."));
  },

  // Cena z detailu produktu: prázdný nebo nečíselný text („Zdarma“) = žádná cena, ne NaN / 0 (jako ve výpisu)
  parsePositivePrice(priceText) {
    const price = this.parsePrice(priceText);
    return price > 0 ? price : null;
  },

  // Řádky „Koupit s kódem …“ pod cenou na detailu (data-type). discountcoupon = kód výrobce/akce
  // (OPPO Find X10: „Koupit s kódem OPPOX10256GB“), ostatní dva = slevové kódy Alzy
  discountPromoTypes: ["discountcode", "discountcoupon", "discountcouponpaywall"],

  findPromoPriceElement(doc, dataTypes) {
    // Pro každý typ hledat jeho vlastní row a price element
    const selector = dataTypes.map((type) => `.promo-action-prices__row[data-type="${type}"]`).join(",");
    const parent = doc.querySelector(selector);

    if (!parent) return { element: null, parent: null };

    const priceElement = parent.querySelector(".promo-action-prices__price");
    return { element: priceElement, parent };
  },

  // Slevový kód z řádku „Koupit s kódem …“: odkaz javascript:detailOrder(…, 'KOD'), jinak slovo za „kódem“
  // v textu řádku; null = nenalezen. Slovo z textu celé (ne „kedvezm“ z „kuponkóddal kedvezményesen“), ne číslo
  // ani cena („s kódem 1299,-“, „… 12 €“)
  getPromoCode(row) {
    if (!row) return null;
    const href = row.querySelector('a[href*="detailOrder"]')?.getAttribute("href") || "";
    const fromHref = href.match(/'([^']+)'\s*\)\s*;?\s*$/)?.[1];
    const textMatch = row.textContent
      .replace(/\s+/g, " ")
      .match(/(?:kódem|kódom|kóddal|code)\s+([A-Za-z0-9][A-Za-z0-9_-]{2,})(?![\p{L}\p{N}_-])(?!\s*(?:[,.]\d|,-|Kč|€|Ft(?!\p{L})|EUR|HUF|CZK))/iu)?.[1];
    const fromText = textMatch && !/^\d+$/.test(textMatch) ? textMatch : null;
    const code = (fromHref || fromText || "").trim();
    return /^[A-Za-z0-9_-]{3,40}$/.test(code) ? code : null;
  },

  // Řádek „Cena s CashBack“: odkaz na stránku akce (článek Alzy s podmínkami) a název akce z popisku
  // („Cashback znamená … vyžaduje registraci.\n\nZimní Cashback na vybrané produkty Canon“ – poslední odstavec).
  // terms = absolutní adresa, nebo cesta od kořene webu (dořeší updateCashbackRegistry podle domény)
  getCashbackPromo(row) {
    const href = row?.querySelector(".promo-action-prices__name[href], a[href]")?.getAttribute("href")?.trim() || "";
    const terms = /^https:\/\//i.test(href) || /^\/(?!\/)/.test(href) ? href.slice(0, 500) : null;
    const parts = (row?.querySelector(".js-promo-action-prices__description")?.textContent || "")
      .split(/\n\s*\n/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const title = parts.length > 1 ? parts.at(-1).slice(0, 120) : null;
    return { terms, title };
  },

  extractPromoPrice(element, parent, promoIconUrl) {
    if (!element || !parent) return null;

    const price = this.parsePositivePrice(element.textContent);
    return price === null ? null : { price, icon: promoIconUrl };
  },

  extractOriginalPrice(element) {
    if (!element) return null;
    return this.parsePositivePrice(element.textContent);
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
    const discountInfo = this.findPromoPriceElement(doc, this.discountPromoTypes);
    const scrappageInfo = this.findPromoPriceElement(doc, ["scrappage"]);
    const cashbackInfo = this.findPromoPriceElement(doc, ["cashback"]);
    const applusInfo = this.findPromoPriceElement(doc, ["applus"]);

    // Extract promo prices
    const discount = this.extractPromoPrice(discountInfo.element, discountInfo.parent, promoIconUrl);
    const scrappage = this.extractPromoPrice(scrappageInfo.element, scrappageInfo.parent, promoIconUrl);
    const cashback = this.extractPromoPrice(cashbackInfo.element, cashbackInfo.parent, promoIconUrl);
    const applus = this.extractPromoPrice(applusInfo.element, applusInfo.parent, promoIconUrl);
    // Kód k ceně – v seznamu jde zkopírovat a vložit s ním zboží do košíku (cart-warning.js)
    const discountCode = discount ? this.getPromoCode(discountInfo.parent) : null;
    if (discountCode) discount.code = discountCode;
    // Stránka akce a její název – připomínka registrace po nákupu (updateCashbackRegistry)
    if (cashback) Object.assign(cashback, this.getCashbackPromo(cashbackInfo.parent));

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

    const specialPrice = specialPriceElement ? this.parsePositivePrice(specialPriceElement.textContent) : null;
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
  isRetryableFetchError({ status = 0, offsite = false } = {}) {
    if (status === 429 || status >= 500) return true;
    return status === 0 && !offsite;
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

  // Detail bez znaku DPH: cenový box má cenu, ale vedlejší cena („bez DPH …“) na stránce chybí – zboží s nulovou
  // sazbou (knihy), kde je cena s DPH i bez stejná. getVatState pak neví a getSaveProblem by ukládání zablokoval
  isVatSignMissing(doc) {
    const box = doc.querySelector(".js-price-detail__main-price-box-wrapper");
    return Boolean(box?.querySelector(".js-price-box__primary-price__value")) && !doc.querySelector(".js-secondary-price");
  },

  // „DPH nejde ověřit“ u detailu bez znaku DPH (isVatSignMissing) dořeší jako výpisy bez znaku (browsing.js
  // resolveVat): porovnání s uloženou historií produktu, jinak ověření DPH z jiné stránky za poslední hodinu.
  // Vrací klíč problému (nebo null = smí se uložit). Jen kde je chrome.storage (ne v offscreen dokumentu)
  async resolveSaveProblem(problem, vatSignMissing, prices, domainKey, url) {
    if (problem !== "notifyProblemVatUnknown" || !vatSignMissing || !this.isKnownDomain(domainKey)) return problem;
    const historyKey = this.getHistoryKey(domainKey, url);
    const vatKey = this.storageKeys.vatCheck;
    const data = await chrome.storage.local.get([historyKey, vatKey]);
    const entries = this.normalizeHistory(data[historyKey], this.domains[domainKey].lang);
    const withVat = this.getVatFromKnownPrices([{ prices: this.toPriceMap(prices), entries }], domainKey) ?? this.getRecentVatCheck(data[vatKey], domainKey);
    if (withVat === true) return null;
    return withVat === false ? "notifyProblemWithoutVat" : problem;
  },

  getProductImage(doc) {
    const url = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
    return this.isAlzaImageUrl(url) ? url : null;
  },

  // Nadpis stránky produktu – zdroj názvu do historie pro seznam, službu na pozadí i detail (stejné znění)
  getProductName(doc) {
    return (doc.querySelector("#h1c h1") || doc.querySelector("h1"))?.textContent.replace(/\s+/g, " ").trim() || null;
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
    if (typeof raw !== "string") return null;

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

  // Ceny záznamu jako [{ type, price, icon, code }] vzestupně podle ceny (code = slevový kód u ceny s kódem)
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
        code: typeof value === "object" && typeof value?.code === "string" ? value.code : null,
        // Cashback: stránka akce a název akce – tooltip ukáže termíny nákupu a registrace (price-card.js)
        ...(typeof value?.terms === "string" && { terms: value.terms, title: typeof value.title === "string" ? value.title : null }),
      });
    }

    return result.sort((a, b) => a.price - b.price);
  },

  toPriceMap(prices) {
    return Object.fromEntries(this.getPriceEntries(prices || {}).map(({ type, price }) => [type, price]));
  },

  isSamePriceMap(a, b) {
    a = a || {};
    b = b || {};
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

  // Běžná cena se přeškrtne, jen když jde opravdu zaplatit míň (benefit, AlzaPlus+, kód, akce). Cashback a výkup
  // platí jen za podmínek (registrace, odevzdání starého zařízení) a peníze se vrací až potom – běžná cena dál platí
  isOriginalSuperseded(priceMap) {
    const original = priceMap?.original;
    const payNow = this.getPayNowPrice(priceMap);
    return typeof original === "number" && payNow !== null && payNow < original;
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

  // Zrušená objednávka nebo vrácené zboží (stav v jazyce domény: „Vráceno“, „Vrátené“, „Visszaküldve“,
  // „Returned“) – do hlídání po nákupu nepatří
  isCancelledOrder(state) {
    return /zru[sš]|storn|cancel|t[oö]r[oö]l/i.test(String(state || "")) || this.isReturnedItem(state);
  },

  // Jen vrácené zboží (ne zrušená objednávka) – v Mých nákupech zůstává v přehledu se stavem „vráceno“
  isReturnedItem(state) {
    return /vr[aá]cen|vr[aá]ten|visszak[uü]ld|visszav[eé]t|return|refund/i.test(String(state || ""));
  },

  // Nejmenší rozdíl ceny, který není jen zaokrouhlení: 1 Kč / 1 Ft, ale 5 centů (1 € by u levného zboží bylo i 5 %)
  getPriceTolerance(domainKey) {
    return this.domains[domainKey]?.currency === "€" ? 0.05 : 1;
  },

  // Koupené zboží z detailu objednávky (API „Moje objednávky“, parts[].items[]): [{ key, url, name, image, price,
  // count, boughtAt, returnUntil }] – price = cena za kus („428 Kč/ks“), returnUntil = boughtAt + purchaseReturnDays.
  // Objednávka s jediným zbožím: záporné řádky (slevový kód je zvláštní řádek objednávky) se odečtou od ceny –
  // kromě těch, které jen ruší cenu služby (doprava 69 + sleva na dopravné −69). S víc zbožím jen procentní sleva
  // k položce, kterou jde jednoznačně přiřadit podle částky (parseOrderDiscountPercent).
  // Vrácené zboží (stav položky, banner „Produkt byl vrácen“, dobropis) se nevrací – hlídání po nákupu by u něj dál
  // radilo „vraťte a kupte znovu“. includeReturned = i s ním (Moje nákupy potřebují jeho cenu, aby ji odečetly
  // z výdajů; části-dobropisy si vynechají samy)
  parseOrderPurchases(detail, domainKey, { includeReturned = false } = {}) {
    const origin = this.domains[domainKey]?.origin;
    const result = [];
    const allParts = Array.isArray(detail?.parts) ? detail.parts : [];
    const parts = includeReturned ? allParts : this.getOrderGoodsParts(detail, domainKey);
    // Zboží z vynechaných dobropisů a zboží s bannerem vratky
    const credited = new Set(allParts.filter((part) => !parts.includes(part)).flatMap((part) => (Array.isArray(part?.items) ? part.items : []).map((item) => Number(item?.commodityId))));
    const returnBanner = (item) => (Array.isArray(item?.warrantyClaimMessageBanners) ? item.warrantyClaimMessageBanners : []).some((banner) => /ReturnGoods/i.test(String(banner?.warrantyClaimIconUri || "")));
    // Položka, která se nepočítá: zrušená vždy; vrácená jen pro hlídání po nákupu
    const dropped = (item) =>
      includeReturned
        ? this.isCancelledOrder(item?.status) && !this.isReturnedItem(item?.status)
        : this.isCancelledOrder(item?.status) || returnBanner(item) || credited.has(Number(item?.commodityId));
    const tolerance = this.getPriceTolerance(domainKey);
    const lineOf = (item) => {
      const text = String(item?.pricePerItem || "");
      const price = this.parsePositivePrice(text);
      const count = Number(item?.count) || 1;
      return price ? { negative: /^\s*[-−]/.test(text), total: price * count } : null;
    };
    parts.forEach((part) => {
      const boughtAt = Date.parse(part?.created || detail?.created);
      if (!Number.isFinite(boughtAt) || !origin) return;
      (Array.isArray(part?.items) ? part.items : []).forEach((item) => {
        // Jen zboží: služby (doprava) a poukazy (sleva na dopravné, záporná cena) adresu produktu nemají
        const priceText = String(item?.pricePerItem || "");
        const price = /^\s*[-−]/.test(priceText) ? null : this.parsePositivePrice(priceText);
        const id = Number(item?.commodityId);
        if (!price || !Number.isInteger(id) || id <= 0 || dropped(item) || !item?.commodityUrl) return;
        let url = null;
        try {
          const link = new URL(String(item.commodityUrl), origin);
          if (this.isAlzaUrl(link.href) && this.getProductId(link.pathname + link.search) === String(id)) {
            // Skupina variant („…?dq=123“) – číslo produktu je jen v parametru, ten musí zůstat
            url = this.getProductId(link.pathname) === String(id) ? link.origin + link.pathname : `${link.origin}${link.pathname}?dq=${id}`;
          }
        } catch {
          // Poškozená adresa – položka se přeskočí
        }
        if (!url) return;
        result.push({
          key: `${domainKey}_${id}`,
          url,
          name: typeof item.commodityName === "string" ? item.commodityName : null,
          image: this.isAlzaImageUrl(item.imageUrl) ? item.imageUrl : null,
          price,
          count: Number(item.count) || 1,
          boughtAt,
          returnUntil: boughtAt + this.purchaseReturnDays * this.dayMs,
        });
      });
    });
    const items = parts.flatMap((part) => (Array.isArray(part?.items) ? part.items : []));
    // Zrušená (vrácená) položka mezi zboží nepatří – jinak by se slevový kód jedinému zbylému zboží neodečetl
    const goods = items.filter((item) => item?.commodityUrl && lineOf(item) && !lineOf(item).negative && !dropped(item));
    const services = items.filter((item) => !item?.commodityUrl && lineOf(item) && !lineOf(item).negative).map((item) => lineOf(item).total);
    const discounts = [];
    items.forEach((item) => {
      const line = lineOf(item);
      if (!line?.negative) return;
      const service = services.findIndex((total) => Math.abs(total - line.total) < 0.01);
      if (service >= 0) services.splice(service, 1);
      else discounts.push({ total: line.total, name: String(item?.commodityName || ""), percent: this.parseOrderDiscountPercent(item?.commodityName) });
    });
    // Kód produktu („WR173b1“) API u zboží nemá – jen v adrese obrázku (image.alza.cz/products/WR173b1/WR173b1.jpg)
    const codeOf = (item) => String(item?.imageUrl || "").match(/\/products\/([A-Za-z0-9]+)\//)?.[1]?.toLowerCase() || null;
    const subtract = (purchase, discount) => {
      const total = purchase.price * purchase.count;
      if (discount > 0 && discount < total) purchase.price = Math.round(((total - discount) / purchase.count) * 100) / 100;
    };
    if (result.length === 1 && goods.length === 1) {
      subtract(result[0], discounts.reduce((sum, { total }) => sum + total, 0));
    } else if (goods.length > 1) {
      // Víc zboží: sleva k položce („Sleva 30% k položce CIS1415“ – AlzaPlus+) patří zboží s tímto kódem; bez shody
      // kódu procentní sleva tomu jedinému zboží, u kterého částka odpovídá procentu z ceny řádku nebo jednoho kusu.
      // Ostatní slevy (pevná částka bez kódu, sleva na celou objednávku) nepřiřadíme
      discounts.forEach(({ total, name, percent }) => {
        const words = new Set((name.match(/[A-Za-z0-9]{4,}/g) || []).map((word) => word.toLowerCase()));
        let matches = goods.filter((item) => words.has(codeOf(item)));
        if (matches.length !== 1 && percent) {
          const fits = (amount) => Math.abs((amount * percent) / 100 - total) <= Math.max(tolerance, total * 0.02);
          matches = goods.filter((item) => fits(lineOf(item).total) || fits(lineOf(item).total / (Number(item.count) || 1)));
        }
        if (matches.length !== 1) return;
        const purchase = result.find(({ key }) => key === `${domainKey}_${Number(matches[0].commodityId)}`);
        if (purchase) subtract(purchase, total);
      });
    }
    return result;
  },

  // === Moje nákupy: všechno koupené z archivu objednávek (volba ownedItems, AlzaOwned v shared/orders.js) ===
  // Archiv „Moje objednávky“ (…/orders/archive?offset=&limit=) vrací objednávky od nejnovější, u zboží adresu, název,
  // značku a kategorii – cenu kusu a možnost reklamace až detail objednávky (parseOwnedDetails).
  ownedPageSize: 100, // Objednávek na jeden dotaz do archivu
  ownedMaxPages: 30, // Nejvýš tolik dotazů do archivu za jedno načtení (první načtení dlouhé historie pokračuje příště)
  ownedDetailsPerRun: 20, // Detailů objednávek (cena kusu, reklamace) za jeden běh na pozadí
  ownedDetailMonths: 25, // Detaily jen u objednávek z této doby – starší už v běžné záruce nejsou
  ownedDetailVersion: 2, // Zvýšit po změně čtení detailu: načtené detaily se postupně načtou znovu (2 = dobropisy, reklamace, kusy)
  ownedSyncHours: 12, // Nové objednávky v archivu se hledají nejvýš jednou za tuto dobu
  warrantyMonths: 24, // Zákonná odpovědnost za vady; delší záruku pozná API („lze reklamovat“ i po této době)
  warrantyReminderDays: 30, // Připomínka konce záruky tolik dní předem
  warrantyRecheckDays: 60, // Po konci běžné záruky se detail načte ještě jednou – delší záruka (stále „lze reklamovat“)
  warrantyExtendedRecheckDays: 90, // Delší záruka se pak ověřuje znovu po této době, dokud reklamovat jde
  ownedSettleDays: 30, // Detail načtený dřív než tolik dní po nákupu se pak načte znovu (vrácení, první reklamace)
  ownedClaimRecheckDays: 30, // Rozpracovaná reklamace se ověřuje znovu po této době
  // Připomínka konce záruky jen u dražšího zboží (za kus) – jinak by chodila i kvůli bateriím a kabelům
  warrantyReminderMinPrice: { Kč: 1000, "€": 40, Ft: 15000 },

  // Stránka objednávky v „Můj účet“ podle čísla objednávky; null = neznámá doména nebo číslo
  getOrderUrl(domainKey, order) {
    const origin = this.domains[domainKey]?.origin;
    return origin && /^\d{1,20}$/.test(String(order || "")) ? `${origin}/my-account/order-details-${order}.htm` : null;
  },

  // Adresa zboží z položky objednávky (commodityUrl + commodityId); null = není zboží Alzy nebo adresa nesedí s číslem
  getOrderItemUrl(item, origin) {
    const id = Number(item?.commodityId);
    if (!Number.isInteger(id) || id <= 0 || !item?.commodityUrl || !origin) return null;
    try {
      const link = new URL(String(item.commodityUrl), origin);
      if (!this.isAlzaUrl(link.href) || this.getProductId(link.pathname + link.search) !== String(id)) return null;
      // Skupina variant („…?dq=123“) – číslo produktu je jen v parametru, ten musí zůstat
      return this.getProductId(link.pathname) === String(id) ? link.origin + link.pathname : `${link.origin}${link.pathname}?dq=${id}`;
    } catch {
      return null; // Poškozená adresa – položka se přeskočí
    }
  },

  // Jedna stránka archivu objednávek → { total (objednávek v archivu), count (na této stránce), orders: [{ id, t,
  // total (částka objednávky), cancelled, items: [{ key, url, name, image, brand, cat: [..], n }] }] }; null = odpověď nesedí
  parseArchivePage(json, domainKey) {
    const origin = this.domains[domainKey]?.origin;
    if (!origin || !json || typeof json !== "object" || !Array.isArray(json.value)) return null;
    const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
    const orders = [];
    json.value.forEach((order) => {
      const id = String(order?.orderId || "");
      const t = Date.parse(order?.created);
      if (!/^\d{1,20}$/.test(id) || !Number.isFinite(t)) return;
      const items = [];
      (Array.isArray(order.items) ? order.items : []).forEach((item) => {
        // Vrácené zboží v přehledu zůstává (stav „vráceno“, odečte se z výdajů); zrušená položka koupená nebyla
        const returned = this.isReturnedItem(item?.status);
        const url = this.isCancelledOrder(item?.status) && !returned ? null : this.getOrderItemUrl(item, origin);
        if (!url) return;
        const key = `${domainKey}_${Number(item.commodityId)}`;
        // count = kusů v této objednávce; purchasedPiecesCount je součet za všechny objednávky zboží, ne za tuto
        const n = Number(item.count) > 0 ? Number(item.count) : 1;
        // Totéž zboží na dvou řádcích objednávky = jeden nákup, kusy se sčítají
        const same = items.find((other) => other.key === key);
        if (same) {
          same.n += n;
          if (!returned) delete same.ret;
          return;
        }
        items.push({
          key,
          url,
          name: text(item.commodityName),
          image: this.isAlzaImageUrl(item.imageUrl) ? item.imageUrl : null,
          brand: text(item.brand),
          cat: [item.categorySegment1, item.categorySegment2, item.categorySegment3].map(text).filter(Boolean),
          n,
          ...(returned && { ret: true }),
        });
      });
      orders.push({ id, t, total: this.parsePositivePrice(String(order.totalPrice || "")) || null, cancelled: this.isCancelledOrder(order.state), items });
    });
    const total = Number(json.paging?.size);
    return { total: Number.isFinite(total) && total >= 0 ? total : null, count: json.value.length, orders };
  },

  // Zapíše objednávky z archivu do přehledu koupeného zboží (owned: { klíč produktu: { url, domain, name, image, brand,
  // cat, buys: [{ t, n, o }] } }) a do přehledu objednávek domény (orders: { číslo: [čas, částka] }). Nákup = produkt
  // v jedné objednávce (o = číslo objednávky). Zrušená objednávka své nákupy odebere. Vrací počet nových nákupů
  mergeOwnedOrders(owned, orders, parsed, domainKey) {
    let added = 0;
    parsed.forEach((order) => {
      if (order.cancelled) {
        if (!orders[order.id]) return;
        delete orders[order.id];
        Object.entries(owned).forEach(([key, product]) => {
          if (product?.domain !== domainKey || !Array.isArray(product.buys)) return;
          product.buys = product.buys.filter((buy) => buy.o !== order.id);
          if (product.buys.length === 0) delete owned[key];
        });
        return;
      }
      if (order.items.length === 0) return; // Jen služby (dárkový poukaz, doprava…)
      orders[order.id] = [order.t, order.total];
      order.items.forEach((item) => {
        const product = owned[item.key] && typeof owned[item.key] === "object" ? owned[item.key] : { url: item.url, domain: domainKey, buys: [] };
        if (!Array.isArray(product.buys)) product.buys = [];
        const newest = !product.buys.some((buy) => buy.t > order.t);
        // Název, obrázek a zařazení z nejnovějšího nákupu (Alza zboží přejmenovává)
        if (newest || !product.name) Object.assign(product, { url: item.url, name: item.name || product.name || null, image: item.image || product.image || null, brand: item.brand || product.brand || null, cat: item.cat.length ? item.cat : product.cat || [] });
        const known = product.buys.find((buy) => buy.o === order.id);
        if (known) known.n = Math.max(known.n || 0, item.n);
        else {
          product.buys.push({ t: order.t, n: item.n, o: order.id });
          product.buys.sort((a, b) => a.t - b.t);
          added++;
        }
        // Vrácené podle archivu (stav položky) – i u nákupu, který už v přehledu je a vrátil se až později
        if (item.ret) (known || product.buys.find((buy) => buy.o === order.id)).ret = true;
        owned[item.key] = product;
      });
    });
    return added;
  },

  // Části objednávky bez dobropisů. Vrácené zboží je v detailu dvakrát: ve faktuře (s bannerem „Produkt byl vrácen …“)
  // a znovu v dobropisu – tam bez banneru a bez možnosti reklamace, i se svými slevovými řádky. Název části („Dobropis“)
  // je v každém jazyce jiný, proto podle obsahu: dobropis = každé jeho zboží je i v jiné části, kde ho jde reklamovat
  // nebo má banner
  getOrderGoodsParts(detail, domainKey) {
    const origin = this.domains[domainKey]?.origin;
    const live = (item) => item.onClaimItemGuideClick?.enabled === true || (Array.isArray(item.warrantyClaimMessageBanners) && item.warrantyClaimMessageBanners.length > 0);
    const parts = (Array.isArray(detail?.parts) ? detail.parts : []).map((part) => ({ part, goods: (Array.isArray(part?.items) ? part.items : []).filter((item) => this.getOrderItemUrl(item, origin)) }));
    const elsewhere = (item, index) => parts.some((other, otherIndex) => otherIndex !== index && other.goods.some((candidate) => candidate.commodityId === item.commodityId && live(candidate)));
    return parts.filter(({ goods }, index) => goods.length === 0 || !goods.every((item) => !live(item) && elsewhere(item, index))).map(({ part }) => part);
  },

  // Detail objednávky → { klíč produktu: { p (cena kusu po slevách; null = nezjištěna), claim (lze reklamovat),
  // ret (zboží z této objednávky už nemáte: ikona ReturnGoods nebo dobropis na ně – odstoupení i reklamace vyřízená
  // vrácením peněz či náhradním kusem v jiné objednávce), rma (šlo o reklamaci, ne o odstoupení: ikona WarrantyClaim
  // nebo číslo případu jiné řady než vratky „AVRA…“ – texty banneru jsou v každém jazyce jiné), n (kusů) } }.
  // Zboží na víc řádcích: jde-li aspoň jeden kus reklamovat, nákup trvá. Zboží ve víc částech, které nikde nejde
  // reklamovat a nemá banner = zaplacená objednávka, která se vrací bez převzetí (faktura + účetní dobropis) – také ret
  parseOwnedDetails(detail, domainKey) {
    const origin = this.domains[domainKey]?.origin;
    const parts = this.getOrderGoodsParts(detail, domainKey);
    const keyOf = (item) => `${domainKey}_${Number(item.commodityId)}`;
    // Zboží z vynechaných dobropisů – peníze za ně se vrátily nebo započetly do jiné objednávky
    const credited = new Set((Array.isArray(detail?.parts) ? detail.parts : []).filter((part) => !parts.includes(part)).flatMap((part) => part.items.filter((item) => this.getOrderItemUrl(item, origin)).map(keyOf)));
    const prices = Object.fromEntries(this.parseOrderPurchases({ ...detail, parts }, domainKey, { includeReturned: true }).map((purchase) => [purchase.key, purchase.price]));
    // Firemní nákup (fakturační údaje s IČO) – jen příznak, údaje se neukládají. Záruka pro firmy bývá jiná
    const biz = (Array.isArray(detail?.parts) ? detail.parts : []).some((part) => String(part?.billingAddress?.identificationNumber || "").trim() !== "");
    const found = {};
    parts.forEach((part) => {
      (Array.isArray(part?.items) ? part.items : []).forEach((item) => {
        if (!this.getOrderItemUrl(item, origin)) return;
        const key = keyOf(item);
        // Banner: ikona + řada čísla případu („AVRA262…“ = vratka, „ASRE…“ / „ASKU…“ = reklamace)
        const banners = (Array.isArray(item.warrantyClaimMessageBanners) ? item.warrantyClaimMessageBanners : []).map((banner) => ({
          icon: String(banner?.warrantyClaimIconUri || "").split("/").pop(), // jen název souboru – složka se jmenuje „warrantyClaims“
          series: String(banner?.message?.actions?.warrantyClaimDetail?.name || "").replace(/[^a-z]/gi, ""),
        }));
        const entry = (found[key] ||= { claim: false, back: false, claimed: false, counts: new Map() });
        entry.claim ||= item.onClaimItemGuideClick?.enabled === true;
        entry.back ||= this.isCancelledOrder(item.status) || banners.some(({ icon }) => /ReturnGoods/i.test(icon));
        entry.claimed ||= banners.some(({ icon, series }) => /WarrantyClaim/i.test(icon) || (series !== "" && !/VRA/i.test(series)));
        entry.counts.set(part, (entry.counts.get(part) || 0) + (Number(item.count) > 0 ? Number(item.count) : 1));
      });
    });
    return Object.fromEntries(
      Object.entries(found).map(([key, { claim, back, claimed, counts }]) => {
        const pieces = [...counts.values()];
        const refunded = !claim && !back && !claimed && pieces.length > 1;
        const n = refunded ? Math.max(...pieces) : pieces.reduce((sum, count) => sum + count, 0);
        // guess = „vráceno“ jen z odhadu (zboží ve víc částech bez možnosti reklamace) – po konci záruky nejde
        // reklamovat nic, tam odhad neplatí (applyOwnedDetails)
        const guess = refunded && !credited.has(key);
        return [key, { p: prices[key] ?? null, claim, ret: !claim && (back || refunded || credited.has(key)), rma: !claim && claimed, n, ...(biz && { biz: true }), ...(guess && { guess: true }) }];
      })
    );
  },

  // Doplní nákupům z jedné objednávky údaje z jejího detailu (at = čas načtení detailu – i u zboží, které v něm chybí;
  // dv = verze čtení detailu, viz ownedDetailVersion; biz = firemní nákup). warranties = { klíč produktu: { m, b } }
  // – záruka z detailu produktu (getDocumentWarranty, uložená se záznamem ceny): nákup si ji vezme (w = měsíce), když
  // sedí druh nákupu (b = „pro firemní nákupy“)
  applyOwnedDetails(owned, orderId, details, domainKey, now = Date.now(), warranties = {}) {
    Object.entries(owned).forEach(([key, product]) => {
      if (product?.domain !== domainKey || !Array.isArray(product.buys)) return;
      const buy = product.buys.find((candidate) => candidate.o === orderId);
      if (!buy) return;
      const found = details[key];
      if (found) {
        // Po konci záruky nejde reklamovat nic – odhad vratky (guess) by z běžného nákupu udělal vrácený
        const ret = found.guess && now >= this.getWarrantyEnd(buy) ? Boolean(buy.ret) : found.ret;
        Object.assign(buy, { claim: found.claim, ret }, found.p ? { p: found.p } : {}, found.n > 0 ? { n: found.n } : {});
        if (found.rma) buy.rma = true;
        else delete buy.rma;
        if (found.biz) buy.biz = true;
        else delete buy.biz;
      }
      Object.assign(buy, { at: now, dv: this.ownedDetailVersion });
      if (warranties?.[key]) this.applyOwnedWarranty({ buys: [buy] }, warranties[key]);
    });
  },

  // „24 měsíců“, „Záruka 3 roky“, „36 mesiacov“, „24 hónap“, „2 years“ → měsíce; null = délka se nedá přečíst
  parseWarrantyText(text) {
    const match = String(text ?? "").replace(/\s+/g, " ").match(/(\d{1,3})\s*(m[eě]s[ií]c|mesiac|h[oó]nap|month|let\b|rok|[eé]v\b|year)/i);
    if (!match) return null;
    const months = Number(match[1]) * (/^(m[eě]s|mesiac|h[oó]nap|month)/i.test(match[2]) ? 1 : 12);
    return months > 0 && months <= 240 ? months : null;
  },

  // Záruka z API detailu produktu (…/api/router/legacy/catalog/product/<id> → data.warranty „24 měsíců“) – platí pro
  // přihlášený účet (firemnímu vrací záruku pro firemní nákupy). Měsíce, nebo null
  ownedWarrantiesPerRun: 15, // Produktů za jeden běh na pozadí (po kliknutí v nastavení trojnásobek)
  ownedWarrantyMonths: 60, // Jen u nákupů z této doby – starší už v záruce nejsou
  ownedWarrantyRetryDays: 30, // Produkt, u kterého se záruku nepodařilo zjistit, se zkusí znovu po této době
  getProductApiUrl(domainKey, productId) {
    const origin = this.domains[domainKey]?.origin;
    return origin && /^\d+$/.test(String(productId)) ? `${origin}/api/router/legacy/catalog/product/${productId}` : null;
  },

  parseProductWarranty(json) {
    return json && typeof json === "object" && json.err === 0 ? this.parseWarrantyText(json.data?.warranty) : null;
  },

  // Produkty, u kterých se má zjistit délka záruky: nevrácený nákup z posledních ownedWarrantyMonths bez záruky (w)
  // a produkt, na který jsme se ještě neptali (wa) nebo naposledy před ownedWarrantyRetryDays. Od nejnovějších
  // nákupů. [{ key, id }]
  getOwnedWarrantyQueue(owned, domainKey, now = Date.now()) {
    const since = this.addMonths(now, -this.ownedWarrantyMonths);
    const retry = this.ownedWarrantyRetryDays * this.dayMs;
    return Object.entries(owned || {})
      .filter(([, product]) => product?.domain === domainKey && Array.isArray(product.buys) && !(now - (product.wa || 0) < retry))
      .map(([key, product]) => ({ key, id: key.slice(domainKey.length + 1), t: Math.max(0, ...product.buys.filter((buy) => !buy.ret && !(buy.w > 0) && buy.t >= since).map((buy) => buy.t)) }))
      .filter(({ id, t }) => /^\d+$/.test(id) && t > 0)
      .sort((a, b) => b.t - a.t)
      .map(({ key, id }) => ({ key, id }));
  },

  // Výsledek dotazu na záruku produktu: wa = kdy jsme se ptali; měsíce dostanou nákupy, které záruku ještě nemají
  applyOwnedWarrantyResult(owned, key, months, now = Date.now()) {
    const product = owned?.[key];
    if (!product || typeof product !== "object") return false;
    product.wa = now;
    if (months > 0) this.applyOwnedWarranty(product, { m: months });
    return true;
  },

  // Záruka ke koupeným kusům, které ji ještě nemají (w = měsíce). Z detailu produktu na stránce (b = platí „pro
  // firemní nákupy“ / pro ostatní): jen u nákupu s načteným detailem objednávky (víme, jestli byl firemní) a stejného
  // druhu. Z API produktu (b neuvedeno): platí pro účet, tedy pro všechny jeho nákupy. Později zjištěná záruka
  // starší nákup nepřepíše – mohla se mezitím změnit. Vrací true, když se něco změnilo
  applyOwnedWarranty(product, warranty) {
    const months = Number(warranty?.m);
    if (!Number.isInteger(months) || months <= 0 || !Array.isArray(product?.buys)) return false;
    let changed = false;
    product.buys.forEach((buy) => {
      if (buy?.w > 0) return;
      if (warranty.b !== undefined && (!buy?.at || Boolean(buy.biz) !== Boolean(warranty.b))) return;
      buy.w = months;
      changed = true;
    });
    return changed;
  },

  // Konec záruky nákupu: měsíce z detailu produktu (buy.w), jinak warrantyMonths
  getWarrantyEnd(buy) {
    return this.addMonths(buy.t, Number.isInteger(buy?.w) && buy.w > 0 ? buy.w : this.warrantyMonths);
  },

  // Záruka z detailu produktu: { m: měsíce, b: jen „pro firemní nákupy“ } nebo null. Nefiremní účet ji má v řádku
  // „Záruka 24 měsíců“ (more-info-warranty), firemní v bloku výhod pod tlačítky („Pro firemní nákupy: Záruka
  // 24 měsíců“ – dokreslí se až v prohlížeči, v HTML ze serveru není)
  getDocumentWarranty(doc) {
    const read = (element) => this.parseWarrantyText(element?.textContent);
    const personal = read(doc.querySelector('[data-testid="more-info-warranty"]'));
    if (personal) return { m: personal, b: false };
    const words = /z[aá]ruk|garanci|j[oó]t[aá]ll|warrant/i;
    const rows = [...doc.querySelectorAll('[data-testid="component-uniqueSellingPropositions"] a')].map((link) => link.parentElement).filter((row) => row && words.test(row.textContent));
    for (const row of rows) {
      const months = read(row);
      if (months) return { m: months, b: true };
    }
    return null;
  },

  // O tolik měsíců později; den v měsíci, který cíl nemá (31. 8. + 6 měsíců), se zkrátí na jeho poslední den
  addMonths(time, months) {
    const date = new Date(time);
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + months);
    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
    return date.getTime();
  },

  // Stav záruky nákupu: { state, until, daysLeft }. until = nákup + warrantyMonths (odhad – přesnou délku API neuvádí)
  //   claimed = reklamováno (z této objednávky už reklamovat nejde; i reklamace vyřízená vrácením nebo náhradním
  //   kusem v jiné objednávce) · returned = vráceno (odstoupení) · active / ending (do
  //   warrantyReminderDays) = v záruce · extended = po běžné době, ale detail načtený až po ní říká, že reklamovat
  //   stále jde (delší záruka) · expired = po záruce · none = v běžné době, ale reklamovat nejde (licence, služba)
  getWarrantyState(buy, now = Date.now()) {
    const until = this.getWarrantyEnd(buy);
    const daysLeft = Math.ceil((until - now) / this.dayMs);
    if (buy.rma) return { state: "claimed", until, daysLeft };
    if (buy.ret) return { state: "returned", until, daysLeft };
    // „Delší záruka“ platí, jen dokud je ověření čerstvé (ověřuje se znovu po warrantyExtendedRecheckDays – fronta
    // detailů); bez nového ověření (vypnutá funkce, chyba načtení) po dvojnásobku doby skončí
    const verified = buy.claim === true && buy.at >= until && now - buy.at <= 2 * this.warrantyExtendedRecheckDays * this.dayMs;
    if (now >= until) return { state: verified ? "extended" : "expired", until, daysLeft };
    if (buy.claim === false && buy.at) return { state: "none", until, daysLeft };
    return { state: daysLeft <= this.warrantyReminderDays ? "ending" : "active", until, daysLeft };
  },

  // Objednávky, jejichž detail je potřeba načíst: nákupy z posledních ownedDetailMonths bez detailu (nebo s detailem
  // načteným starší verzí čtení – ownedDetailVersion) a nákupy těsně po konci běžné záruky (jedno ověření delší
  // záruky). Nejdřív ty, kterým záruka brzy končí, pak od nejnovějších. Vrací čísla objednávek
  getOwnedDetailQueue(owned, domainKey, now = Date.now()) {
    const since = this.addMonths(now, -this.ownedDetailMonths);
    const queue = new Map(); // číslo objednávky → { urgent, t }
    Object.values(owned).forEach((product) => {
      if (product?.domain !== domainKey || !Array.isArray(product.buys)) return;
      product.buys.forEach((buy) => {
        const until = this.getWarrantyEnd(buy);
        const age = (days) => now - (buy.at || 0) >= days * this.dayMs;
        const fresh = buy.t >= since && (!buy.at || (buy.dv || 1) < this.ownedDetailVersion);
        const recheck = !buy.ret && now >= until && now - until <= this.warrantyRecheckDays * this.dayMs && !(buy.at >= until);
        // Detail se nečte jen jednou – stav se mění i po prvním načtení:
        // settle = po lhůtě pro vrácení (detail načtený hned po nákupu vratku ani první reklamaci nezná)
        const settle = Boolean(buy.at) && !buy.ret && buy.at < buy.t + this.ownedSettleDays * this.dayMs && now >= buy.t + this.ownedSettleDays * this.dayMs && now < until;
        // claimCheck = rozpracovaná reklamace (po vyřízení jde zboží znovu reklamovat)
        const claimCheck = Boolean(buy.rma) && now < until + this.warrantyRecheckDays * this.dayMs && age(this.ownedClaimRecheckDays);
        // beforeEnd = před připomínkou konce záruky (getWarrantyReminders ji bez čerstvého detailu nepošle)
        const beforeEnd = Boolean(buy.at) && !buy.ret && now < until && until - now <= 2 * this.warrantyReminderDays * this.dayMs && buy.at < until - 2 * this.warrantyReminderDays * this.dayMs;
        // extended = delší záruka ověřená po běžné době – ověřovat dál, jinak by „stále jde reklamovat“ neskončilo
        const extended = !buy.ret && now >= until && buy.claim === true && buy.at >= until && age(this.warrantyExtendedRecheckDays);
        if (!fresh && !recheck && !settle && !claimCheck && !beforeEnd && !extended) return;
        const urgent = recheck || beforeEnd || (now < until && until - now <= 2 * this.warrantyReminderDays * this.dayMs);
        const previous = queue.get(buy.o);
        queue.set(buy.o, { urgent: urgent || Boolean(previous?.urgent), t: buy.t });
      });
    });
    return [...queue].sort((a, b) => b[1].urgent - a[1].urgent || b[1].t - a[1].t).map(([order]) => order);
  },

  // Nákupy, kterým končí záruka a ještě o tom nepřišla připomínka: zboží od warrantyReminderMinPrice za kus, s načteným
  // detailem (cena, reklamace možná). [{ key, product, buy, until, daysLeft }]
  getWarrantyReminders(owned, now = Date.now()) {
    const result = [];
    Object.entries(owned).forEach(([key, product]) => {
      const minPrice = this.warrantyReminderMinPrice[this.domains[product?.domain]?.currency];
      if (!minPrice || !Array.isArray(product.buys)) return;
      product.buys.forEach((buy) => {
        if (buy.notified || !buy.at || buy.claim !== true || !(buy.p >= minPrice)) return;
        const { state, until, daysLeft } = this.getWarrantyState(buy, now);
        // Jen s detailem načteným krátce před koncem záruky – starý by nevěděl o vrácení ani reklamaci
        // (getOwnedDetailQueue ho před připomínkou načte znovu)
        if (state === "ending" && buy.at >= until - 2 * this.warrantyReminderDays * this.dayMs) result.push({ key, product, buy, until, daysLeft });
      });
    });
    return result.sort((a, b) => a.until - b.until);
  },

  // Procento ze slevového řádku objednávky („Sleva 30% k položce …“, „Zľava 30 %“, „30% kedvezmény“); null = bez procenta
  parseOrderDiscountPercent(name) {
    const match = String(name || "").match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
    const percent = match ? Number(match[1].replace(",", ".")) : NaN;
    return percent > 0 && percent < 100 ? percent : null;
  },

  // Zlevnění po nákupu: nejnižší cena k zaplacení je pod nákupní (aspoň o 0,5 % / 1 Kč) a pod cenou, o které už
  // přišlo upozornění. Cena z objednávky bývá bez slevového kódu (zvláštní řádek objednávky) a dnešní cena může
  // být s AlzaPlus+, které uživatel mít nemusí – s historií produktu (historyEntries, bez právě načtené ceny) se
  // proto srovnává s nejnižší cenou k zaplacení kolem data nákupu (getPurchaseReferencePrice): upozorní jen na
  // skutečné zlevnění od nákupu. Prázdná historie = cenu z doby nákupu neznáme → nic; bez historie (null) jen
  // proti ceně z objednávky. { lowest, saving, reference } (reference = cena, proti které se srovnává) nebo null
  getPurchaseDrop(purchase, priceMap, now = Date.now(), historyEntries = null) {
    if (!purchase || !(purchase.price > 0) || !(purchase.returnUntil > now)) return null;
    const lowest = this.getPayNowPrice(priceMap) ?? this.getLowestPrice(priceMap);
    let reference = purchase.price;
    if (Array.isArray(historyEntries) && Number.isFinite(purchase.boughtAt)) {
      const atPurchase = this.getPurchaseReferencePrice(historyEntries, purchase.boughtAt);
      if (atPurchase === null) return null;
      reference = Math.min(reference, atPurchase);
    }
    if (!(lowest > 0) || lowest > reference - Math.max(this.getPriceTolerance(purchase.domain), reference * 0.005)) return null;
    if (purchase.notifiedPrice > 0 && lowest >= purchase.notifiedPrice) return null;
    return { lowest, saving: reference - lowest, reference };
  },

  // Nejnižší cena k zaplacení z historie kolem nákupu: stavy platné kdykoli den před nákupem až do nákupu; když
  // historie začíná až po nákupu, první známá cena po něm. Ze záznamů do dne po nákupu se přidá jen cena s kupónem
  // (kód, AlzaPlus+ – výpis je neukazuje všechny, detail je najde až další kontrolou), ne nová akční cena – ta je
  // skutečné zlevnění po nákupu. null = v historii žádná cena
  getPurchaseReferencePrice(entries, boughtAt) {
    const priced = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && Number.isFinite(entry.t) && entry.p && typeof entry.p === "object")
      .sort((a, b) => a.t - b.t)
      .map((entry) => ({ t: entry.t, p: entry.p, price: this.getPayNowPrice(entry.p) ?? this.getLowestPrice(entry.p) }));
    const from = boughtAt - this.dayMs;
    const to = boughtAt + this.dayMs;
    // Stav platí od zjištění do dalšího záznamu (záznam bez ceny = produkt se neprodával, ale ukončí předchozí)
    const atPurchase = priced.filter((entry, i) => entry.t <= boughtAt && (priced[i + 1]?.t ?? Infinity) > from && entry.price > 0).map((entry) => entry.price);
    if (atPurchase.length === 0) {
      const first = priced.find((entry) => entry.t > boughtAt && entry.price > 0);
      if (first) atPurchase.push(first.price);
    }
    if (atPurchase.length === 0) return null;
    const coupons = priced
      .filter((entry) => entry.t > boughtAt && entry.t <= to)
      .flatMap((entry) => ["discount", "applus"].map((type) => entry.p[type]))
      .filter((price) => typeof price === "number" && price > 0);
    return Math.min(...atPurchase, ...coupons);
  },

  // Trezor slevových kódů: zapíše / odebere kód produktu podle záznamu ceny (discount.code). since = kdy jsme
  // kód poprvé viděli (při změně kódu znovu), seenAt = poslední uložení (posun jen o méně než
  // registrySeenRefreshMs se nezapisuje). Kódy neviděné codeSeenDays se mažou. Vrací true, když se trezor změnil
  updateCodeRegistry(registry, productKey, record, url, domain, now = Date.now()) {
    let changed = this.pruneRegistry(registry, this.codeSeenDays, now);
    const discount = record?.discount;
    const code = discount && typeof discount === "object" && typeof discount.code === "string" ? discount.code : null;
    const previous = registry[productKey];
    if (!code) {
      if (!previous) return changed;
      delete registry[productKey];
      return true;
    }
    const next = { code, price: discount.price, url, domain, since: previous?.code === code ? previous.since : now, seenAt: now };
    if (this.isSameRegistryEntry(previous, next)) return changed;
    registry[productKey] = next;
    return true;
  },

  // Smaže z přehledu (trezor kódů, cashbacky) záznamy neviděné déle než days. Vrací true, když něco smazal
  pruneRegistry(registry, days, now = Date.now()) {
    let changed = false;
    Object.entries(registry).forEach(([key, entry]) => {
      if (!(entry?.seenAt > now - days * this.dayMs)) {
        delete registry[key];
        changed = true;
      }
    });
    return changed;
  },

  // Záznam přehledu se liší jen čerstvým seenAt (méně než registrySeenRefreshMs) – nepřepisovat celý přehled kvůli
  // každému uložení ceny
  isSameRegistryEntry(previous, next) {
    if (!previous || !(next.seenAt - previous.seenAt < this.registrySeenRefreshMs)) return false;
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    keys.delete("seenAt");
    return [...keys].every((key) => previous[key] === next[key]);
  },

  // === Připomínka cashbacku ===

  // Odkaz na stránku akce z řádku cashbacku (absolutní, nebo cesta od kořene webu) → adresa na Alze bez
  // parametrů; null = chybí / mimo Alzu
  resolveCashbackTerms(terms, domain) {
    if (!terms) return null;
    try {
      const url = new URL(String(terms), this.domains[domain]?.origin);
      // Alza odkazuje i bez „www“ (https://alza.cz/ziskejte-penize-zpet-…) – přesměruje na www
      if (/^alza\.(cz|sk|hu)$/i.test(url.hostname)) url.hostname = `www.${url.hostname.toLowerCase()}`;
      return this.isAlzaUrl(url.href) ? url.origin + url.pathname : null;
    } catch {
      return null; // Poškozená adresa
    }
  },

  // Klíč termínů akce: stejná stránka může mít víc akcí – čte se jen ta s názvem z detailu
  getCashbackTermsKey(url, title) {
    return `${url}|${String(title || "").replace(/\s+/g, " ").trim()}`;
  },

  // Cashback ze záznamu ceny (cashback: { price, terms, title }) do přehledu viděných cashbacků. Když cashback
  // zmizí, záznam zůstane (nákup se k němu přiřadí i po konci akce) – smaže se po cashbackSeenDays.
  // refund = o kolik vrátí výrobce (cena k zaplacení − cena po cashbacku; u € i s centy). since = začátek akce:
  // při jiné stránce akce nebo jiném názvu (nová akce) znovu – nákup před ní k ní nepatří (getPurchaseCashback).
  // Vrací true, když se přehled změnil (jen posun seenAt o méně než registrySeenRefreshMs ne)
  updateCashbackRegistry(registry, productKey, record, domain, now = Date.now()) {
    const changed = this.pruneRegistry(registry, this.cashbackSeenDays, now);
    const cashback = record?.cashback;
    if (!cashback || typeof cashback !== "object" || !(cashback.price > 0)) return changed;
    const terms = this.resolveCashbackTerms(cashback.terms, domain);
    const title = typeof cashback.title === "string" ? cashback.title : null;
    const payNow = this.getPayNowPrice(this.toPriceMap(record));
    const previous = registry[productKey];
    const newPromo = Boolean(previous) && ((terms && previous.terms && terms !== previous.terms) || (title && previous.title && title !== previous.title));
    const next = {
      terms: terms || previous?.terms || null,
      title: title ?? previous?.title ?? null,
      price: cashback.price,
      refund: payNow > cashback.price ? Math.round((payNow - cashback.price) * 100) / 100 : null,
      domain,
      since: newPromo ? now : (previous?.since ?? now),
      seenAt: now,
    };
    if (this.isSameRegistryEntry(previous, next)) return changed;
    registry[productKey] = next;
    return true;
  },

  // Cashback, který platil při nákupu: naposledy viděný nejvýš cashbackMatchDays před nákupem a poprvé nejpozději
  // cashbackLateDays po něm (akce, která začala až po nákupu, se nepočítá); null = nákup bez cashbacku
  getPurchaseCashback(purchase, entry) {
    if (!purchase || !entry || !(entry.price > 0) || !(purchase.boughtAt > 0)) return null;
    if (!(entry.seenAt >= purchase.boughtAt - this.cashbackMatchDays * this.dayMs)) return null;
    if (!(entry.since <= purchase.boughtAt + this.cashbackLateDays * this.dayMs)) return null;
    return entry;
  },

  createCashbackReminder(purchase, entry) {
    return {
      url: purchase.url,
      domain: purchase.domain,
      name: purchase.name || null,
      image: purchase.image || null,
      terms: entry.terms || null,
      title: entry.title || null,
      refund: entry.refund || null,
      boughtAt: purchase.boughtAt,
      registerFrom: null,
      registerUntil: null,
      termsRead: false,
      termsTries: 0,
    };
  },

  // Data v textu podmínek: „31. 01. 2027“, „12. 10.“ (rok podle následujícího data, jinak podle nákupu) i maďarské
  // „2027. 01. 31.“ → [{ index, end, time }] – time = konec dne (registrace platí celý poslední den)
  // Měsíce slovy („od 2. listopadu 2026 do 3. ledna 2027“): český a slovenský 2. pád, maďarsky 1. pád
  termMonths: [
    ["ledna", "januára", "január"],
    ["února", "februára", "február"],
    ["března", "marca", "március"],
    ["dubna", "apríla", "április"],
    ["května", "mája", "május"],
    ["června", "júna", "június"],
    ["července", "júla", "július"],
    ["srpna", "augusta", "augusztus"],
    ["září", "septembra", "szeptember"],
    ["října", "októbra", "október"],
    ["listopadu", "novembra", "november"],
    ["prosince", "decembra", "december"],
  ],

  // lang = jazyk textu ("hu": krátké datum je měsíc.den – „2026. 11. 01. – 12. 05.“ končí 5. prosince); refTime =
  // rok k datům bez roku, když ho nedá sousední datum
  findTermDates(text, refTime, lang = null) {
    const names = this.termMonths.flat().join("|");
    const pattern = new RegExp(
      `(?<![\\d.])(\\d{4})\\.\\s?(\\d{1,2})\\.\\s?(\\d{1,2})\\.?|(?<![\\d.])(\\d{1,2})\\.\\s?(\\d{1,2})\\.(?:\\s?(\\d{4}))?|(?<![\\d.])(\\d{1,2})\\.\\s?(${names})(?!\\p{L})(?:\\s(\\d{4}))?|(?<![\\d.])(\\d{4})\\.\\s?(${names})\\s(\\d{1,2})\\.?`,
      "giu"
    );
    const monthOf = (name) => this.termMonths.findIndex((forms) => forms.includes(name.toLowerCase())) + 1;
    const monthFirst = lang === "hu";
    const found = [];
    for (const match of text.matchAll(pattern)) {
      const year = Number(match[1] || match[6] || match[9] || match[10]) || null;
      const [short1, short2] = monthFirst ? [match[5], match[4]] : [match[4], match[5]];
      const month = match[8] ? monthOf(match[8]) : match[11] ? monthOf(match[11]) : Number(match[2] || short2);
      const day = Number(match[3] || short1 || match[7] || match[12]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      found.push({ index: match.index, end: match.index + match[0].length, year, month, day });
    }
    const refYear = new Date(refTime).getFullYear();
    return found.map((date, i) => {
      let year = date.year;
      if (!year) {
        // „od 12. 10. do 31. 12. 2026“ – rok z nejbližšího dalšího data s rokem (pozdější měsíc = rok předtím)
        const next = found.slice(i + 1, i + 3).find((other) => other.year && other.index - date.end < 40);
        // „2026. 11. 01. – 12. 05.“, „od 1. 10. 2026 do 31. 1.“ – rok z předchozího data (dřívější měsíc = rok potom)
        const previous = found.slice(Math.max(0, i - 2), i).reverse().find((other) => other.year && date.index - other.end < 40);
        if (next) year = date.month > next.month ? next.year - 1 : next.year;
        else if (previous) year = date.month < previous.month ? previous.year + 1 : previous.year;
        else {
          year = refYear;
          // „do 15. 1.“ čtené v prosinci – datum přes půl roku zpátky je příští rok
          if (new Date(year, date.month - 1, date.day, 23, 59, 59).getTime() < refTime - 183 * this.dayMs) year++;
        }
      }
      return { index: date.index, end: date.end, time: new Date(year, date.month - 1, date.day, 23, 59, 59).getTime() };
    });
  },

  // Jazyk textu podmínek akce pro findTermDates: zadaný, jinak maďarština podle maďarských slov / data rok.měsíc.den
  getTermsLanguage(text, lang = null) {
    if (lang) return lang;
    return /regisztr|határid|vásárl|akció|(?<![\d.])\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\./iu.test(text) ? "hu" : null;
  },

  // Termíny akce s cashbackem z textu stránky akce (článek Alzy psaný volně). title = název akce z detailu – na
  // stránce s víc akcemi se čte jen text od jejího názvu. Registrace: data kousek za slovem „registrace / žádost“
  // („Registrace nejpozději do: 31. 01. 2027“, „Registrace: 19. 09. 2026 – 15. 01. 2027“, „žádosti … musí být
  // obdrženy nejpozději do půlnoci dne 28. 2. 2027“), i „nejdříve po 30 dnech od nákupu“ / „do 60 dnů od nákupu“.
  // Nákup: konec období za „Nákup v období / Platnost nákupu / Zakupte … v období od … do …“.
  // refTime = rok k datům bez roku („od 12. 10. do …“ bez dalšího data s rokem). lang = jazyk stránky ("hu" –
  // krátké datum měsíc.den; bez něj se maďarština pozná z textu, getTermsLanguage).
  // → { purchaseEnds: [čas], registerEnds: [{ until, from }], registerDays, waitDays } – všechny kandidáty;
  // konkrétní data k danému dni vybere getCashbackDates (tooltip dnes, připomínka k datu nákupu)
  readCashbackTerms(text, title = null, refTime = Date.now(), lang = null) {
    let source = String(text || "").replace(/\s+/g, " ");
    const heading = String(title || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (heading.length >= 6) {
      const index = source.toLowerCase().indexOf(heading);
      if (index >= 0) source = source.slice(index, index + 5000);
    }
    const dates = this.findTermDates(source, refTime, this.getTermsLanguage(source, lang));
    const keyword = /registr|regisztr|žádost|žádosti|žiadost|igényl|claim|uplatn/giu;
    // Termín nákupu („Nákup v období: 12. 10. 2026 – 31. 12. 2026“) mezi slovem „registrace“ a datem – datum
    // patří k nákupu, ne k registraci
    // Platnost celé akce („Akce je platná od 1. 5. 2026 do 31. 1. 2027“, „Termín akce“) = období nákupu
    const purchaseMarker = /nákup v období|nákupu v období|(?<!\p{L})v období od|(?<!\p{L})v termínu od|platnost nákupu|nákup v termínu|zakupte|nakupte|(?<!\p{L})kupte|kúpte|zakúpte|nakúpte|pořiďte|(?:pro)?akce (?:je )?platná|(?:pro)?akce platí|platnost (?:pro)?akce|termín (?:pro)?akce|doba (?:trvání|konání) akce|(?:pro)?akcia (?:je )?platná|platnosť (?:pro)?akcie|termín (?:pro)?akcie|az akció érvényes|akció időtartama|vásárolj|vásárlás időszak|promotion (?:is )?valid|promotion period|purchase period|(?<!\p{L})buy (between|from)/iu;
    // „Regisztráció határideje: 2027. 01. 31.“ / „határidő:“
    const deadlineBefore = /((?<!\p{L})(nejpozději|najneskôr|najneskor|legkésőbb|határid\p{L}*|půlnoci|polnoci|ne později než|nie neskôr ako|no later than|until|by|deadline|do))\s*(dne|dňa|dna|of)?\s*:?\s*$/iu;
    const rangeBefore = /(\d{4}|\d{1,2}\.)\s*(–|-|—|(?<!\p{L})do|(?<!\p{L})až)\s*$/iu;
    const units = "(den|dn|dní|dni|dň|nap|day|týd|týž|hét|week)";
    // Čekání po nákupu („Počkejte minimálně 30 dní od data nákupu“) bývá i ve větě před „Zaregistrujte“ – hledá se
    // v celém textu akce, jen ve spojení s nákupem
    const waitPattern = new RegExp(
      `(nejdříve|najskôr|najskor|minimálně|minimálne|legkorábban|legalább|at least|earliest)[^.]{0,40}?(\\d{1,3})\\.?\\s*${units}[^.]{0,30}?(nákup|nákup|purchase|vásárl)`,
      "giu"
    );
    const relativeDeadline = new RegExp(`((?<!\\p{L})do|within|belül|ne později než|nie neskôr ako|no later than)\\s*(\\d{1,3})\\s*${units}\\p{L}*\\s*(od|po|from|after|a)\\s*(data\\s*|dátumu\\s*|the\\s*|date of\\s*)?(nákup|zakoup|kúp|purchase|vásárl)`, "iu");
    const daysOf = (count, unit) => Number(count) * (/^(týd|týž|hét|week)/i.test(unit) ? 7 : 1);

    // Zmínky o nákupním období – kromě „Zaregistrujte svůj nákup v období od 19. 9. do 15. 1. 2027“ (slovo
    // registrace ve stejné větě kousek před ním: období registrace, ne nákupu)
    const purchaseStarts = [...source.matchAll(new RegExp(purchaseMarker.source, "giu"))]
      .map((match) => match.index)
      .filter((start) => {
        const lead = source.slice(Math.max(0, start - 40), start);
        const last = [...lead.matchAll(new RegExp(keyword.source, "giu"))].at(-1);
        return !last || /[.:!?]/.test(lead.slice(last.index));
      });

    const registerEnds = [];
    const relativeDays = [];
    let waitDays = 0;
    for (const wait of source.matchAll(waitPattern)) waitDays = Math.max(waitDays, daysOf(wait[2], wait[3]));
    for (const match of source.matchAll(keyword)) {
      const start = match.index;
      const window = source.slice(start, start + 180);
      const relative = window.match(relativeDeadline);
      if (relative && !/(nejdříve|najskôr|minimálně|minimálne|legkorábban|at least|earliest)\s*$/i.test(window.slice(0, relative.index))) {
        relativeDays.push(daysOf(relative[2], relative[3]));
      }
      dates
        .filter((date) => date.index >= start && date.index < start + 180 && !purchaseStarts.some((at) => at >= start && at < date.index))
        .forEach((date, i, inWindow) => {
          const before = source.slice(Math.max(start, date.index - 30), date.index);
          if (rangeBefore.test(before) && i > 0) {
            // Konec rozmezí „19. 09. 2026 – 15. 01. 2027“ – začátek je začátek registrace
            registerEnds.push({ until: date.time, from: inWindow[i - 1].time - this.dayMs + 1000 });
          } else if (deadlineBefore.test(before)) {
            registerEnds.push({ until: date.time, from: null });
          }
        });
    }

    // Konec nákupního období: konec rozmezí nebo datum za „do“ – jen v textu před nejbližší zmínkou o registraci
    // („Nákup v období: 12. 10. 2026 – 31. 12. 2026 Registrace nejpozději do: 31. 01. 2027“)
    const purchaseEnds = [];
    for (const start of purchaseStarts) {
      const rest = source.slice(start, start + 160);
      const stop = rest.slice(1).search(keyword);
      const end = start + (stop >= 0 ? stop + 1 : rest.length);
      dates
        .filter((date) => date.index >= start && date.end <= end)
        .forEach((date, i) => {
          const before = source.slice(Math.max(start, date.index - 30), date.index);
          if ((rangeBefore.test(before) && i > 0) || deadlineBefore.test(before)) purchaseEnds.push(date.time);
        });
    }

    return {
      purchaseEnds: [...new Set(purchaseEnds)].sort((a, b) => a - b),
      registerEnds: [...new Map(registerEnds.map((entry) => [`${entry.until}|${entry.from}`, entry])).values()].sort((a, b) => a.until - b.until),
      registerDays: relativeDays.length > 0 ? Math.min(...relativeDays) : null,
      waitDays,
    };
  },

  // Doplní termíny ze stránky akce termíny z jiného zdroje (popisek řádku cashbacku na detailu: „Akce platí do
  // 3. 1. 2027“) – jen to, co stránka nemá. Vrací nový objekt
  mergeCashbackTerms(base, extra) {
    const merged = { purchaseEnds: [], registerEnds: [], registerDays: null, waitDays: 0, ...base };
    if (!extra) return merged;
    if (merged.purchaseEnds.length === 0) merged.purchaseEnds = extra.purchaseEnds || [];
    if (merged.registerEnds.length === 0) merged.registerEnds = extra.registerEnds || [];
    if (!(merged.registerDays > 0)) merged.registerDays = extra.registerDays ?? null;
    if (!(merged.waitDays > 0)) merged.waitDays = extra.waitDays || 0;
    return merged;
  },

  // Má záznam termínů aspoň jeden termín?
  hasCashbackTerms(terms) {
    return Boolean(terms?.purchaseEnds?.length || terms?.registerEnds?.length || terms?.registerDays > 0 || terms?.waitDays > 0);
  },

  // Data akce k danému dni z readCashbackTerms: purchaseUntil = nejbližší konec nákupu od toho dne, purchaseEnded =
  // nákupní období už skončilo; registrace pro nákup v ten den – registerUntil = nejbližší pevná lhůta nebo
  // registerDays od nákupu (co je dřív, připomenout raději dřív než pozdě), registerFrom = začátek registrace / konec
  // čekání po nákupu (null = hned). Pro tooltip před nákupem refTime = teď, pro připomínku = čas nákupu
  getCashbackDates(terms, refTime = Date.now()) {
    const day = new Date(refTime);
    const refDay = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const purchaseEnds = Array.isArray(terms?.purchaseEnds) ? terms.purchaseEnds.filter(Number.isFinite) : [];
    const registerEnds = Array.isArray(terms?.registerEnds) ? terms.registerEnds.filter((entry) => Number.isFinite(entry?.until)) : [];
    const fixed = registerEnds.filter((entry) => entry.until >= refDay).sort((a, b) => a.until - b.until)[0] || null;
    const relative = terms?.registerDays > 0 ? refTime + terms.registerDays * this.dayMs : null;
    const registerUntil = [fixed?.until, relative].filter(Boolean).sort((a, b) => a - b)[0] ?? null;
    const opens = Math.max(fixed?.from || 0, terms?.waitDays > 0 ? refTime + terms.waitDays * this.dayMs : 0);
    return {
      purchaseUntil: purchaseEnds.find((time) => time >= refDay) ?? null,
      // Nákupní období skončilo (Alza cashback ještě může ukazovat) – kdy naposledy
      purchaseEnded: purchaseEnds.length > 0 && purchaseEnds.every((time) => time < refDay) ? Math.max(...purchaseEnds) : null,
      registerFrom: opens > refTime ? opens : null,
      registerUntil,
    };
  },

  // Lhůta registrace pro nákup v čase boughtAt přímo z textu stránky akce → { registerFrom, registerUntil }
  // (zkratka pro testy – rozšíření volá readCashbackTerms + getCashbackDates)
  parseCashbackTerms(text, title = null, boughtAt = Date.now(), lang = null) {
    const { registerFrom, registerUntil } = this.getCashbackDates(this.readCashbackTerms(text, title, boughtAt, lang), boughtAt);
    return { registerFrom, registerUntil };
  },

  // Co teď s připomínkou: "expired" = lhůta prošla (smazat), "open" = registrace je otevřená a ještě jsme
  // neupozornili, "soon" = do konce registrace zbývá cashbackSoonDays, null = nic (hotovo / ještě se nedá registrovat)
  getCashbackReminderStep(reminder, now = Date.now()) {
    if (!reminder || !(reminder.boughtAt > 0)) return "expired";
    const until = reminder.registerUntil > 0 ? reminder.registerUntil : null;
    if (until ? now > until : now > reminder.boughtAt + this.cashbackKeepDays * this.dayMs) return "expired";
    if (reminder.done) return null;
    // Podmínky akce se zatím nenačetly (zkusí se při další kontrole) – upozornění počká na lhůtu registrace
    if (reminder.terms && !reminder.termsRead && (reminder.termsTries || 0) < this.cashbackTermsTries) return null;
    if (now < Math.max(reminder.boughtAt, reminder.registerFrom || 0)) return null;
    if (!reminder.notifiedOpen) return "open";
    if (until && !reminder.notifiedSoon && now >= until - this.cashbackSoonDays * this.dayMs) return "soon";
    return null;
  },

  // Další stupeň množstevní slevy kousek nad aktuálním počtem kusů (nejvýš o maxGap) – nápověda v košíku
  // „Přidejte 1 ks → 389 Kč/ks“. { from, add, unit, current, saving } (saving = za všechny kusy nového počtu)
  // nebo null, když žádný blízký výhodnější stupeň není
  getNextQuantityTier(tiers, lowest, quantity, maxGap = 2) {
    if (!tiers || !(lowest > 0) || !(quantity >= 1)) return null;
    const current = this.getQuantityUnitPrice(tiers, lowest, quantity);
    const next = tiers.find(([from, , price]) => from > quantity && from - quantity <= maxGap && price < current);
    if (!next) return null;
    const [from, , unit] = next;
    return { from, add: from - quantity, unit, current, saving: Math.round((current - unit) * from) };
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

  // Podezřelé ceny (možná chyba čtení): ukážou se s ikonou výstrahy a upozornění se pošle s ní – neschovají
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
    // Poškozený záznam (null, bez cen) nesmí shodit celý produkt
    (Array.isArray(entries) ? entries : []).filter((entry) => entry && typeof entry === "object").forEach((entry) => {
      entry.p = entry.p && typeof entry.p === "object" ? entry.p : {};
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
  // Sleva produktu ve výpisu kategorie (filtr v liště, category.js): nejnižší cena k zaplacení (i s AlzaPlus+
  // a slevovým kódem) proti obvyklé ceně z historie, bez ní (historie kratší než verdictMinDays) proti
  // přeškrtnuté ceně. Procenta dolů – filtr „aspoň 20 %“ nesmí pustit 19,6 %.
  // { percent, price, reference, source: "typical" | "strikethrough" | null, coupon } | null = bez ceny
  getListingDiscount(priceMap, entries = [], now = Date.now()) {
    const price = this.getPayNowPrice(priceMap);
    if (price === null) return null;
    const coupon = ["applus", "discount"].some((type) => typeof priceMap[type] === "number");
    const typical = entries.length > 0 ? (this.getPriceVerdict(entries, price, now)?.typical ?? null) : null;
    const strikethrough = priceMap.original > price ? priceMap.original : null;
    const reference = typical ?? strikethrough;
    const percent = reference > price ? Math.floor(((reference - price) / reference) * 100) : 0;
    return { percent, price, reference, source: typical !== null ? "typical" : strikethrough !== null ? "strikethrough" : null, coupon };
  },

  listingSelectors: {
    box: ".ads-pb, .price-box, .js-price-box",
    primaryPrice: ".js-price-box__primary-price__value, .ads-pb__price-value, .price-box__primary-price",
    comparePrice: ".js-compare-price, .ads-pb__original-price--strike, .price-box__compare-price", // přeškrtnutá cena
    nonMemberPrice: ".ads-pb__original-price:not(.ads-pb__original-price--strike)", // "Bez členství: 499,-" u ceny s AlzaPlus+
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

  // Dlaždice s množstevní slevou (ikona „Kup víc, zaplať míň“): cena „od 76,-“ je cena kusu v nejvyšším stupni
  // (3 a více ks), ne cena jednoho kusu – do historie nepatří, jinak by se střídala s cenou z detailu (89 → 76 → 89)
  listingQuantityDiscount: "[data-name='QuantityDiscount'], img[src*='buy-more-pay-less']",

  hasListingQuantityDiscount(item) {
    return Boolean(item?.querySelector(this.listingQuantityDiscount));
  },

  listingCouponTypes: { scrappage: "scrappage", applus: "applus", discountcode: "discount", discountcoupon: "discount", discountcouponpaywall: "discount" },
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

  // Ceny dlaždice pro filtr slev (ne do historie – typy cen se tam nemění): členovi AlzaPlus+ ukazuje Alza jeho cenu
  // jako hlavní ("-14 % S ALZAPLUS+") a cenu pro všechny jako "Bez členství: 499,-". Pro filtr typy jako u nečlena
  // (applus + original) – jinak by „Jen s kupónem“ i „Sleva aspoň X %“ členovi právě tyto produkty skryly
  getListingFilterPrices(item, prices = this.extractPricesFromListingItem(item)) {
    const header = this.getSpecialPriceText(item.querySelector(this.listingSelectors.priceHeader));
    if (!/alza\s*plus/.test(header) || typeof prices.special !== "number") return prices;
    const { special, ...rest } = prices;
    const nonMember = this.parsePrice(item.querySelector(this.listingSelectors.nonMemberPrice)?.textContent ?? "");
    return { ...rest, applus: special, ...(typeof rest.original !== "number" && nonMember > special && { original: nonMember }) };
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
    const step = this.domains[domainKey].currency === "€" ? 0.02 : 1;
    let withVat = 0;
    let withoutVat = 0;
    pairs.forEach(({ prices, entries }) => {
      const last = entries?.[entries.length - 1];
      if (!last || now - last.s > this.vatCompareMaxAgeDays * this.dayMs) return;
      const types = this.listingMainTypes.filter((type) => prices[type] !== undefined && last.p[type] !== undefined);
      if (types.length === 0) return;
      if (types.every((type) => prices[type] === last.p[type])) withVat++;
      // Tolerance zaokrouhlení DPH: krok měny (Kč a Ft celé, € centy), ne 1 € – jinak by běžná změna ceny vypadala jako cena bez DPH
      else if (types.every((type) => Math.abs(prices[type] * rate - last.p[type]) <= Math.max(step, last.p[type] * 0.002))) withoutVat++;
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

  // Oprava historie po chybě do 2026.11.8.10: výpis kategorie u produktů s množstevní slevou ukazuje „od 76,-“
  // (cena kusu v nejvyšším stupni) a ta se ukládala jako cena produktu. Smaže záznamy, jejichž cena z cenového
  // boxu (listingMainTypes) je cena nejvyššího stupně (pod cenou 1 ks) a které nemají cenu, jakou výpis neukazuje
  // (cashback… = záznam z detailu); kód nebo AlzaPlus+ shodou rovný stupni záznam nesmaže. Sousední záznamy se
  // stejnými cenami sloučí – jen se stejnou dostupností a bez změny názvu. Vrací počet smazaných
  removeQuantityTierEntries(entries, quantityTiers) {
    const tiers = this.getQuantityTiers({ quantityTiers });
    if (!tiers || !Array.isArray(entries)) return 0;
    const tierPrice = tiers[tiers.length - 1][2];
    if (!(tierPrice < tiers[0][2])) return 0;
    const listingTypes = new Set([...this.listingMainTypes, ...Object.values(this.listingCouponTypes)]);
    const before = entries.length;
    const kept = entries.filter((entry) => {
      const prices = Object.entries(entry?.p || {}).filter(([, value]) => typeof value === "number");
      const main = prices.filter(([type]) => this.listingMainTypes.includes(type)).map(([, value]) => value);
      const fromListing = prices.every(([type]) => listingTypes.has(type));
      return !(fromListing && main.length > 0 && Math.min(...main) === tierPrice);
    });
    if (kept.length === before) return 0;
    const same = (a, b) =>
      JSON.stringify(Object.entries(a.p).sort()) === JSON.stringify(Object.entries(b.p).sort()) &&
      (a.a ?? b.a) === (b.a ?? a.a) &&
      !b.n;
    const merged = [];
    kept.forEach((entry) => {
      const previous = merged[merged.length - 1];
      if (previous && same(previous, entry)) {
        previous.s = Math.max(previous.s, entry.s);
        previous.a ??= entry.a;
      } else merged.push(entry);
    });
    entries.splice(0, entries.length, ...merged);
    return before - kept.length;
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
    [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(imported) ? imported : [])].filter(Boolean).forEach((entry) => {
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
    const pattern = /(\d+(?:[   ]\d{3})*)\s*(?:ks|kusů|kusy|kus|db)(?!\p{L})/giu;
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

  // === Cena za parametr (výpisy kategorií, category.js) ===
  // Hlavní parametr produktu z popisku dlaždice: u úložišť a baterií ho Alza píše hned za druh zboží, ve všech
  // jazycích stejně – "SSD disk 4000 GB - M.2…", "SSD meghajtó 2000 GB-os tárolókapacitás - …", "Powerbanka
  // bezdrátová 20000 mAh - …", "Operační paměť - 2 × 16GB v balení", "Nabíjecí stanice - baterie LiFePo4
  // o kapacitě 288 Wh"; u pevných disků je kapacita jen v názvu ("Pevný disk - 3.5"…" + "WD Red Plus 4TB").
  // Jinde kapacita cenu neurčuje (telefon "256GB" v názvu, konzole "… - SSD 1024 GB") → null.
  // { quantity, unit, amount, amountUnit } – cena / quantity = cena za unit ("TB", "GB", "1000 mAh", "Wh");
  // amount + amountUnit = údaj z popisku ("4000" + "GB") do tooltipu
  parameterPatterns: {
    // Druh zboží bez číslic a pomlček, pak údaj; za jednotkou smí být maďarské "-os tárolókapacitás"
    headline: /^([^\d–-]{2,40}?)\s(\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?)\s?(TB|GB|mAh)(?:-\p{L}+)?(?:\s[^\d–,-]{1,30})?\s[–-]\s/u,
    type: /^([^\d–-]{2,40}?)\s[–-]\s/u,
    modules: /^[^\d–-]{2,40}?\s[–-]\s(\d+)\s?[×x]\s?(\d+(?:[.,]\d+)?)\s?GB(?![\p{L}\d])/iu, // "2 × 16GB v balení"
    energy: /^[^\d–-]{2,40}?\s[–-]\s[^,]*?(?<![\p{L}\d.,])(\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?)\s?Wh(?![\p{L}\d])/u, // do první čárky; ne "4" z "LiFePo4" ani "8" z "268.8"
    pack: /(?<![\d.,])\d+\s?(?:ks|kus[yů]?|db|pcs)(?![\p{L}\d])/iu, // "4 ks v balení" – cena za 1000 mAh jednoho článku by klamala
    nameCapacity: /(\d+(?:[.,]\d+)?)\s?(TB|GB)(?![\p{L}\d])/giu,
    disk: /dis[kc]|lemez|meghajt/iu, // Disky v Kč/TB, ostatní úložiště (flash disk, karta, RAM) v Kč/GB
    flash: /flash/iu,
    hardDisk: /^(pevný disk|merevlemez)$/iu, // Kapacita jen v názvu
    battery: /stanic|bat[eé]ri|töltőállomás|akkumul/iu, // Wh jen u nabíjecích stanic a baterií (ne elektrokola…)
  },

  getListingParameter(name, description) {
    const patterns = this.parameterPatterns;
    const text = String(description || "").replace(/\s+/g, " ").trim();
    const number = (value) => parseFloat(String(value).replace(/\s/g, "").replace(",", "."));
    // mAh a Wh: tečka / čárka před právě třemi číslicemi odděluje tisíce ("10.000 mAh"), jinak desetiny ("268.8 Wh")
    const whole = (value) => number(String(value ?? "").replace(/[.,](?=\d{3}$)/, ""));
    const storage = (type, amount, unit) => {
      const gigabytes = unit.toUpperCase() === "TB" ? amount * 1000 : amount;
      if (!(gigabytes > 0)) return null;
      const perTerabyte = patterns.disk.test(type) && !patterns.flash.test(type);
      return { quantity: perTerabyte ? gigabytes / 1000 : gigabytes, unit: perTerabyte ? "TB" : "GB", amount, amountUnit: unit.toUpperCase() };
    };

    const headline = text.match(patterns.headline);
    if (headline) {
      const [, type, value, unit] = headline;
      if (unit !== "mAh") return storage(type, number(value), unit);
      const amount = whole(value);
      if (patterns.pack.test(text)) return null;
      return amount > 0 ? { quantity: amount / 1000, unit: "1000 mAh", amount, amountUnit: "mAh" } : null;
    }

    const type = text.match(patterns.type)?.[1].trim();
    if (!type) return null;
    const modules = text.match(patterns.modules);
    if (modules) return storage(type, number(modules[1]) * number(modules[2]), "GB");
    if (patterns.battery.test(type)) {
      const amount = whole(text.match(patterns.energy)?.[1]);
      return amount > 0 ? { quantity: amount, unit: "Wh", amount, amountUnit: "Wh" } : null;
    }
    if (patterns.hardDisk.test(type)) {
      const capacity = [...String(name || "").matchAll(patterns.nameCapacity)].at(-1);
      return capacity ? storage(type, number(capacity[1]), capacity[2]) : null;
    }
    return null;
  },

  // "1 995 Kč/TB", "3,12 Kč/GB", "74,90 €/TB" – od stovky bez desetinných míst; pod 1 (€/GB u karet a flash disků)
  // víc míst, jinak by "0,074" a "0,084" bylo "0,07" a "0,08" a rozdíl 13 % by nebyl vidět
  formatParameterPrice(value, unit, domainKey) {
    const { currency, locale } = this.domains[domainKey] || this.domains.alza_cz;
    const digits = value >= 100 ? 0 : value >= 1 ? 2 : value >= 0.1 ? 3 : 4;
    return `${value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}/${unit}`;
  },

  // === Cena provozu (výpisy kategorií, category.js; volba energyCost) ===
  // Spotřeba z popisku dlaždice: lednice a mrazáky "roční spotřeba 140 kWh/rok" (i bez "/rok"), pračky a sušičky
  // "(váž.) spotřeba energie 33 kWh/100 cyklů" / "… kWh (na 100 cyklů)". Popisek se dvěma různými údaji (set pračka +
  // sušička, pračka se sušičkou "49 a 300 kWh / 100 cyklů") je nejednoznačný → null.
  // { kwh, per: "year" | "cycles" } – per cycles = na 100 cyklů
  energyPatterns: {
    year: /(\d+(?:[.,]\d+)?)\s?kWh\s?\/\s?(?:rok|annum|év)(?!\p{L})/giu,
    yearWord: /ro[čc]n[áíe]\s+spot[řr]eba\s+(?:energie\s+)?(\d+(?:[.,]\d+)?)\s?kWh(?![\p{L}/]|\s?\/)/giu,
    yearThousands: /(ro[čc]n[áíe]\s+spot[řr]eba\s+(?:energie\s+)?\d{1,3}) (\d{3})(?=\s?kWh)/giu,
    cycles: /(\d+(?:[.,]\d+)?)\s?kWh\s?(?:\/|\(na)\s?100\s?(?:cykl|cikl)/giu,
    pair: /\d\s*(?:\s(?:a|és|and)\s|\/)\s*\d+(?:[.,]\d+)?\s?kWh/iu, // "49 a 300 kWh", "49 / 300 kWh"
    set: /^\s*(?:set|szett)(?!\p{L})/iu, // Set pračka + sušička s jediným údajem – provoz jen jednoho spotřebiče by klamal
    // Hodnoty parametrů na detailu produktu (getDocumentEnergy): "140 kWh/annum", "33 kWh/100 c.", "75 kWh/1000h"
    valueYear: /^(\d+(?:[.,]\d+)?)\s?kWh\s?\/\s?(?:rok|annum|év)$/iu,
    valueCycles: /^(\d+(?:[.,]\d+)?)\s?kWh\s?\/\s?100\s?c/iu,
    valueHours: /^(\d+(?:[.,]\d+)?)\s?kWh\s?\/\s?1000\s?h/iu,
    hdr: /HDR/u, // Televize a monitory: počítá se běžný (SDR) režim, ne HDR
  },
  // Mimo rozsah = překlep v údajích Alzy (myčka „0,75 kWh/100 c.“ je spotřeba jednoho cyklu)
  energyLimits: { year: [20, 3000], cycles: [5, 1000], hours: [5, 2000] },
  daysPerYear: 365,
  weeksPerYear: 52,
  energyPriceKeys: { Kč: "energyPriceCZK", "€": "energyPriceEUR", Ft: "energyPriceHUF" }, // Nastavení ceny za kWh podle měny

  getListingEnergy(description) {
    const patterns = this.energyPatterns;
    // Mezera tisíců jen hned za "roční spotřeba" ("1 250 kWh" → "1250 kWh"); jinde by se k údaji přilepilo cizí číslo
    const text = String(description || "").replace(/\s+/g, " ").replace(patterns.yearThousands, "$1$2");
    if (patterns.pair.test(text) || patterns.set.test(text)) return null;
    const values = (pattern) => [...new Set([...text.matchAll(pattern)].map((match) => parseFloat(match[1].replace(",", "."))))];
    const year = [...new Set([...values(patterns.year), ...values(patterns.yearWord)])];
    const cycles = values(patterns.cycles);
    if (year.length + cycles.length !== 1) return null;
    const per = year.length ? "year" : "cycles";
    const kwh = year[0] ?? cycles[0];
    const [min, max] = this.energyLimits[per];
    return kwh >= min && kwh <= max ? { kwh, per } : null;
  },

  // Nastavení ceny provozu pro doménu: { enabled, price (za kWh v měně domény), years, cyclesPerWeek, hoursPerDay }.
  // Neplatné hodnoty (ruční úprava zálohy) = výchozí
  getEnergySettings(settings, domainKey) {
    const inRange = (key, min, max) => (Number(settings?.[key]) >= min && Number(settings[key]) <= max ? Number(settings[key]) : this.defaultSettings[key]);
    return {
      enabled: Boolean(settings?.energyCost),
      price: this.getEnergyPrice(settings, domainKey),
      years: inRange("energyYears", 1, 30),
      cyclesPerWeek: inRange("energyCyclesPerWeek", 1, 21),
      hoursPerDay: inRange("energyHoursPerDay", 0.5, 24),
    };
  },

  // Cena elektřiny za kWh v měně domény (nastavení energyPrice…; neplatná hodnota = výchozí)
  getEnergyPrice(settings, domainKey) {
    const key = this.energyPriceKeys[this.domains[domainKey]?.currency];
    const value = Number(settings?.[key]);
    return value > 0 ? value : this.defaultSettings[key];
  },

  // Spotřeba ze stránky produktu: popisek pod názvem (stejný text jako dlaždice výpisu), jinak parametry –
  // "Roční spotřeba energie… 140 kWh/annum", "Spotřeba energie (praní) 33 kWh/100 c.", u televizí a monitorů
  // "Spotřeba v SDR režimu 75 kWh/1000h" (per: "hours" = na 1000 hodin). Parametry jsou ve stránce i bez rozkliknutí.
  // Dva různé údaje stejného druhu (pračka se sušičkou) → null
  getDocumentEnergy(doc) {
    const description = doc.querySelector(".nameextc")?.textContent || "";
    const fromDescription = this.getListingEnergy(description);
    if (fromDescription) return fromDescription;
    const patterns = this.energyPatterns;
    if (patterns.set.test(description.replace(/\s+/g, " "))) return null;
    const found = { year: new Set(), cycles: new Set(), hours: new Set() };
    doc.querySelectorAll(".typeName").forEach((label) => {
      const row = label.closest(".row") || label.parentElement?.parentElement;
      const value = row?.querySelector(".value")?.textContent.replace(/\s+/g, " ").trim() || "";
      const read = (kind, pattern) => {
        const match = value.match(pattern);
        if (!match) return;
        const amount = parseFloat(match[1].replace(",", "."));
        // Myčky: Alza pod „kWh/100 c.“ vede spotřebu jednoho cyklu („0,75 kWh/100 c.“) – pod 5 kWh na 100 cyklů
        // žádný spotřebič nemá, je to tedy 75 kWh/100 cyklů
        found[kind].add(kind === "cycles" && amount < this.energyLimits.cycles[0] ? Math.round(amount * 1000) / 10 : amount);
      };
      read("year", patterns.valueYear);
      read("cycles", patterns.valueCycles);
      if (!patterns.hdr.test(label.textContent)) read("hours", patterns.valueHours);
    });
    const kinds = Object.entries(found).filter(([, values]) => values.size > 0);
    if (kinds.length !== 1 || kinds[0][1].size !== 1) return null;
    const [per, values] = kinds[0];
    const [kwh] = [...values];
    const [min, max] = this.energyLimits[per];
    return kwh >= min && kwh <= max ? { kwh, per } : null;
  },

  // Spotřeba a cena provozu: { yearlyKwh, yearly (cena za rok), cost (za years let) }. U praček a sušiček podle
  // počtu cyklů týdně (cyclesPerWeek), u televizí a monitorů podle hodin denně (hoursPerDay)
  getEnergyCost(energy, { price, years, cyclesPerWeek, hoursPerDay }) {
    const yearlyKwh =
      energy.per === "year"
        ? energy.kwh
        : energy.per === "hours"
          ? (energy.kwh / 1000) * hoursPerDay * this.daysPerYear
          : (energy.kwh / 100) * cyclesPerWeek * this.weeksPerYear;
    const yearly = yearlyKwh * price;
    return { yearlyKwh, yearly, cost: yearly * years };
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
