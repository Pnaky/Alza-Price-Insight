// Stránka nastavení – co se zálohuje a co smaže „Smazat všechna data“, kontrola importu zálohy (i rozsahy číselných
// nastavení), začernění veřejného hlášení chyby a souboru diagnostiky a čtení odpovědi na načtení Mých nákupů.
// Bez DOM, ať to jde testovat v Node (tests/options-i18n.test.js, tests/audit-2026-11-12-options.test.js). Načítá se
// za core.js, před options.js; vše je v jednom objektu (OptionsData), ať se názvy nepotkají s options.js
const OptionsData = (() => {
  const keys = AlzaCore.storageKeys;
  const { history: HISTORY_PREFIX, price: PRICE_PREFIX, legacyPrices: LEGACY_PRICES_PREFIX } = AlzaCore.storagePrefixes;
  const DOMAIN_KEYS = Object.keys(AlzaCore.domains).join("|"); // alza_cz|alza_sk|alza_hu

  // === Co se zálohuje a maže ===
  // Každý klíč AlzaCore.storageKeys je buď v záloze, nebo v NOT_BACKED_UP (hlídá test) – nový klíč se tak nezapomene

  // Klíče storageKeys v záloze (JSON). Připomínky cashbacku ano – lhůtu registrace už z Alzy znovu nezjistíme,
  // když akce skončí
  const BACKUP_KEYS = [keys.watchLists, keys.watchProducts, keys.targets, keys.browsed, keys.settings, keys.cashbackReminders];

  // Klíče mimo zálohu a proč
  const NOT_BACKED_UP = {
    [keys.purchases]: "nákupy – po obnově se znovu načtou z „Moje objednávky“ na Alze",
    [keys.purchasesSync]: "čas načtení objednávek – bez něj se objednávky načtou znovu",
    [keys.codes]: "slevové kódy – platí jen pár dní, doplní je další procházení",
    [keys.cashbacks]: "cashbacky viděné na detailu – doplní je další procházení",
    [keys.cashbackTerms]: "mezipaměť termínů akcí – načte se znovu",
    [keys.cleanups]: "jednorázové opravy dat, které už proběhly – patří k tomuto prohlížeči",
    [keys.cleanup]: "návrh čistky – přepočítá ho služba na pozadí",
    [keys.watchState]: "stav posledního běhu kontroly",
    [keys.watchLog]: "log běhů kontroly",
    [keys.errorLog]: "log chyb (diagnostika)",
    [keys.vatCheck]: "poslední ověření DPH – ověří se znovu",
    [keys.owned]: "Moje nákupy – koupené zboží se znovu načte z archivu objednávek na Alze",
    [keys.ownedOrders]: "Moje nákupy – přehled objednávek se znovu načte z Alzy",
    [keys.ownedSync]: "Moje nákupy – stav načítání archivu; bez něj se archiv načte znovu",
    [keys.news]: "viděné novinky – patří k tomuto prohlížeči",
  };

  // „Smazat všechna data“ nechá nastavení, log chyb (diagnostika, když se něco pokazí), záznam jednorázových
  // oprav (jinak by se spustily znovu na nová data) a viděné novinky. Všechno ostatní ze storageKeys se smaže
  const KEPT_ON_WIPE = [keys.settings, keys.errorLog, keys.cleanups, keys.news];
  const WIPE_KEYS = Object.values(keys).filter((key) => !KEPT_ON_WIPE.includes(key));

  // Záznam ceny po produktech (alzaPrice_<doména>_<id>); starý formát alzaPrices_<doména> jen z importu starších záloh
  const PRICE_KEY_PATTERN = new RegExp(`^${PRICE_PREFIX}(${DOMAIN_KEYS})_(.+)$`);
  const LEGACY_PRICES_KEY_PATTERN = new RegExp(`^${LEGACY_PRICES_PREFIX}(${DOMAIN_KEYS})$`);
  const HISTORY_KEY_PATTERN = new RegExp(`^${HISTORY_PREFIX}(${DOMAIN_KEYS})_(.+)$`);
  const BACKUP_KEY_PATTERN = new RegExp(
    `^(${LEGACY_PRICES_PREFIX}(${DOMAIN_KEYS})|${PRICE_PREFIX}(${DOMAIN_KEYS})_.+|${HISTORY_PREFIX}(${DOMAIN_KEYS})_.+|${BACKUP_KEYS.join("|")})$`
  );

  // Klíče ke smazání: produkty ze stažené zálohy (co mezitím přibylo, zůstane) a všechny klíče storageKeys kromě KEPT_ON_WIPE
  function getWipeKeys(backupData) {
    const products = Object.keys(backupData || {}).filter((key) => !Object.values(keys).includes(key));
    return [...new Set([...products, ...WIPE_KEYS])];
  }

  // === Kontrola importu ===

  const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const isOptionalString = (value) => value === undefined || value === null || typeof value === "string";
  const isKnownDomain = (domain) => AlzaCore.isKnownDomain(domain);
  // Čas ze zálohy: kladný a ne v budoucnosti (posunuté hodiny, ruční úprava) – jinak teď
  const isImportTime = (time, now = Date.now()) => Number.isFinite(time) && time > 0 && time <= now + AlzaCore.dayMs;
  const toImportTime = (time, now = Date.now()) => (isImportTime(time, now) ? time : now);
  // Obrázek produktu jen z Alzy – cizí adresa by se načetla v dialogu historie (sledovací pixel)
  const toImportImage = (image) => (AlzaCore.isAlzaImageUrl(image) ? image : null);
  // Adresa produktu na Alze, ke které patří doména záznamu (jinak špatná měna, kontrola na pozadí by spadla)
  const isProductOf = (item) =>
    isPlainObject(item) && AlzaCore.isAlzaUrl(item.url) && isKnownDomain(item.domain) && AlzaCore.getDomainKey(new URL(item.url).hostname) === item.domain;

  // Hlídané produkty, cílové ceny a procházené produkty: jen položky s adresou Alzy a doménou, která k adrese patří.
  // Klíč se složí znovu z domény a adresy – jinak by byl produkt hlídaný dvakrát (a "__proto__" by se tvářil jako položka)
  function sanitizeProductMap(value, requirePrice) {
    return Object.fromEntries(
      Object.values(value)
        .filter((item) => isProductOf(item) && isOptionalString(item.name) && isOptionalString(item.image) && (!requirePrice || Number.isFinite(item.price)))
        .map((item) => {
          const clean = { ...item, image: toImportImage(item.image) };
          ["since", "seenAt"].forEach((field) => {
            if (field in clean) clean[field] = toImportTime(clean[field]);
          });
          return [AlzaCore.getProductKey(item.domain, item.url), clean];
        })
    );
  }

  // Připomínky registrace cashbacku (storageKeys.cashbackReminders, tvar z AlzaCore.createCashbackReminder): jen známá
  // pole ve správném typu. Adresa produktu a obrázek z Alzy, podmínky akce jen stránka na Alze (otevírá se z popupu
  // a stahuje s cookies), nákup v minulosti; lhůty registrace bývají v budoucnosti – rozumně daleko
  const REMINDER_FLAGS = ["termsRead", "notifiedOpen", "notifiedSoon", "done", "outsidePromo"];
  const REMINDER_MAX_AHEAD_MS = 2 * 365 * AlzaCore.dayMs;
  function sanitizeCashbackReminders(value, now = Date.now()) {
    const toDeadline = (time) => (Number.isFinite(time) && time > 0 && time <= now + REMINDER_MAX_AHEAD_MS ? time : null);
    const toText = (text) => (typeof text === "string" && text.trim() ? text.slice(0, 500) : null);
    return Object.fromEntries(
      Object.values(value)
        .filter((item) => isProductOf(item) && isImportTime(item.boughtAt, now))
        .map((item) => {
          const clean = {
            url: item.url,
            domain: item.domain,
            name: toText(item.name),
            image: toImportImage(item.image),
            terms: AlzaCore.resolveCashbackTerms(item.terms, item.domain),
            title: toText(item.title),
            refund: Number.isFinite(item.refund) && item.refund > 0 ? item.refund : null,
            boughtAt: item.boughtAt,
            registerFrom: toDeadline(item.registerFrom),
            registerUntil: toDeadline(item.registerUntil),
            termsTries: Number.isInteger(item.termsTries) ? Math.min(Math.max(item.termsTries, 0), AlzaCore.cashbackTermsTries) : 0,
          };
          REMINDER_FLAGS.forEach((flag) => (clean[flag] = item[flag] === true));
          return [AlzaCore.getProductKey(item.domain, item.url), clean];
        })
    );
  }

  // Číselná nastavení: stejné rozsahy jako políčka formuláře (min / max v options.html – hlídá test); integer = celé
  // číslo (formulář zaokrouhluje). Cena elektřiny má jedno políčko pro tři nastavení (podle měny hlavní Alzy)
  const SETTING_RANGES = {
    minDropPercent: { min: 0, max: 99, integer: true },
    ...Object.fromEntries(Object.values(AlzaCore.energyPriceKeys).map((key) => [key, { min: 0.01, max: 99999 }])),
    energyYears: { min: 1, max: 30, integer: true },
    energyCyclesPerWeek: { min: 1, max: 21, integer: true },
    energyHoursPerDay: { min: 0.5, max: 24 },
  };

  // Hodnota jedné volby z importu / formuláře, nebo undefined (neznámá volba, špatný typ, mimo rozsah)
  function toSetting(key, setting) {
    const defaults = AlzaCore.defaultSettings;
    if (!Object.hasOwn(defaults, key) || typeof setting !== typeof defaults[key]) return undefined;
    const keep = (ok) => (ok ? setting : undefined);
    if (key === "notifyAvailability") return keep(["all", "inStock", "off"].includes(setting));
    if (key === "uiLanguage") return keep(["auto", ...AlzaCore.uiLanguages].includes(setting));
    if (key === "primaryDomain") return keep(setting === "auto" || Object.hasOwn(AlzaCore.domains, setting));
    if (key === "quietFrom" || key === "quietTo" || key === "checkTime") return keep(AlzaCore.timePattern.test(setting));
    if (key === "checkSchedule") return keep(Object.hasOwn(AlzaCore.checkSchedules, setting));
    if (typeof setting === "number") {
      if (!Number.isFinite(setting)) return undefined;
      const range = SETTING_RANGES[key];
      if (!range) return keep(setting >= 0);
      const number = range.integer ? Math.round(setting) : setting;
      return number >= range.min && number <= range.max ? number : undefined;
    }
    return setting;
  }

  // Z importovaného nastavení jen známé volby se správným typem a v rozsahu formuláře (zbytek zůstane podle
  // stávajícího / výchozího) – např. „energyYears: 500“ z ručně upravené zálohy se nepřevezme
  function sanitizeSettings(value) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, setting]) => [key, toSetting(key, setting)])
        .filter(([, setting]) => setting !== undefined)
    );
  }

  // === Hlášení chyby ===
  // Hlášení je veřejné – z chyb pryč adresy (zůstane jen doména, i u adres bez https:// – zdroj chyby z content scriptu
  // je „www.alza.cz/<adresa produktu>“), identifikátor instalace ve Firefoxu a v Safari a citlivé texty (slevové kódy,
  // názvy koupeného zboží – sensitive)
  function redactForReport(text, sensitive = []) {
    const result = String(text)
      .replace(/\b(moz|safari-web)-extension:\/\/[0-9a-f-]+/gi, "$1-extension://…")
      .replace(/^[0-9a-f]{8}-[0-9a-f-]{27}(?=\/)/i, "extension")
      .replace(/https?:\/\/[^\s)"']+/g, (match) => {
        try {
          return new URL(match).hostname;
        } catch {
          return "…";
        }
      })
      .replace(/\b((?:[\w-]+\.)*alza\.(?:cz|sk|hu))(?::\d+)?[/?#][^\s)"']*/gi, "$1");
    return createTextHider(sensitive)(result);
  }

  // Funkce, která z textu odstraní citlivé texty (aspoň 3 znaky). Delší napřed – kratší text uvnitř delšího by ho rozbil
  function createTextHider(sensitive) {
    const texts = [...new Set((Array.isArray(sensitive) ? sensitive : []).filter((item) => typeof item === "string" && item.trim().length >= 3).map((item) => item.trim()))].sort(
      (a, b) => b.length - a.length
    );
    return (text) => texts.reduce((result, item) => result.split(item).join("…"), String(text));
  }

  // Citlivé texty z úložiště pro redactForReport: slevové kódy a názvy koupeného zboží (hlídání po nákupu, připomínky
  // cashbacku, Moje nákupy). SENSITIVE_KEYS = klíče, které si volající musí z úložiště načíst
  const SENSITIVE_KEYS = [keys.codes, keys.purchases, keys.cashbackReminders, keys.owned];
  function getSensitiveTexts(all) {
    const values = (key) => (isPlainObject(all?.[key]) ? Object.values(all[key]).filter(isPlainObject) : []);
    return [
      ...values(keys.codes).map((entry) => entry.code),
      ...values(keys.purchases).map((entry) => entry.name),
      ...values(keys.cashbackReminders).flatMap((entry) => [entry.name, entry.title]),
      ...values(keys.owned).map((entry) => entry.name),
    ].filter((text) => typeof text === "string");
  }

  // === Diagnostika ===
  // Soubor pro autora (uživatel ho posílá sám). Co kdo koupil, v něm není jménem:
  //  - nové nákupy z objednávek (lists[] s orders: true) – zůstane jen počet,
  //  - produkt hlídaný jen kvůli nákupu (items[] s purchaseOnly: true) – název a adresa se nahradí zástupným textem;
  //    stav posledního běhu (changes, problems, recent…) příznak nenese, proto se v něm skryje stejný produkt
  //    (podle klíče produktu z adresy),
  //  - z logu chyb pryč číslo objednávky (zdroj chyby ze stránky detailu objednávky) a citlivé texty (sensitive –
  //    slevové kódy a názvy koupeného zboží z getSensitiveTexts); adresy v chybách zůstávají, podle nich se chyba hledá.
  // Vrací { watchLog (celý, od nejnovějšího), watchState, errors }
  const PURCHASED_NAME = "(koupené zboží)";
  const HIDDEN_TEXT = "(skryto)";

  function redactDiagnostics({ watchLog, watchState, errors, sensitive } = {}) {
    const list = (value) => (Array.isArray(value) ? value : []);
    const isText = (value) => typeof value === "string" && value.length >= 3;
    const toKey = (url) => {
      try {
        return AlzaCore.getProductKey(AlzaCore.getDomainKey(new URL(url).hostname), url);
      } catch {
        return null;
      }
    };
    const runs = list(watchLog).filter(isPlainObject);
    const isPurchaseOnly = (item) => isPlainObject(item) && item.purchaseOnly === true;
    const hiddenKeys = new Set(
      runs
        .flatMap((run) => list(run.items))
        .filter(isPurchaseOnly)
        .map((item) => toKey(item.url))
        .filter(Boolean)
    );
    const isHidden = (item) => isPurchaseOnly(item) || (isPlainObject(item) && (hiddenKeys.has(item.key) || (isText(item.url) && hiddenKeys.has(toKey(item.url)))));

    // Název a adresa pryč i z textů položky (řádky změn, problém)
    const hideItem = (item) => {
      const secrets = [item.name, item.url].filter(isText).sort((a, b) => b.length - a.length);
      const clean = (value) => {
        if (Array.isArray(value)) return value.map(clean);
        return typeof value === "string" ? secrets.reduce((text, secret) => text.split(secret).join("…"), value) : value;
      };
      const result = Object.fromEntries(Object.entries(item).map(([field, value]) => [field, clean(value)]));
      Object.assign(result, { name: PURCHASED_NAME, url: HIDDEN_TEXT });
      if ("key" in result) result.key = HIDDEN_TEXT;
      if ("image" in result) result.image = null;
      return result;
    };
    const hideItems = (items) => items.map((item) => (isHidden(item) ? hideItem(item) : item));
    // Nové nákupy: jen počty (added / removed jsou názvy)
    const hideOrders = (entry) => {
      if (!isPlainObject(entry) || entry.orders !== true) return entry;
      return Object.fromEntries(Object.entries(entry).filter(([field]) => field !== "added" && field !== "removed"));
    };

    const state = isPlainObject(watchState)
      ? Object.fromEntries(
          Object.entries(watchState).map(([field, value]) => {
            if (!Array.isArray(value)) return [field, value];
            // unseen = klíče produktů, ostatní pole = položky s názvem a adresou
            return [field, value.map((item) => (typeof item === "string" ? (hiddenKeys.has(item) ? HIDDEN_TEXT : item) : isHidden(item) ? hideItem(item) : item))];
          })
        )
      : null;

    const hideSensitive = createTextHider(sensitive);
    const hideOrderNumber = (text) => (typeof text === "string" ? hideSensitive(text.replace(/(order-details-)\d+/gi, "$1…")) : text);
    return {
      watchLog: runs.map((run) => ({
        ...run,
        ...(Array.isArray(run.items) ? { items: hideItems(run.items) } : {}),
        ...(Array.isArray(run.lists) ? { lists: run.lists.map(hideOrders) } : {}),
      })),
      watchState: state,
      errors: list(errors).map((entry) => (isPlainObject(entry) ? { ...entry, source: hideOrderNumber(entry.source), message: hideOrderNumber(entry.message) } : entry)),
    };
  }

  // === Moje nákupy: odpověď služby na pozadí na „Načíst nové nákupy“ (zpráva ownedSync) ===
  // result = { status: "off" | "done" | "error", error?, domains: { "<doména>": { status: "synced" (+ blocked: true,
  // když Alza načítání odmítla a dávka skončila dřív) | "skipped" (nic k načtení) | "off" (volba vypnutá / nákupy
  // smazané během načítání) | "noLogin" | "error" (+ error), … } } }, nebo nic (služba na pozadí neodpověděla).
  // Vrací, co stránce říct:
  //   noReply – žádná odpověď, off – volba je vypnutá, error – načtení se nepovedlo ({ domain, error }),
  //   noLogin – nikde nic načteného ani přeskočeného a aspoň jedna Alza bez přihlášení, retry – odpověď bez domén,
  //   synced – načteno, nebo nebylo co načítat ({ synced: [výsledky načtených domén – u samých „skipped“ prázdné],
  //     failure: { domain, error } | null – část se nepovedla, blocked: doména, kde Alza načítání odmítla | null })
  function readOwnedSync(result) {
    if (!isPlainObject(result)) return { state: "noReply" };
    if (result.status === "off") return { state: "off" };
    if (result.status === "error") return { state: "error", domain: null, error: String(result.error || "") };
    const domains = Object.entries(isPlainObject(result.domains) ? result.domains : {}).filter(([, domain]) => isPlainObject(domain));
    const withStatus = (status) => domains.filter(([, domain]) => domain.status === status);
    if (withStatus("off").length > 0) return { state: "off" };
    const synced = withStatus("synced");
    const failed = withStatus("error")[0];
    const failure = failed ? { domain: failed[0], error: String(failed[1].error || "") } : null;
    if (synced.length + withStatus("skipped").length > 0) {
      const blocked = synced.find(([, domain]) => domain.blocked === true)?.[0] ?? null;
      return { state: "synced", synced: synced.map(([, domain]) => domain), failure, blocked };
    }
    if (failure) return { state: "error", ...failure };
    return { state: withStatus("noLogin").length > 0 ? "noLogin" : "retry" };
  }

  return {
    BACKUP_KEYS,
    NOT_BACKED_UP,
    KEPT_ON_WIPE,
    WIPE_KEYS,
    PRICE_KEY_PATTERN,
    LEGACY_PRICES_KEY_PATTERN,
    HISTORY_KEY_PATTERN,
    BACKUP_KEY_PATTERN,
    getWipeKeys,
    isPlainObject,
    isOptionalString,
    isKnownDomain,
    toImportTime,
    toImportImage,
    sanitizeProductMap,
    sanitizeCashbackReminders,
    SETTING_RANGES,
    sanitizeSettings,
    redactForReport,
    SENSITIVE_KEYS,
    getSensitiveTexts,
    redactDiagnostics,
    readOwnedSync,
  };
})();

globalThis.OptionsData = OptionsData;
