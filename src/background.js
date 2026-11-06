// Služba na pozadí: podle nastavení (výchozí jednou za hodinu, nejméně jednou denně) postupně projde produkty hlídaných seznamů a produkty s cílovou
// cenou, zapíše kontrolu do historie a při změně (pokles ceny, nová akce, dostupnost, dosažení cílové
// ceny) pošle notifikaci podle nastavení. Stránku produktu stahuje a parsuje ProductPages – každý
// prohlížeč má vlastní (src/chrome/, src/firefox/), načtený před tímto souborem spolu s core.js.

const WATCH_LISTS_KEY = AlzaCore.storageKeys.watchLists; // { "<doména>|<listId>": { domain, listId, name, url, since, syncedAt, products: { url: { name, image } } } }
const WATCH_PRODUCTS_KEY = AlzaCore.storageKeys.watchProducts;
const TARGETS_KEY = AlzaCore.storageKeys.targets;
// Stav posledního běhu pro popup; pendingNotifications = změny odložené v tichých hodinách,
// unseen = klíče produktů ("<doména>_<id>") se změnou od posledního otevření popupu/seznamu (číslo na ikoně)
const WATCH_STATE_KEY = AlzaCore.storageKeys.watchState;
// Log běhů, nejnovější první: [{ start, end, trigger, total, skipped, aborted, offline,
//   items: [{ name, url, lines: ["Benefit: …"], problem }] }] – items = zkontrolované produkty
const WATCH_LOG_KEY = AlzaCore.storageKeys.watchLog;
const CLEANUP_KEY = AlzaCore.storageKeys.cleanup;
const ALARM_NAME = "alzaWatchRun";

const config = {
  missedRunDelayMs: 5 * 60 * 1000, // Zmeškaná denní kontrola (prohlížeč byl ve zvolený čas zavřený) proběhne po 5 min
  minCheckAgeMs: 30 * 60 * 1000, // Produkt zkontrolovaný (i stránkou seznamu) před méně než 30 min se přeskočí
  delayBetweenProductsMs: 4000, // Rozestup mezi produkty, ať Alza nedostane dávku požadavků najednou
  fetchRetryDelayMs: 5000,
  problemNotifyIntervalMs: 6 * 60 * 60 * 1000, // Problém se znovu ohlásí nejdřív po 6 h (v popupu je vidět vždy)
  maxIndividualNotifications: 3, // Do tohoto počtu změn vlastní notifikace pro každý produkt, nad ním souhrn
  maxNameLength: 32, // Názvy z Alzy bývají dlouhé – v souhrnu se zkracují
  notificationImageSize: 128, // Obrázek produktu jako ikona notifikace (px)
  recentChangesMax: 20, // Přehled změn v popupu
  logMaxRuns: 50,
  maxPendingNotifications: 50,
  cleanupRecountMs: 60 * 60 * 1000,
};

let running = false;

// Služba na pozadí je jediný zapisovatel do storage (AlzaStore): content scripty, popup i nastavení posílají
// operace zprávou. Read-modify-write stavu a logu tady jde přes stejnou frontu (withStateLock)
AlzaStore.isWriter = true;
const withStateLock = (task) => AlzaStore.exclusive(task);

// Jako první ve frontě: převod starého formátu uložených cen (alzaPrices_<doména> → záznam za produkt)
const storeReady = AlzaStore.exclusive(() => AlzaStore.migrate())
  .then((count) => count > 0 && console.info(`Uložené ceny převedeny na záznamy po produktech: ${count}`))
  .catch((error) => console.error("Převod uložených cen se nepodařil:", error));

// Service worker může Chrome ukončit i uprostřed běhu – uložené running: true by pak v popupu
// navždy ukazovalo "Probíhá kontrola". Po startu workeru žádný běh neprobíhá.
const staleRunReset = (async () => {
  await storeReady;
  const seed = (await getState()).recent ? null : await seedRecentFromLog();
  await withStateLock(async () => {
    const state = await getState();
    if (state.running || seed) await saveState({ ...state, running: false, ...(seed && { recent: seed }) });
  });
  // Číslo na ikoně se po restartu prohlížeče ztratí. Návrh čistky čte celé storage – při častém probouzení
  // workeru (alarm, zprávy ze záložek) ho přepočítat nejvýš jednou za cleanupRecountMs, jinak jen ikona
  const { [CLEANUP_KEY]: cleanup } = await chrome.storage.local.get(CLEANUP_KEY);
  if (Date.now() - (cleanup?.checkedAt || 0) >= config.cleanupRecountMs) await updateCleanup();
  else await updateBadge((await getState()).unseen);
})().catch((error) => console.error("Stav po startu se nepodařilo obnovit:", error)); // Jinak by každý běh skončil na await

// === Plánování ===

// Kontrola podle nastavení: každých N hodin (opakovaný alarm), nebo jednou denně ve zvolený čas (jednorázový
// alarm – po spuštění se naplánuje další, takže drží místní čas i přes změnu letního času).
// reset = změnilo se nastavení / denní alarm právě proběhl: naplánovat znovu, bez dohánění
async function ensureAlarm({ reset = false } = {}) {
  const settings = await AlzaCore.getSettings();
  const alarm = await chrome.alarms.get(ALARM_NAME);
  const period = AlzaCore.getCheckPeriodMinutes(settings);
  if (period) {
    if (!reset && alarm?.periodInMinutes === period) return;
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 5, periodInMinutes: period });
    return;
  }
  const { next, previous } = AlzaCore.getDailyRunTimes(settings.checkTime, Date.now());
  // Naplánovaný denní (i dohánějící) alarm nechat – každé probuzení workeru by ho jinak odsunulo
  if (!reset && alarm && !alarm.periodInMinutes && alarm.scheduledTime <= next) return;
  // Ve zvolený čas byl prohlížeč zavřený (Firefox alarmy po restartu nedrží) – dohnat hned po startu
  const missed = !reset && ((await getState()).lastRunEnd || 0) < previous;
  await chrome.alarms.create(ALARM_NAME, { when: missed ? Date.now() + config.missedRunDelayMs : next });
}

// Volání po sobě – start workeru a právě proběhlý denní alarm se nesmí přepsat v opačném pořadí
let alarmQueue = Promise.resolve();
function scheduleAlarm(options) {
  alarmQueue = alarmQueue.then(() => ensureAlarm(options)).catch((error) => console.error("Alarm se nepodařilo nastavit:", error));
  return alarmQueue;
}

// Kód na nejvyšší úrovni běží při každém startu workeru – i po instalaci a spuštění prohlížeče
scheduleAlarm();

// Změna frekvence nebo času kontroly v nastavení
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[AlzaCore.storageKeys.settings];
  if (area !== "local" || !change) return;
  const before = { ...AlzaCore.defaultSettings, ...change.oldValue };
  const after = { ...AlzaCore.defaultSettings, ...change.newValue };
  if (before.checkSchedule !== after.checkSchedule || before.checkTime !== after.checkTime) scheduleAlarm({ reset: true });
});

// Po instalaci (ne po aktualizaci) ukázat, jak rozšíření používat
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.tabs.create({ url: AlzaCore.getHelpUrl() });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  if (!alarm.periodInMinutes) scheduleAlarm({ reset: true }); // Denní kontrola: naplánovat zítřejší
  runWatch({ force: false, trigger: "alarm" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Zápis do storage z content scriptu, popupu nebo nastavení (AlzaStore.run)
  if (AlzaStore.handleMessage(message, sendResponse)) return true;
  // Stránka produktu pro otevřený seznam (content.js) – stažení a rozbor mimo hlavní vlákno stránky
  if (message?.action === "fetchProductPage") {
    withProductPages(() => ProductPages.fetch(message.url))
      .then(sendResponse, (error) => sendResponse({ ok: false, status: 0, error: String(error?.message || error) }));
    return true;
  }
  if (message?.action === "watchTestNotifications") {
    sendTestNotifications().catch((error) => console.error("Zkušební notifikace se nepodařilo odeslat:", error));
    return;
  }
  // Nastavení po smazání dat / popup po odložení návrhu čistky
  if (message?.action === "cleanupRefresh") {
    updateCleanup().catch((error) => console.error("Návrh čistky se nepodařilo přepočítat:", error));
    return;
  }
  if (message?.action === "watchSeen") {
    markSeen(Array.isArray(message.keys) ? message.keys : null).catch((error) => console.error("Viděné změny se nepodařilo uložit:", error));
    return;
  }
  if (message?.action !== "watchRunNow") return;
  runWatch({ force: true, trigger: "manual" });
});

// Cíl kliknutí – klíč za notifikaci, ať se souběžné vytvoření a zavření více notifikací nepřepisují
const notifyTargetKey = (notificationId) => `notifyTarget_${notificationId}`;

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const key = notifyTargetKey(notificationId);
  const { [key]: url } = await chrome.storage.session.get(key);
  if (AlzaCore.isAlzaUrl(url)) chrome.tabs.create({ url });
  chrome.notifications.clear(notificationId);
});

// Cíle zavřených notifikací už nejsou potřeba
chrome.notifications.onClosed.addListener((notificationId) => chrome.storage.session.remove(notifyTargetKey(notificationId)));

// === Stránka produktu ===

// ProductPages (v Chromu offscreen dokument) sdílí kontrola na pozadí a otevřené seznamy – zavře se, až ho
// nepotřebuje nikdo
const productPagesUse = { users: 0, opening: null, closing: null };

async function acquireProductPages() {
  productPagesUse.users++;
  await productPagesUse.closing;
  productPagesUse.opening ??= ProductPages.open();
  await productPagesUse.opening;
}

async function releaseProductPages() {
  if (--productPagesUse.users > 0) return;
  productPagesUse.opening = null;
  productPagesUse.closing = ProductPages.close().finally(() => (productPagesUse.closing = null));
  await productPagesUse.closing;
}

async function withProductPages(task) {
  await acquireProductPages();
  try {
    return await task();
  } finally {
    await releaseProductPages();
  }
}

// Jeden pokus navíc jen u přechodné chyby (síť, timeout, 429, 5xx) – 404 ani přesměrování opakování nespraví
async function fetchProduct(url) {
  let result = await ProductPages.fetch(url);
  if (!result?.ok && AlzaCore.isRetryableFetchError(result || {})) {
    await sleep(config.fetchRetryDelayMs);
    result = await ProductPages.fetch(url);
  }
  return result || { ok: false, status: 0, error: "no response" };
}

// === Běh kontroly ===

async function runWatch({ force, trigger }) {
  if (running) return;
  running = true;

  let state;
  try {
    await staleRunReset;
    state = await withStateLock(async () => {
      const current = await getState();
      const started = { ...current, lastRunStart: Date.now(), running: true };
      await saveState(started);
      return started;
    });
  } catch (error) {
    // Bez uloženého stavu běh nezačne – zámek uvolnit, jinak by se další běhy nespustily
    console.error("Kontrolu se nepodařilo zahájit:", error);
    running = false;
    return;
  }

  const changes = []; // { ...product, changes: [{ kind, text, … }] }
  const problems = [];
  const log = { start: state.lastRunStart, trigger, total: 0, skipped: 0, aborted: false, offline: false, items: [] };
  const targetUpdates = {};
  let checked = 0;
  let productPagesAcquired = false;

  try {
    const products = await getWatchedProducts();
    log.total = products.length;
    if (products.length === 0) return;
    if (!navigator.onLine) {
      log.offline = true;
      return;
    }

    const { [TARGETS_KEY]: targets = {} } = await chrome.storage.local.get(TARGETS_KEY);
    await acquireProductPages();
    productPagesAcquired = true;

    for (const product of products) {
      const outcome = await checkProduct(product, force, targets, targetUpdates).catch((error) => ({
        problem: AlzaCore.translate(product.textLang, "notifyProblemFetch", error?.message || error),
      }));
      const lines = (outcome.changes || []).map((change) => change.text);
      // Nejaktuálnější název ze stránky / historie – v seznamu může být uložený starší (s jinou akcí)
      const name = outcome.name || product.name;
      if (outcome.changes?.length) {
        changes.push({ ...product, name, image: outcome.image || product.image, price: outcome.price ?? null, changes: outcome.changes });
      }

      if (outcome.skipped) {
        log.skipped++;
        // Cílovou cenu mohla zachytit stránka seznamu – ohlásit i bez nové kontroly
        if (lines.length) log.items.push({ name, url: product.url, lines, problem: null });
        continue;
      }

      checked++;
      if (outcome.problem) problems.push({ ...product, lang: product.textLang, name, message: outcome.problem });
      log.items.push({ name, url: product.url, lines, problem: outcome.problem || null });

      // Bez přihlášení by stejně selhaly všechny produkty – zbytečně nezatěžovat Alzu
      if (outcome.abort) {
        log.aborted = true;
        break;
      }

      await sleep(config.delayBetweenProductsMs);
    }
  } catch (error) {
    console.error("Chyba při kontrole hlídaných seznamů:", error);
    problems.push({ name: "–", url: null, lang: "cz", message: String(error?.message || error) });
    log.items.push({ name: "–", url: null, lines: [], problem: String(error?.message || error) });
  } finally {
    // Zámek se uvolní vždy – jinak by popup ukazoval "Probíhá kontrola" a další běhy by se
    // nespustily až do restartu workeru
    try {
      await finishRun({ state, log, checked, changes, problems, targetUpdates, force, productPagesAcquired });
    } catch (error) {
      console.error("Chyba při dokončení kontroly:", error);
      await withStateLock(async () => saveState({ ...(await getState()), running: false, lastRunEnd: Date.now() })).catch(() => {});
    } finally {
      running = false;
    }
  }
}

async function finishRun({ state, log, checked, changes, problems, targetUpdates, force, productPagesAcquired }) {
  if (productPagesAcquired) await releaseProductPages();
  await saveTargetStates(targetUpdates);

  state.running = false;
  state.lastRunEnd = Date.now();
  state.checked = checked;
  state.changes = changes.map(({ name, url, changes }) => ({ name, url, lines: changes.map((change) => change.text) }));
  state.problems = problems.map(({ name, url, message }) => ({ name, url, message }));

  // V tichých hodinách se notifikace odkládají, problémy se ohlásí až po nich (pokud trvají)
  const settings = await AlzaCore.getSettings();
  const notifiable = filterNotifications(changes, settings);
  const pending = mergeNotifications([...(state.pendingNotifications || []), ...notifiable]);

  // Stav uložit před notifikacemi – selhání notifikace ani stahování obrázků ho nesmí zablokovat
  // a "viděno" z popupu během odesílání se už nepřepíše
  const quiet = AlzaCore.isQuietTime(settings);
  state.pendingNotifications = quiet ? pending.slice(-config.maxPendingNotifications) : [];
  const notifyProblemsNow =
    !quiet && problems.length > 0 && (force || Date.now() - (state.lastProblemNotifiedAt || 0) >= config.problemNotifyIntervalMs);
  if (notifyProblemsNow) state.lastProblemNotifiedAt = Date.now();

  await withStateLock(async () => {
    // Číslo na ikoně i v tichých hodinách. Seznam viděných se mohl během běhu změnit (popup) – číst znovu
    const current = await getState();
    const unseen = current.unseen || [];
    state.unseen = [...new Set([...unseen, ...notifiable.map(({ url, domain }) => AlzaCore.getProductKey(domain, url))])];
    // Přehled v popupu i se zdražením (bez čísla na ikoně a notifikace)
    state.recent = addRecentChanges(current.recent, filterNotifications(changes, settings, { withRises: true }), unseen, state.lastRunEnd);
    await saveState(state);
  });
  if (log.total > 0) await appendLog({ ...log, end: state.lastRunEnd });

  try {
    await updateCleanup(); // Nastaví i číslo na ikoně
    if (!quiet) await notifyChanges(pending);
    if (notifyProblemsNow) await notifyProblems(problems);
  } catch (error) {
    console.error("Chyba při odesílání notifikací:", error);
  }
}

// Produkty všech hlídaných seznamů, hlídané produkty z detailu a produkty s cílovou cenou bez duplicit
// (produkt může být ve více seznamech a pokaždé s trochu jinou adresou – porovnává se číslo produktu)
async function getWatchedProducts() {
  const {
    [WATCH_LISTS_KEY]: lists = {},
    [WATCH_PRODUCTS_KEY]: watchedProducts = {},
    [TARGETS_KEY]: targets = {},
  } = await chrome.storage.local.get([WATCH_LISTS_KEY, WATCH_PRODUCTS_KEY, TARGETS_KEY]);
  const settings = await AlzaCore.getSettings();
  const products = new Map();
  const add = (url, name, domain, listUrl, image, list = null) => {
    const key = AlzaCore.getProductKey(domain, url);
    if (products.has(key) || !AlzaCore.isAlzaUrl(url) || !AlzaCore.isKnownDomain(domain)) return;
    // lang = jazyk domény (čtení stránky a historie), textLang = jazyk textů notifikací (volba v nastavení)
    const lang = AlzaCore.domains[domain].lang;
    const textLang = AlzaCore.getDisplayLanguage(settings, lang);
    products.set(key, { url, name: name || url, image, domain, lang, textLang, listUrl, listName: list?.name || null, listId: list?.listId ?? null });
  };

  Object.values(lists).forEach((list) => {
    Object.entries(list?.products || {}).forEach(([url, info]) => add(url, info?.name, list.domain, list.url, info?.image, list));
  });
  // Poškozená položka (null) nesmí shodit celý běh
  Object.values(watchedProducts).forEach((product) => product && add(product.url, product.name, product.domain, product.url, product.image));
  Object.values(targets).forEach((target) => target && add(target.url, target.name, target.domain, target.url, target.image));

  return [...products.values()];
}

// Stav cílové ceny (je pod hranicí?) zapsat až na konci běhu – mezitím ji mohl uživatel změnit
// nebo zrušit, takže se zapíše jen k nezměněné cílové ceně
async function saveTargetStates(updates) {
  if (Object.keys(updates).length === 0) return;
  await withStateLock(async () => {
    const { [TARGETS_KEY]: targets = {} } = await chrome.storage.local.get(TARGETS_KEY);
    let changed = false;
    Object.entries(updates).forEach(([key, { price, below }]) => {
      if (targets[key]?.price !== price) return;
      targets[key].below = below;
      changed = true;
    });
    if (changed) await chrome.storage.local.set({ [TARGETS_KEY]: targets });
  });
}

function checkTarget(product, priceMap, targets, targetUpdates) {
  const key = AlzaCore.getProductKey(product.domain, product.url);
  const target = targets[key];
  if (!target) return null;

  const lowest = AlzaCore.getLowestPrice(priceMap);
  const { below, reached } = AlzaCore.evaluateTarget(target, lowest);
  if (below !== Boolean(target.below)) {
    target.below = below;
    targetUpdates[key] = { price: target.price, below };
  }
  if (!reached) return null;

  // U cíle za kus i cena za kus ("2,50 Kč/ks (900 Kč)")
  const format = (price) => AlzaCore.formatTargetValue(price, target, product.domain, product.textLang);
  return { kind: "target", text: AlzaCore.translate(product.textLang, "notifyTargetReached", format(target.price), format(lowest)) };
}

async function checkProduct(product, force, targets, targetUpdates) {
  const { url, domain, lang } = product;
  const textLang = product.textLang || lang;
  const historyKey = AlzaCore.getHistoryKey(domain, url);
  const priceKey = AlzaCore.getPriceKey(domain, url);

  const stored = await chrome.storage.local.get(historyKey);
  const before = AlzaCore.normalizeHistory(stored[historyKey], lang);
  const last = before[before.length - 1];

  if (!force && last && Date.now() - last.s < config.minCheckAgeMs) {
    const target = checkTarget(product, last.p, targets, targetUpdates);
    const changes = target ? [target, ...describeSuspicious(before, last.p, product)] : [];
    return { skipped: true, changes, price: AlzaCore.getLowestPrice(last.p), name: AlzaCore.getLatestName(before) };
  }

  const result = await fetchProduct(url);
  if (!result.ok) return { problem: AlzaCore.translate(textLang, "notifyProblemFetch", result.error) };

  // Ověření DPH pro stránky bez jeho znaku (homepage – browsing.js). getSaveProblem ověřuje DPH jen u produktu s cenou
  const vatChecked = result.saveProblem === "notifyProblemWithoutVat" ? false : !result.saveProblem && AlzaCore.getPriceEntries(result.prices || {}).length > 0 ? true : null;
  if (vatChecked !== null) await AlzaCore.recordVatCheck(domain, vatChecked).catch((error) => console.error("Ověření DPH se nepodařilo uložit:", error));

  // Ceny se smí zapsat jen za přihlášeného uživatele a s DPH. Obojí je nastavení účtu,
  // takže by selhaly i další produkty – běh se přeruší
  if (result.saveProblem) return { problem: AlzaCore.translate(textLang, result.saveProblem), abort: true };

  if (!result.isProduct) return { problem: AlzaCore.translate(textLang, "notifyProblemNotProduct") };

  const hasPrices = AlzaCore.getPriceEntries(result.prices).length > 0;
  const availability = AlzaCore.classifyAvailability(result.availability, lang);
  if (!hasPrices && availability === null) return { problem: AlzaCore.translate(textLang, "notifyProblemNoData") };

  const snapshot = AlzaCore.toPriceMap(result.prices);
  const changes = describeChanges(last, snapshot, availability, product);
  const target = checkTarget(product, snapshot, targets, targetUpdates);
  if (target) changes.push(target);

  // Zápis přes frontu úložiště – historii mezitím mohla zapsat otevřená stránka seznamu. Záznam ceny před
  // sloučením je potřeba jen pro první záznam historie
  const { [priceKey]: previousRecord } = await chrome.storage.local.get(priceKey);
  const entries = await AlzaStore.run({
    type: "appendHistory",
    domain,
    lang,
    url,
    prices: result.prices,
    availability,
    previousRecord,
    name: result.name,
  });
  // Podezřelá cena (možná chyba čtení) se ohlásí spolu se změnou – neschovává se, ať se neztratí skutečná sleva
  if (changes.length > 0) changes.push(...describeSuspicious(entries, snapshot, product));

  // I záznam ceny – otevřený seznam pak čerstvě zkontrolované ceny znovu nestahuje (mezipaměť 15 min)
  if (hasPrices) await AlzaStore.run({ type: "mergePrices", domain, records: { [url]: result.prices }, listId: product.listId });

  return {
    changes,
    image: result.image,
    name: result.name,
    price: AlzaCore.getLowestPrice(snapshot),
    problem: availability === null ? AlzaCore.translate(textLang, "notifyProblemNoAvailability") : null,
  };
}

// Výstrahy k podezřelým cenám (AlzaCore.getSuspiciousPrices) jako změny { kind: "suspicious", text }
function describeSuspicious(entries, priceMap, { domain, lang, textLang }) {
  return AlzaCore.getSuspiciousPrices(entries, priceMap).map((item) => ({
    kind: "suspicious",
    text: AlzaCore.formatSuspiciousPrice(textLang || lang, item, domain),
  }));
}

// Pokles / zdražení kterékoli ceny, nový typ ceny (akce, kód, cashback…) a změna dostupnosti oproti poslední
// kontrole jako [{ kind: drop|rise|new|availability, text, percent?, to? }]. Zdražení se neoznamuje –
// jen přehled změn v popupu a log
// Texty v jazyce textLang (volba v nastavení), jinak v jazyce domény
function describeChanges(last, snapshot, availability, { domain, lang: domainLang, textLang }) {
  if (!last) return [];
  const lang = textLang || domainLang;

  const changes = [];
  const hadPrices = Object.keys(last.p).length > 0;
  const format = (price) => AlzaCore.formatPrice(price, domain);

  Object.entries(snapshot).forEach(([type, price]) => {
    const previous = last.p[type];
    const label = AlzaCore.translate(lang, `type_${type}`);

    if (previous !== undefined && price < previous) {
      const percent = ((previous - price) / previous) * 100;
      const text = AlzaCore.formatPriceDrop(lang, label, previous, price, domain);
      changes.push({ kind: "drop", percent: Math.round(percent), text });
    } else if (previous !== undefined && price > previous) {
      changes.push({ kind: "rise", text: AlzaCore.formatPriceRise(lang, label, previous, price, domain) });
    } else if (previous === undefined && (type !== "original" || !hadPrices)) {
      changes.push({ kind: "new", text: AlzaCore.translate(lang, "notifyNewPrice", label, format(price)) });
    }
  });

  // Jen známé kódy – neznámý text dostupnosti by mezi seznamem a detailem mohl "blikat"
  const known = AlzaCore.availabilityCodes;
  if (known.includes(last.a) && known.includes(availability) && last.a !== availability) {
    changes.push({
      kind: "availability",
      to: availability,
      text: AlzaCore.translate(lang, "notifyAvailability", AlzaCore.getAvailabilityLabel(last.a, lang), AlzaCore.getAvailabilityLabel(availability, lang)),
    });
  }

  return changes;
}


// === Notifikace ===

// Které změny ohlásit podle nastavení – cílová cena vždy, výstraha k podezřelé ceně jen s jinou
// ohlášenou změnou. Výsledek { name, url, listUrl, lang, lines }. withRises = i zdražení (přehled v popupu)
function filterNotifications(changes, settings, { withRises = false } = {}) {
  const wanted = (change) => {
    if (change.kind === "rise") return withRises;
    if (change.kind === "drop") return settings.notifyDrops && change.percent >= (Number(settings.minDropPercent) || 0);
    if (change.kind === "new") return settings.notifyNewPrices;
    if (change.kind === "availability") {
      return settings.notifyAvailability === "all" || (settings.notifyAvailability === "inStock" && change.to === "in");
    }
    return true;
  };

  const withSuspicious = (all, shown) =>
    shown.length > 0 ? [...shown, ...all.filter((change) => change.kind === "suspicious")].map((change) => change.text) : [];

  return changes
    .map(({ name, url, image, price, listUrl, listName, domain, lang, textLang, changes }) => ({
      name,
      url,
      image,
      price,
      listName,
      listUrl,
      domain,
      lang: textLang || lang,
      lines: withSuspicious(changes, changes.filter((change) => change.kind !== "suspicious" && wanted(change))),
    }))
    .filter((change) => change.lines.length > 0);
}

// Poslední změny pro přehled v popupu (nejnovější první, jeden záznam za produkt). Dokud změnu
// uživatel neviděl, další změna se k ní přidá, aby se původní pokles neztratil
function addRecentChanges(recent = [], notifiable, unseen, at) {
  const result = [...recent];
  notifiable.forEach((change) => {
    const key = AlzaCore.getProductKey(change.domain, change.url);
    const index = result.findIndex((item) => item.key === key);
    const previous = index >= 0 ? result.splice(index, 1)[0] : null;
    const lines = previous && unseen.includes(key) ? [...new Set([...previous.lines, ...change.lines])] : change.lines;
    result.unshift({
      key,
      at,
      name: change.name,
      url: change.url,
      image: change.image || previous?.image || null,
      price: change.price === null || change.price === undefined ? null : AlzaCore.formatPrice(change.price, change.domain),
      listName: change.listName || null,
      listUrl: change.listName ? change.listUrl : null,
      lines,
    });
  });
  return result.slice(0, config.recentChangesMax);
}

// Přehled změn vznikl až po logu – jednorázově ho naplnit ze změn v logu (cena z historie, obrázek ze seznamů)
async function seedRecentFromLog() {
  const { [WATCH_LOG_KEY]: runs = [], [WATCH_LISTS_KEY]: lists = {} } = await chrome.storage.local.get([WATCH_LOG_KEY, WATCH_LISTS_KEY]);
  const images = new Map();
  Object.values(lists).forEach((list) => Object.entries(list?.products || {}).forEach(([url, info]) => images.set(url, info?.image)));

  const recent = [];
  for (const run of runs) {
    for (const item of run?.items || []) {
      if (!item?.lines?.length || !AlzaCore.isAlzaUrl(item.url)) continue;
      const domain = AlzaCore.getDomainKey(new URL(item.url).hostname);
      const key = AlzaCore.getProductKey(domain, item.url);
      if (recent.some((entry) => entry.key === key)) continue;

      const historyKey = AlzaCore.getHistoryKey(domain, item.url);
      const history = (await chrome.storage.local.get(historyKey))[historyKey] || [];
      const lowest = AlzaCore.getLowestPrice(history[history.length - 1]?.p);
      const list = Object.values(lists).find((entry) => entry?.products?.[item.url]);
      recent.push({
        key,
        at: run.end || run.start,
        name: item.name,
        url: item.url,
        image: images.get(item.url) || null,
        price: lowest === null ? null : AlzaCore.formatPrice(lowest, domain),
        listName: list?.name || null,
        listUrl: list?.url || null,
        lines: item.lines,
      });
      if (recent.length >= config.recentChangesMax) return recent;
    }
  }
  return recent;
}

// === Číslo na ikoně ===
// Zelené = produkty se změnou od posledního otevření popupu; když žádné nejsou, modré = produkty
// navržené ke smazání (nehlídané a dlouho nekontrolované), dokud je uživatel neodloží

async function updateBadge(unseen = []) {
  const { [CLEANUP_KEY]: cleanup = {} } = await chrome.storage.local.get(CLEANUP_KEY);
  const suggest = cleanup.count > 0 && !(cleanup.snoozedUntil > Date.now());
  const name = chrome.i18n.getMessage("name");

  if (unseen.length > 0 || !suggest) {
    await chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
    await chrome.action.setBadgeText({ text: unseen.length > 0 ? String(unseen.length) : "" });
    await chrome.action.setTitle({ title: name });
    return;
  }
  // Jazyk popupu (volba v nastavení, jinak prohlížeče) – titulek ikony patří k popupu
  const lang = AlzaCore.toTextLanguage(AlzaCore.getUiLanguage(await AlzaCore.getSettings()));
  await chrome.action.setBadgeBackgroundColor({ color: "#1976d2" });
  await chrome.action.setBadgeText({ text: String(cleanup.count) });
  await chrome.action.setTitle({ title: AlzaCore.translate(lang, "badgeCleanup", name, cleanup.count) });
}

// Spočítá produkty navržené ke smazání (čte celé storage – jen po běhu kontroly a na vyžádání)
async function updateCleanup() {
  const count = AlzaCore.findStaleProducts(await chrome.storage.local.get(null)).length;
  // Odložení návrhu (popup) zapisuje stejný klíč – přes frontu, ať se nepřepíše
  await withStateLock(async () => {
    const { [CLEANUP_KEY]: previous = {} } = await chrome.storage.local.get(CLEANUP_KEY);
    const now = Date.now();
    // at = kdy se počet změnil, checkedAt = kdy se naposledy počítal (start workeru)
    await chrome.storage.local.set({ [CLEANUP_KEY]: { ...previous, count, at: previous.count === count ? previous.at : now, checkedAt: now } });
  });
  await updateBadge((await getState()).unseen);
}

// keys = produkty otevřeného seznamu, null = vše (otevřený popup)
async function markSeen(keys) {
  // Před frontou – obnova po startu workeru sama čeká ve frontě (uvnitř by čekala sama na sebe) a jinak by
  // vrátila na ikonu staré číslo
  await staleRunReset;
  return withStateLock(async () => {
    const state = await getState();
    const unseen = keys ? (state.unseen || []).filter((key) => !keys.includes(key)) : [];
    if (unseen.length === (state.unseen || []).length) return;
    await saveState({ ...state, unseen });
    await updateBadge(unseen);
  });
}

// Odložené notifikace z tichých hodin + nové: jeden záznam za produkt, řádky bez opakování
function mergeNotifications(notifications) {
  const byUrl = new Map();
  notifications.forEach((notification) => {
    const existing = byUrl.get(notification.url);
    if (existing) {
      existing.lines = [...new Set([...existing.lines, ...notification.lines])];
    } else {
      byUrl.set(notification.url, { ...notification, lines: [...notification.lines] });
    }
  });
  return [...byUrl.values()];
}

async function notifyChanges(changes) {
  if (changes.length === 0) return;

  // Windows ukáže v notifikaci jen pár řádků – po jednom produktu se čte nejlépe
  if (changes.length <= config.maxIndividualNotifications) {
    for (const change of changes) {
      const iconUrl = await loadProductIcon(change.image);
      await createNotification({ title: change.name, message: change.lines.join("\n"), ...(iconUrl && { iconUrl }) }, change.url);
    }
    return;
  }

  // Víc změn najednou: jen názvy, podrobnosti jsou v logu v popupu
  await createNotification(
    {
      title: AlzaCore.translate(changes[0].lang, "notifySummaryTitle", changes.length),
      message: changes.map((change) => shortenName(change.name)).join(", "),
    },
    changes[0].listUrl
  );
}

// Jeden řádek za druh problému – obvykle mají všechny produkty stejnou příčinu (odhlášení, DPH, změna webu)
async function notifyProblems(problems) {
  const groups = new Map();
  problems.forEach((problem) => groups.set(problem.message, [...(groups.get(problem.message) || []), problem.name]));
  const lines = [...groups].map(([message, names]) => (names.length === 1 ? `${shortenName(names[0])}: ${message}` : `${message} (${names.length}×)`));

  await createNotification(
    {
      title: AlzaCore.translate(problems[0].lang || "cz", "notifyProblemTitle", problems.length),
      message: lines.join("\n"),
      requireInteraction: true,
    },
    problems.find((problem) => problem.url)?.url
  );
}

function shortenName(name) {
  return name.length > config.maxNameLength ? `${name.slice(0, config.maxNameLength - 1).trimEnd()}…` : name;
}

// Ukázka všech tří druhů notifikací (debug menu v popupu) – stejné texty jako při skutečném běhu
async function sendTestNotifications() {
  const domain = "alza_cz";
  const lang = AlzaCore.getDisplayLanguage(await AlzaCore.getSettings(), "cz");
  const url = AlzaCore.domains[domain].origin;
  const product = (name, lines, image) => ({ name, url, image, listUrl: url, domain, lang, lines });
  const last = { p: { benefit: 1299, original: 1399 }, a: "ended" };
  const lines = describeChanges(last, { benefit: 1199, original: 1399, discount: 1099 }, "in", { domain, lang }).map((change) => change.text);
  lines.push(AlzaCore.translate(lang, "notifyTargetReached", AlzaCore.formatPrice(1100, domain), AlzaCore.formatPrice(1099, domain)));

  await notifyChanges([product("Ukázkový produkt – změna u jednoho produktu", lines, "https://image.alza.cz/products/AUPR1389d/AUPR1389d.jpg")]);
  await sleep(1500);
  await notifyChanges(
    ["3M Scotch-FIX™ Oboustranná extrémní interiérová montážní páska", "Ukázkový produkt B", "Ukázkový produkt C", "Ukázkový produkt D"].map(
      (name) => product(name, lines)
    )
  );
  await sleep(1500);
  await notifyProblems([
    { ...product("Ukázkový produkt E"), message: AlzaCore.translate(lang, "notifyProblemNoData") },
    { ...product("Ukázkový produkt F"), message: AlzaCore.translate(lang, "notifyProblemFetch", "HTTP 403") },
    { ...product("Ukázkový produkt G"), message: AlzaCore.translate(lang, "notifyProblemFetch", "HTTP 403") },
  ]);
}

// Notifikace neumí vzdálený obrázek – stáhne se a předá jako data URL. Bez obrázku null (ikona doplňku)
async function loadProductIcon(imageUrl) {
  const url = AlzaCore.getProductImageUrl(imageUrl, config.notificationImageSize);
  if (!url) return null;
  try {
    const response = await fetch(url, { credentials: "omit" });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.startsWith("image/")) return null;

    const blob = await squareImage(await response.blob());
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${blob.type};base64,${btoa(binary)}`;
  } catch (error) {
    console.warn("Obrázek produktu pro notifikaci se nepodařilo načíst:", error);
    return null;
  }
}

// Alza vrací obrázek v původním poměru stran a Windows nečtvercový obrázek zarovná doleva nahoru –
// vycentrovat na bílý čtverec (jako na Alze)
async function squareImage(blob) {
  const size = config.notificationImageSize;
  const padding = Math.round(size * 0.06);
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min((size - 2 * padding) / bitmap.width, (size - 2 * padding) / bitmap.height);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, size, size);
  context.drawImage(bitmap, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/png" });
}

async function createNotification(options, targetUrl) {
  const notificationId = `alza-watch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const defaults = { type: "basic", iconUrl: chrome.runtime.getURL("img/icon-128.png"), priority: 1 };
  try {
    await chrome.notifications.create(notificationId, { ...defaults, ...options });
  } catch (error) {
    // Obrázek, který Chrome neumí zobrazit – raději ikona doplňku než žádná notifikace
    if (!options.iconUrl) throw error;
    await chrome.notifications.create(notificationId, { ...defaults, ...options, iconUrl: defaults.iconUrl });
  }

  if (targetUrl) await chrome.storage.session.set({ [notifyTargetKey(notificationId)]: targetUrl });
}

// === Pomocné ===

async function getState() {
  const { [WATCH_STATE_KEY]: state = {} } = await chrome.storage.local.get(WATCH_STATE_KEY);
  return state;
}

function saveState(state) {
  return chrome.storage.local.set({ [WATCH_STATE_KEY]: state });
}

function appendLog(entry) {
  return withStateLock(async () => {
    const { [WATCH_LOG_KEY]: runs = [] } = await chrome.storage.local.get(WATCH_LOG_KEY);
    runs.unshift(entry);
    await chrome.storage.local.set({ [WATCH_LOG_KEY]: runs.slice(0, config.logMaxRuns) });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
