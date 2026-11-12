// Služba na pozadí: podle nastavení (výchozí jednou za hodinu, nejméně jednou denně) postupně projde produkty hlídaných seznamů a produkty s cílovou
// cenou, zapíše kontrolu do historie a při změně (pokles ceny, nová akce, dostupnost, dosažení cílové
// ceny) pošle notifikaci podle nastavení. Stránku produktu stahuje a parsuje ProductPages – každý
// prohlížeč má vlastní (src/chrome/, src/firefox/), načtený před tímto souborem spolu s core.js.

const WATCH_LISTS_KEY = AlzaCore.storageKeys.watchLists; // { "<doména>|<listId>": { domain, listId, name, url, since, syncedAt, products: { url: { name, image } } } }
const WATCH_PRODUCTS_KEY = AlzaCore.storageKeys.watchProducts;
const PURCHASES_KEY = AlzaCore.storageKeys.purchases;
// Hlídání po nákupu: nejnižší cena, o které už přišlo upozornění – zapíše se na konci běhu (savePurchaseStates)
let purchaseUpdates = {};
const TARGETS_KEY = AlzaCore.storageKeys.targets;
// Stav posledního běhu pro popup; pendingNotifications = změny odložené v tichých hodinách,
// unseen = klíče produktů ("<doména>_<id>") se změnou od posledního otevření popupu/seznamu (číslo na ikoně)
const WATCH_STATE_KEY = AlzaCore.storageKeys.watchState;
// Log běhů, nejnovější první: [{ start, end, trigger, total, skipped, aborted, offline,
//   items: [{ name, url, lines: ["Benefit: …"], problem }] }] – items = zkontrolované produkty
const WATCH_LOG_KEY = AlzaCore.storageKeys.watchLog;
const CLEANUP_KEY = AlzaCore.storageKeys.cleanup;
const ALARM_NAME = "alzaWatchRun";
const RETRY_ALARM_NAME = "alzaWatchRetry"; // Kontrola, která narazila na offline – zkusit znovu, hlavní plán se nemění
const QUIET_END_ALARM_NAME = "alzaQuietEnd"; // Konec tichých hodin – odeslat odložené notifikace

const config = {
  missedRunDelayMs: 5 * 60 * 1000, // Zmeškaná denní kontrola (prohlížeč byl ve zvolený čas zavřený) proběhne po 5 min
  minCheckAgeMs: 30 * 60 * 1000, // Produkt zkontrolovaný (i stránkou seznamu) před méně než 30 min se přeskočí
  delayBetweenProductsMs: 4000, // Rozestup mezi produkty, ať Alza nedostane dávku požadavků najednou
  fetchRetryDelayMs: 5000,
  maxBlockedStreak: 3, // Tolik produktů po sobě s 403 / 429 / 5xx běh ukončí (Alza blokuje nebo má výpadek)
  stayAwakeIntervalMs: 10000, // Viz stayAwake
  userIdCacheMs: 3 * 60 * 1000, // Číslo účtu v paměti po dobu jednoho běhu / kol tlačítka „Načíst“ (nepřihlášen: minutu)
  delayBetweenListsMs: 1000, // Obsah hlídaných seznamů na začátku běhu (syncWatchedLists)
  listFetchTimeoutMs: 15000,
  logMaxListNames: 10, // Přidané / odebrané položky seznamu v logu běhu
  problemNotifyIntervalMs: 6 * 60 * 60 * 1000, // Problém se znovu ohlásí nejdřív po 6 h (v popupu je vidět vždy)
  maxIndividualNotifications: 3, // Do tohoto počtu změn vlastní notifikace pro každý produkt, nad ním souhrn
  maxNameLength: 32, // Názvy z Alzy bývají dlouhé – v souhrnu se zkracují
  notificationImageSize: 128, // Obrázek produktu jako ikona notifikace (px)
  recentChangesMax: 20, // Přehled změn v popupu
  logMaxRuns: 50,
  maxPendingNotifications: 50,
  cleanupRecountMs: 60 * 60 * 1000,
  offlineRetryMs: 15 * 60 * 1000,
  notificationImageTimeoutMs: 5000,
};

let running = false;
let manualRunRequested = false; // Zkontrolovat kliknuté, zatímco běh ještě nedoběhl

// Služba na pozadí je jediný zapisovatel do storage (AlzaStore): content scripty, popup i nastavení posílají
// operace zprávou. Read-modify-write stavu a logu tady jde přes stejnou frontu (withStateLock)
AlzaStore.isWriter = true;
const withStateLock = (task) => AlzaStore.exclusive(task);

// Jako první ve frontě: převod starého formátu uložených cen (alzaPrices_<doména> → záznam za produkt)
const storeReady = AlzaStore.exclusive(() => AlzaStore.migrate())
  .then((count) => count > 0 && console.info(`Uložené ceny převedeny na záznamy po produktech: ${count}`))
  .catch((error) => console.error("Převod uložených cen se nepodařil:", error))
  .then(() => AlzaStore.exclusive(() => AlzaStore.runCleanups()))
  .then((count) => count > 0 && console.info(`Z historie odstraněny ceny „od …“ z výpisů (množstevní sleva): ${count}`))
  .catch((error) => console.error("Oprava historie se nepodařila:", error));

// Service worker může Chrome ukončit i uprostřed běhu – uložené running: true by pak v popupu
// navždy ukazovalo "Probíhá kontrola". Po startu workeru žádný běh neprobíhá.
const staleRunReset = (async () => {
  await storeReady;
  const seed = (await getState()).recent ? null : await seedRecentFromLog();
  let recovered = false;
  await withStateLock(async () => {
    const state = await getState();
    if (!state.running && !seed) return;
    // Běh přerušený zavřením prohlížeče: změny, které stihl zjistit (deník běhu), by se jinak ztratily – historie
    // cen je už zapsaná, další běh by je neviděl. Jdou do přehledu změn a mezi odložené notifikace
    const { journal, ...rest } = state;
    const next = { ...rest, running: false, ...(seed && { recent: seed }) };
    if (state.running && Array.isArray(journal) && journal.length > 0) {
      Object.assign(next, await recoverJournal(next, journal));
      recovered = true;
    }
    await saveState(next);
  });
  if (recovered) await flushPendingNotifications({ afterReset: false }).catch((error) => console.error("Změny z přerušeného běhu se nepodařilo ohlásit:", error));
  // Číslo na ikoně se po restartu prohlížeče ztratí. Návrh čistky čte celé storage – při častém probouzení
  // workeru (alarm, zprávy ze záložek) ho přepočítat nejvýš jednou za cleanupRecountMs, jinak jen ikona
  const { [CLEANUP_KEY]: cleanup } = await chrome.storage.local.get(CLEANUP_KEY);
  if (Date.now() - (cleanup?.checkedAt || 0) >= config.cleanupRecountMs) await updateCleanup();
  else await withStateLock(async () => updateBadge(await getState()));
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

// Po instalaci průvodce nastavením (ověření přihlášení a DPH, hlídání, notifikace); nápověda je odkaz z něj.
// Novinky dřívějších vydání se novému uživateli neukazují – jsou „viděné“
// Po aktualizaci novinky (průvodce #news) – záložka se otevře sama jen u vydání s novou volbou, jinak jen značka
// Novinky v popupu. Obnovení rozbaleného rozšíření při vývoji hlásí „update“ se stejnou verzí – nic nového
chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  if (reason === "install") {
    markNewsSeen().catch((error) => console.error("Novinky se nepodařilo označit jako viděné:", error));
    chrome.tabs.create({ url: chrome.runtime.getURL("src/welcome/welcome.html") });
  }
  if (reason === "update") showReleaseNews(previousVersion).catch((error) => console.error("Novinky se nepodařilo ukázat:", error));
});

function markNewsSeen() {
  const seen = AlzaCore.releases[0]?.version;
  return seen ? AlzaStore.run({ type: "assign", key: AlzaCore.storageKeys.news, values: { seen } }) : Promise.resolve();
}

async function showReleaseNews(previousVersion) {
  const key = AlzaCore.storageKeys.news;
  const { [key]: news } = await chrome.storage.local.get(key);
  // První aktualizace s novinkami: viděné je všechno do předchozí verze
  let seen = news?.seen;
  if (!seen && previousVersion) {
    seen = previousVersion;
    await AlzaStore.run({ type: "assign", key, values: { seen } });
  }
  const fresh = AlzaCore.getReleaseNews(seen, chrome.runtime.getManifest().version);
  if (fresh.some((release) => release.settings.length > 0)) chrome.tabs.create({ url: chrome.runtime.getURL("src/welcome/welcome.html#news") });
}

// Spuštění prohlížeče: probudí službu na pozadí – kód na nejvyšší úrovni obnoví číslo na ikoně a naplánuje kontrolu
// (Firefox alarmy po restartu nedrží a bez posluchače by se stránka na pozadí nespustila)
chrome.runtime.onStartup.addListener(() => {});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === QUIET_END_ALARM_NAME) {
    flushPendingNotifications().catch((error) => console.error("Odložené notifikace se nepodařilo odeslat:", error));
    return;
  }
  if (alarm.name === RETRY_ALARM_NAME) {
    runWatch({ force: false, trigger: "alarm" });
    return;
  }
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
  // Termíny akce s cashbackem pro tooltip v seznamu / řádek cashbacku na detailu (getCashbackTerms)
  if (message?.action === "cashbackTerms") {
    getCashbackTerms(message.url, message.title).then(sendResponse, () => sendResponse(null));
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
  // Moje nákupy: načíst koupené zboží hned (tlačítko v nastavení); odpověď = výsledek po doménách
  if (message?.action === "ownedSync") {
    // stayAwake: odpověď na zprávu uspání stránky na pozadí neodloží, načítání archivu trvá i minuty
    stayAwake(() => syncOwned(true))
      .then((result) => processWarrantyReminders().catch(() => {}).then(() => result))
      .then(sendResponse, (error) => sendResponse({ status: "error", error: String(error?.message || error), domains: {} }));
    return true;
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
  try {
    await productPagesUse.closing;
    productPagesUse.opening ??= ProductPages.open();
    await productPagesUse.opening;
  } catch (error) {
    // Nepovedené otevření nesmí zůstat uložené – jinak by selhalo každé další stažení až do restartu
    productPagesUse.users--;
    productPagesUse.opening = null;
    throw error;
  }
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

// === Obsah hlídaných seznamů ===
// Položky přidané nebo odebrané jinde (mobilní aplikace, jiný počítač) bez otevření seznamu: obsah z API, ze kterého
// stránku seznamu vykresluje React (v HTML stránky položky nejsou – jiný zdroj není). Při selhání zůstane uložený
// obsah a seznam se jako dřív synchronizuje při otevření jeho stránky (watch.js → syncWatchedList)

async function fetchCommodityList(list) {
  const url = `${AlzaCore.domains[list.domain].origin}/services/restservice.svc/v1/getCommodityLists/${encodeURIComponent(list.listId)}`;
  try {
    const response = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(config.listFetchTimeoutMs),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    // Nepřihlášený → přesměrování na přihlášení / HTML místo JSON
    if (!AlzaCore.isAlzaUrl(response.url)) return { ok: false, error: "přesměrováno mimo Alzu" };
    if (!/json/i.test(response.headers.get("content-type") || "")) return { ok: false, error: "odpověď není JSON (nepřihlášen?)" };
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, error: error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : String(error?.message || error) };
  }
}

async function syncWatchedLists(log) {
  const { [WATCH_LISTS_KEY]: lists = {} } = await chrome.storage.local.get(WATCH_LISTS_KEY);
  const entries = Object.entries(lists).filter(([, list]) => AlzaCore.domains[list?.domain] && /^\d+$/.test(String(list.listId)));
  for (const [key, list] of entries) {
    if (entries[0][0] !== key) await sleep(config.delayBetweenListsMs);
    const result = await fetchCommodityList(list);
    const parsed = result.ok ? AlzaCore.parseCommodityList(result.data, list) : null;
    const name = parsed?.name || list.name || list.listId;
    if (!parsed) {
      const lang = AlzaCore.getDisplayLanguage(await AlzaCore.getSettings(), AlzaCore.domains[list.domain].lang);
      log.lists.push({ name, url: list.url, problem: AlzaCore.localizeError(lang, result.ok ? "neočekávaná odpověď" : result.error) });
      continue;
    }
    // merge + existingOnly: seznam se mezitím mohl přestat hlídat (popup, stránka seznamu) – pak nic nevracet
    await AlzaStore.run({
      type: "patchMap",
      key: WATCH_LISTS_KEY,
      merge: { [key]: { name, syncedAt: Date.now(), products: parsed.products } },
      existingOnly: true,
    });
    if (parsed.added.length || parsed.removed.length) {
      log.lists.push({
        name,
        url: list.url,
        added: parsed.added.slice(0, config.logMaxListNames),
        addedCount: parsed.added.length,
        removed: parsed.removed.slice(0, config.logMaxListNames),
        removedCount: parsed.removed.length,
      });
    }
  }
}

// === Objednávky (hlídání po nákupu) ===
// Nová objednávka se načte už při kontrole na pozadí, ne až při návštěvě Alzy (AlzaOrders v shared/orders.js). Jen
// domény, kde se objednávky už načítaly (uživatel tam nakupuje přihlášený). Číslo účtu z hlavní stránky Alzy (stažené
// s přihlášením, „user_se_id“) – jen v paměti, neukládá se

async function fetchAlzaJson(url) {
  const response = await fetch(url, { credentials: "include", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(config.listFetchTimeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!AlzaCore.isAlzaUrl(response.url)) throw new Error("přesměrováno mimo Alzu");
  if (!/json/i.test(response.headers.get("content-type") || "")) throw new Error("odpověď není JSON (nepřihlášen?)");
  return response.json();
}

async function fetchUserId(origin) {
  const response = await fetch(`${origin}/`, { credentials: "include", signal: AbortSignal.timeout(config.listFetchTimeoutMs) });
  if (!response.ok || !AlzaCore.isAlzaUrl(response.url)) return null;
  return (await response.text()).match(/user_se_id\\*"\s*:\s*\\*"?(\d+)/)?.[1] || null;
}

// Číslo účtu pro jeden běh: objednávky, Moje nákupy i další kola tlačítka „Načíst“ kvůli němu nestahují hlavní
// stránku Alzy znovu. Jen v paměti služby a jen na pár minut (nepřihlášený stav minutu – po přihlášení se pozná brzy)
const userIds = new Map(); // origin → { id, at }
async function getUserId(origin) {
  const cached = userIds.get(origin);
  if (cached && Date.now() - cached.at < (cached.id ? config.userIdCacheMs : 60 * 1000)) return cached.id;
  const id = await fetchUserId(origin);
  userIds.set(origin, { id, at: Date.now() });
  return id;
}

async function syncOrders(log, force) {
  const settings = await AlzaCore.getSettings();
  if (!settings.watchPurchases) return;
  const { [AlzaCore.storageKeys.purchasesSync]: sync = {} } = await chrome.storage.local.get(AlzaCore.storageKeys.purchasesSync);
  const domains = Object.keys(sync && typeof sync === "object" ? sync : {}).filter((key) => AlzaCore.domains[key]);
  for (const domainKey of domains) {
    const { origin, lang } = AlzaCore.domains[domainKey];
    const name = AlzaCore.translate(AlzaCore.getDisplayLanguage(settings, lang), "purchaseOrdersLink");
    const url = `${origin}${AlzaCore.ordersPath}`;
    try {
      const result = await AlzaOrders.check({ domainKey, origin, getJson: fetchAlzaJson, getUserId: () => getUserId(origin), always: force });
      if (result.added.length) {
        log.lists.push({ name, url, orders: true, added: result.added.slice(0, config.logMaxListNames), addedCount: result.added.length, removed: [], removedCount: 0 });
      }
      // Alza načítání odmítla (403 / 429) nebo opakovaně selhalo – objednávky nejsou načtené celé, zkusí se příště
      if (result.blocked) log.lists.push({ name, url, problem: AlzaCore.localizeError(AlzaCore.getDisplayLanguage(settings, lang), "objednávky se nepodařilo načíst"), orders: true });
    } catch (error) {
      log.lists.push({ name, url, problem: AlzaCore.localizeError(AlzaCore.getDisplayLanguage(settings, lang), error?.message || error), orders: true });
    }
  }
}

// === Moje nákupy (volba ownedItems) ===
// Všechno koupené z archivu objednávek (AlzaOwned v shared/orders.js) – po každém běhu kontroly a hned po kliknutí
// v nastavení (zpráva ownedSync). Souběžná volání sdílí jedno načtení

let ownedSyncTask = null;
let ownedSyncForced = false;
let ownedForcedAt = 0; // Konec posledního načtení z tlačítka – další kolo téhož kliknutí archiv znovu nestahuje
function syncOwned(force) {
  // Kliknutí v nastavení během načítání na pozadí: počkat na něj a pak načíst naplno – jeho výsledek
  // („přeskočeno“, menší dávka) by tlačítku nic neřekl
  if (ownedSyncTask && force && !ownedSyncForced) return ownedSyncTask.catch(() => {}).then(() => syncOwned(true));
  if (!ownedSyncTask) {
    ownedSyncForced = force;
    ownedSyncTask = stayAwake(() => runOwnedSync(force)).finally(() => {
      ownedSyncTask = null;
      if (force) ownedForcedAt = Date.now();
    });
  }
  return ownedSyncTask;
}

async function hasOwnedWarrantyQueue(domainKey) {
  const { [AlzaCore.storageKeys.owned]: owned } = await chrome.storage.local.get(AlzaCore.storageKeys.owned);
  return AlzaCore.getOwnedWarrantyQueue(owned && typeof owned === "object" ? owned : {}, domainKey).length > 0;
}

// { status: "off" | "done", domains: { "<doména>": výsledek AlzaOwned.sync (+ warranties = zjištěných záruk) | { status: "error", error } } }
async function runOwnedSync(force) {
  const settings = await AlzaCore.getSettings();
  if (!settings.ownedItems) return { status: "off", domains: {} };
  const keys = AlzaCore.storageKeys;
  const stored = await chrome.storage.local.get([keys.ownedSync, keys.purchasesSync]);
  const known = (value) => Object.keys(value && typeof value === "object" ? value : {}).filter((key) => AlzaCore.domains[key]);
  // Na pozadí jen domény, kde uživatel nakupuje přihlášený, a hlavní Alza; po kliknutí v nastavení všechny tři
  // (nepřihlášená skončí hned – bez čísla účtu)
  const domains = force
    ? Object.keys(AlzaCore.domains)
    : [...new Set([...known(stored[keys.ownedSync]), ...known(stored[keys.purchasesSync]), AlzaCore.getPrimaryDomain(settings)])];
  const result = {};
  // Další kolo téhož kliknutí na „Načíst“ (tlačítko volá opakovaně, dokud zbývají detaily): už načtený archiv znovu nestahovat
  const skipArchive = force && Date.now() - ownedForcedAt < 2 * 60 * 1000;
  for (const domainKey of domains) {
    const { origin } = AlzaCore.domains[domainKey];
    try {
      const synced = await AlzaOwned.sync({ domainKey, origin, getJson: fetchAlzaJson, getUserId: () => getUserId(origin).catch(() => null), force, skipArchive });
      result[domainKey] = synced;
      // Délka záruky z API produktu – jen kde je co zjišťovat, uživatel je přihlášený (API vrací záruku pro jeho účet,
      // firemnímu „pro firemní nákupy“) a Alza dotazy neodmítá
      if (["synced", "skipped"].includes(synced.status) && !synced.blocked && (await hasOwnedWarrantyQueue(domainKey)) && (await getUserId(origin).catch(() => null))) {
        const warranties = await AlzaOwned.syncWarranties({ domainKey, getJson: fetchAlzaJson, force });
        result[domainKey] = {
          ...synced,
          status: warranties.count > 0 ? "synced" : synced.status,
          warranties: warranties.count,
          pending: (synced.pending || 0) + warranties.pending,
          ...(warranties.blocked && { blocked: true }),
        };
      }
    } catch (error) {
      // Na pozadí výsledek nikdo nečte – chyba (např. změněný tvar archivu) aspoň do logu chyb v nastavení
      console.error(`Moje nákupy (${domainKey}) se nepodařilo načíst:`, error);
      result[domainKey] = { status: "error", error: String(error?.message || error) };
    }
  }
  return { status: "done", domains: result };
}

// Připomínka konce záruky (volba remindWarranty): dražší zboží, kterému záruka končí do warrantyReminderDays –
// jednou za nákup, kliknutí otevře objednávku na Alze. V tichých hodinách se odloží do jejich konce (alarm
// alzaQuietEnd → flushPendingNotifications) – denní kontrola v tichých hodinách by ji jinak neposlala nikdy.
// Po sobě: souběžné zpracování (běh na pozadí + tlačítko „Načíst“) by stejnou připomínku poslalo dvakrát
let warrantyRemindersQueue = Promise.resolve();
function processWarrantyReminders() {
  warrantyRemindersQueue = warrantyRemindersQueue
    .then(() => sendWarrantyReminders())
    .catch((error) => console.error("Připomínky konce záruky se nepodařilo odeslat:", error));
  return warrantyRemindersQueue;
}

async function sendWarrantyReminders() {
  const settings = await AlzaCore.getSettings();
  if (!settings.ownedItems || !settings.remindWarranty) return;
  const key = AlzaCore.storageKeys.owned;
  const { [key]: owned } = await chrome.storage.local.get(key);
  if (!owned || typeof owned !== "object") return;
  const reminders = AlzaCore.getWarrantyReminders(owned).slice(0, config.maxIndividualNotifications);
  if (reminders.length === 0) return;
  if (AlzaCore.isQuietTime(settings)) {
    await scheduleQuietEnd(settings);
    return;
  }
  for (const { key: productKey, product, buy, until } of reminders) {
    const lang = AlzaCore.getDisplayLanguage(settings, AlzaCore.domains[product.domain].lang);
    const message = AlzaCore.translate(lang, "notifyWarrantyEnding", AlzaCore.formatTextDate(until, lang, true), AlzaCore.formatTextDate(buy.t, lang, true));
    const iconUrl = await loadProductIcon(product.image);
    await createNotification({ title: product.name || "Alza", message, requireInteraction: true, ...(iconUrl && { iconUrl }) }, AlzaCore.getOrderUrl(product.domain, buy.o) || product.url);
    await AlzaStore.run({ type: "markOwnedNotified", items: [{ key: productKey, order: buy.o }] });
  }
}

// === Běh kontroly ===

// Firefox uspí stránku na pozadí po 30 s bez volání API doplňku (fetch, storage ani setTimeout se nepočítají – viz
// firefox/product-pages.js); Chrome ukončí service worker podobně. Dlouhá práce mimo stahování stránek produktů
// (obsah seznamů, objednávky, Moje nákupy) proto každých 10 s zavolá neškodné API
let awakeUsers = 0;
let awakeTimer = null;
async function stayAwake(task) {
  if (awakeUsers++ === 0) awakeTimer = setInterval(() => chrome.runtime.getPlatformInfo(), config.stayAwakeIntervalMs);
  try {
    return await task();
  } finally {
    if (--awakeUsers === 0) {
      clearInterval(awakeTimer);
      awakeTimer = null;
    }
  }
}

function runWatch(options) {
  return stayAwake(() => runWatchBody(options));
}

async function runWatchBody({ force, trigger }) {
  // Kliknutí na Zkontrolovat během dokončování běhu se neztratí – proběhne hned po něm
  if (running) {
    if (trigger === "manual") manualRunRequested = true;
    return;
  }
  running = true;

  let state;
  try {
    await staleRunReset;
    state = await withStateLock(async () => {
      const current = await getState();
      const started = { ...current, lastRunStart: Date.now(), running: true, journal: [] };
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
  const log = { start: state.lastRunStart, trigger, total: 0, skipped: 0, aborted: false, offline: false, items: [], lists: [] };
  const targetUpdates = {};
  purchaseUpdates = {};
  let checked = 0;
  let blockedStreak = 0;
  let productPagesAcquired = false;

  try {
    // Nejdřív obsah seznamů – položky přidané v mobilní aplikaci se zkontrolují už v tomto běhu
    if (navigator.onLine) await syncWatchedLists(log).catch((error) => console.error("Obsah hlídaných seznamů se nepodařilo načíst:", error));
    // Nákupy před seznamem produktů – nově koupené zboží se zkontroluje už v tomto běhu
    if (navigator.onLine) await syncOrders(log, force).catch((error) => console.error("Objednávky se nepodařilo načíst:", error));
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
        problem: AlzaCore.translate(product.textLang, "notifyProblemFetch", AlzaCore.localizeError(product.textLang, error?.message || error)),
      }));
      const lines = (outcome.changes || []).map((change) => change.text);
      // Nejaktuálnější název ze stránky / historie – v seznamu může být uložený starší (s jinou akcí)
      const name = outcome.name || product.name;
      if (outcome.changes?.length) {
        changes.push({ ...product, name, image: outcome.image || product.image, price: outcome.price ?? null, changes: outcome.changes });
        await saveJournal(changes);
      }
      // Řádek logu u zboží hlídaného jen kvůli nákupu – diagnostika jeho název neposílá
      const purchaseFlag = product.purchaseOnly ? { purchaseOnly: true } : {};

      if (outcome.skipped) {
        log.skipped++;
        // Cílovou cenu mohla zachytit stránka seznamu – ohlásit i bez nové kontroly
        if (lines.length) log.items.push({ name, url: product.url, lines, problem: null, ...purchaseFlag });
        continue;
      }

      checked++;
      // Zboží hlídané jen kvůli nákupu: problém je vidět v popupu a logu, notifikaci „kontrola selhala“ nespouští
      // (uživatel ho sám nehlídá – po odhlášení by chodila celou lhůtu pro vrácení)
      if (outcome.problem) problems.push({ ...product, lang: product.textLang, name, message: outcome.problem, silent: Boolean(product.purchaseOnly) });
      log.items.push({ name, url: product.url, lines, problem: outcome.problem || null, ...purchaseFlag });

      // Bez přihlášení by stejně selhaly všechny produkty – zbytečně nezatěžovat Alzu
      if (outcome.abort) {
        log.aborted = true;
        break;
      }
      // Alza blokuje (403 / 429) nebo padá (5xx) několikrát po sobě – zbytek produktů by dopadl stejně
      blockedStreak = outcome.blocked ? blockedStreak + 1 : 0;
      if (blockedStreak >= config.maxBlockedStreak) {
        log.aborted = true;
        break;
      }

      if (product !== products.at(-1)) await sleep(config.delayBetweenProductsMs);
    }
  } catch (error) {
    console.error("Chyba při kontrole hlídaných seznamů:", error);
    const settings = await AlzaCore.getSettings().catch(() => ({}));
    const lang = AlzaCore.getDisplayLanguage(settings, AlzaCore.domains[AlzaCore.getPrimaryDomain(settings)]?.lang || "cz");
    problems.push({ name: "–", url: null, lang, message: String(error?.message || error) });
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
    // Připomínky cashbacku až po uvolnění běhu – kontrola na vyžádání mezitím nesmí propadnout. Ve finally:
    // proběhnou i po běhu bez produktů nebo offline (return v try)
    await processCashbackReminders();
    // Moje nákupy: nové objednávky z archivu, pár detailů a připomínky konce záruky – také po běhu bez produktů
    if (navigator.onLine) await syncOwned(false).catch((error) => console.error("Koupené zboží se nepodařilo načíst:", error));
    await processWarrantyReminders().catch((error) => console.error("Připomínky konce záruky se nepodařilo odeslat:", error));
    if (manualRunRequested) {
      manualRunRequested = false;
      runWatch({ force: true, trigger: "manual" });
    }
  }
}

async function finishRun({ state, log, checked, changes, problems, targetUpdates, force, productPagesAcquired }) {
  if (productPagesAcquired) await releaseProductPages();
  await saveTargetStates(targetUpdates);
  await savePurchaseStates(purchaseUpdates);

  const end = Date.now();
  // V tichých hodinách se notifikace odkládají (odešlou se po jejich konci), problémy se ohlásí až po nich (pokud trvají)
  const settings = await AlzaCore.getSettings();
  const quiet = AlzaCore.isQuietTime(settings);
  const notifiable = filterNotifications(changes, settings);
  // Přehled v popupu i číslo na ikoně i se zdražením (to se ale neoznamuje notifikací)
  const shown = filterNotifications(changes, settings, { withRises: true });
  let pending = [];
  let notifyProblemsNow = false;
  const loudProblems = problems.filter((problem) => !problem.silent);

  // Stav uložit před notifikacemi – selhání notifikace ani stahování obrázků ho nesmí zablokovat. Číst ho znovu až
  // ve frontě: během běhu ho mohl změnit popup (viděno) nebo smazání dat v nastavení – stav ze začátku běhu by je přepsal
  const saved = await withStateLock(async () => {
    const current = await getState();
    pending = mergeNotifications([...(current.pendingNotifications || []), ...notifiable]);
    notifyProblemsNow = !quiet && loudProblems.length > 0 && (force || end - (current.lastProblemNotifiedAt || 0) >= config.problemNotifyIntervalMs);
    const unseen = current.unseen || [];
    const recent = addRecentChanges(current.recent, shown, unseen, end);
    const next = {
      ...current,
      running: false,
      // Offline se nic nezkontrolovalo – čas poslední kontroly zůstane (zmeškaná denní kontrola se dožene)
      lastRunEnd: log.offline ? current.lastRunEnd : end,
      // Offline se nic nezkontrolovalo – výsledek posledního skutečného běhu (i trvající problém) v popupu zůstane
      checked: log.offline ? current.checked : checked,
      changes: log.offline ? current.changes : changes.map(({ name, url, changes }) => ({ name, url, lines: changes.map((change) => change.text) })),
      problems: log.offline ? current.problems : problems.map(({ name, url, message }) => ({ name, url, message })),
      pendingNotifications: quiet ? pending.slice(-config.maxPendingNotifications) : [],
      lastProblemNotifiedAt: notifyProblemsNow ? end : current.lastProblemNotifiedAt,
      recent,
      // Číslo na ikoně i v tichých hodinách – jen produkty, které přehled změn v popupu opravdu ukáže (drží posledních N)
      unseen: [...new Set([...unseen, ...shown.map(({ url, domain }) => AlzaCore.getProductKey(domain, url))])].filter((key) =>
        recent.some((item) => item.key === key)
      ),
    };
    delete next.journal; // Deník běhu je tímto zpracovaný
    await saveState(next);
    return next;
  });
  if (log.total > 0) await appendLog({ ...log, end });

  // Bez připojení: zkusit znovu za chvíli (hlavní plán kontrol se nemění)
  if (log.offline) await chrome.alarms.create(RETRY_ALARM_NAME, { when: end + config.offlineRetryMs });
  // Odložené notifikace odeslat hned po konci tichých hodin, ne až s další kontrolou (denní může být až zítra)
  if (quiet && saved.pendingNotifications.length > 0) await scheduleQuietEnd(settings, end);

  // Každý krok zvlášť – chyba přepočtu čistky nesmí zastavit notifikace ani naopak
  await updateCleanup().catch((error) => console.error("Návrh čistky se nepodařilo přepočítat:", error)); // Nastaví i číslo na ikoně
  if (!quiet) await notifyChanges(pending).catch((error) => console.error("Chyba při odesílání notifikací:", error));
  if (notifyProblemsNow) await notifyProblems(loudProblems).catch((error) => console.error("Chyba při odesílání notifikace o problému:", error));
}

// Konec tichých hodin: alarm odešle odložené notifikace i připomínky cashbacku
async function scheduleQuietEnd(settings, now = Date.now()) {
  await chrome.alarms.create(QUIET_END_ALARM_NAME, { when: AlzaCore.getDailyRunTimes(settings.quietTo, now).next + 60 * 1000 });
}

// === Připomínka cashbacku ===

// Koupené zboží (hlídání po nákupu), u kterého jsme kolem data nákupu viděli cashback (storageKeys.cashbacks):
// připomínka s lhůtou registrace ze stránky akce. Upozorní, když jde nákup zaregistrovat, a cashbackSoonDays
// před koncem registrace; kliknutí otevře podmínky akce. V tichých hodinách se upozornění odloží do jejich konce
// (alarm alzaQuietEnd → flushPendingNotifications)
// Po sobě – po běhu kontroly i po konci tichých hodin; souběžné zpracování by stejnou připomínku poslalo dvakrát
let cashbackRemindersQueue = Promise.resolve();
function processCashbackReminders() {
  cashbackRemindersQueue = cashbackRemindersQueue
    .then(() => updateCashbackReminders())
    .catch((error) => console.error("Připomínky cashbacku se nepodařilo zpracovat:", error));
  return cashbackRemindersQueue;
}

async function updateCashbackReminders() {
  const settings = await AlzaCore.getSettings();
  if (!settings.watchPurchases || !settings.remindCashback) return;
  const quiet = AlzaCore.isQuietTime(settings);
  const remindersKey = AlzaCore.storageKeys.cashbackReminders;
  const {
    [PURCHASES_KEY]: purchases = {},
    [AlzaCore.storageKeys.cashbacks]: cashbacks = {},
    [remindersKey]: stored = {},
  } = await chrome.storage.local.get([PURCHASES_KEY, AlzaCore.storageKeys.cashbacks, remindersKey]);
  const reminders = stored && typeof stored === "object" ? stored : {};
  const set = {};
  const merge = {};
  const remove = [];
  // Nákup ještě ve lhůtě pro vrácení – jen k takovému vzniká připomínka
  const inReturnWindow = (key, now) => purchases?.[key]?.returnUntil > now;

  const startedAt = Date.now();
  Object.entries(purchases || {}).forEach(([key, purchase]) => {
    if (reminders[key] || !purchase || !inReturnWindow(key, startedAt)) return;
    const entry = AlzaCore.getPurchaseCashback(purchase, cashbacks?.[key]);
    if (entry) set[key] = AlzaCore.createCashbackReminder(purchase, entry);
  });

  // Lhůta registrace ze stránky akce – u nových připomínek a u těch, kde se načtení zatím nepovedlo. Nákup po konci
  // nákupního období akce do ní nepatří – připomínka se uzavře bez upozornění
  const unread = Object.entries({ ...reminders, ...set }).filter(
    ([, reminder]) => reminder?.terms && !reminder.termsRead && (reminder.termsTries || 0) < AlzaCore.cashbackTermsTries && !reminder.done
  );
  if (unread.length > 0 && navigator.onLine) {
    for (const [key, reminder] of unread) {
      const askedAt = Date.now();
      let failed = false;
      const terms = await getCashbackTerms(reminder.terms, reminder.title).catch(() => {
        failed = true;
        return null;
      });
      let update;
      if (terms?.ok) {
        const dates = AlzaCore.getCashbackDates(terms, reminder.boughtAt);
        update = { registerFrom: dates.registerFrom, registerUntil: dates.registerUntil, termsRead: true, ...(dates.purchaseEnded && { done: true, outsidePromo: true }) };
      } else if (failed || !AlzaCore.isAlzaUrl(reminder.terms) || terms?.fetchedAt >= askedAt) {
        // Pokus se počítá jen za skutečné stažení (ne neúspěch z mezipaměti, ne offline)
        update = { termsTries: (reminder.termsTries || 0) + 1 };
      } else {
        continue;
      }
      if (set[key]) Object.assign(set[key], update);
      else merge[key] = update;
    }
  }

  const now = Date.now();
  const notify = [];
  let dueInQuiet = false;
  Object.entries({ ...reminders, ...set }).forEach(([key, base]) => {
    const reminder = { ...base, ...merge[key] };
    const step = AlzaCore.getCashbackReminderStep(reminder, now);
    if (step === "expired") {
      // Dokud je nákup ve lhůtě pro vrácení, zůstane uzavřená (done) – jinak by připomínka vznikla znovu
      if (inReturnWindow(key, now)) {
        if (set[key]) set[key].done = true;
        else if (!reminder.done) merge[key] = { ...merge[key], done: true };
      } else if (set[key]) {
        delete set[key];
      } else {
        remove.push(key);
      }
      return;
    }
    if (!step) return;
    // V tichých hodinách se nic neoznačí – připomínku pošle alarm konce tichých hodin
    if (quiet) {
      dueInQuiet = true;
      return;
    }
    // Registrace se otevřela až těsně před koncem – druhé upozornění by přišlo hned po prvním
    const soonToo = reminder.registerUntil > 0 && now >= reminder.registerUntil - AlzaCore.cashbackSoonDays * AlzaCore.dayMs;
    const flags = { notifiedOpen: true, ...((step === "soon" || soonToo) && { notifiedSoon: true }) };
    if (set[key]) Object.assign(set[key], flags);
    else merge[key] = { ...merge[key], ...flags };
    notify.push({ key, reminder, step });
  });

  if (Object.keys(set).length > 0 || Object.keys(merge).length > 0 || remove.length > 0) {
    // existingOnly: připomínku mezitím smazanou (smazání dat) příznaky nevzkřísí
    await AlzaStore.run({ type: "patchMap", key: remindersKey, set, merge, remove, existingOnly: true });
  }
  if (dueInQuiet) await scheduleQuietEnd(settings, now);
  for (const { key, reminder, step } of notify) {
    // Mezitím „Hotovo“ v popupu (nebo smazání dat) – už neupozorňovat
    const { [remindersKey]: latest = {} } = await chrome.storage.local.get(remindersKey);
    if (!latest?.[key] || latest[key].done) continue;
    await notifyCashback(reminder, step, settings).catch((error) => console.error("Připomínku cashbacku se nepodařilo odeslat:", error));
  }
}

// Termíny akce s cashbackem (konec nákupu, lhůta registrace) ze stránky akce – sdílí tooltip cashbacku v seznamu,
// řádek cashbacku na detailu i připomínky. Mezipaměť storageKeys.cashbackTerms: úspěch platí den, neúspěch hodinu.
// Souběžné dotazy na stejnou akci (víc produktů v seznamu) čekají na jedno stažení. Vrací záznam { ok, … } nebo null
const cashbackTermsInFlight = new Map();
// Stažený text stránky akce podle adresy – víc produktů stejné akce s různým popiskem (klíč termínů) ji nestahuje
// znovu; jen v paměti služby na pozadí, krátce
const cashbackPageText = new Map(); // url → { at, request: Promise<výsledek ProductPages.terms> }
const CASHBACK_PAGE_TEXT_MS = 10 * 60 * 1000;

function fetchCashbackPage(url) {
  const now = Date.now();
  cashbackPageText.forEach((entry, key) => now - entry.at > CASHBACK_PAGE_TEXT_MS && cashbackPageText.delete(key));
  if (!cashbackPageText.has(url)) {
    const request = withProductPages(() => ProductPages.terms(url))
      .catch((error) => ({ ok: false, error: String(error?.message || error) }))
      .then((result) => {
        if (!result?.ok) cashbackPageText.delete(url); // Nepovedené stažení si nepamatovat – další dotaz zkusí znovu
        return result;
      });
    cashbackPageText.set(url, { at: now, request });
  }
  return cashbackPageText.get(url).request;
}

async function getCashbackTerms(url, title) {
  if (!AlzaCore.isAlzaUrl(url)) return null;
  const termsKey = AlzaCore.storageKeys.cashbackTerms;
  const key = AlzaCore.getCashbackTermsKey(url, title);
  const { [termsKey]: cache = {} } = await chrome.storage.local.get(termsKey);
  const cached = cache?.[key];
  const age = Date.now() - (cached?.fetchedAt || 0);
  const current = cached?.v === AlzaCore.cashbackTermsVersion; // Termíny ze starší verze čtení stránky – načíst znovu
  if (cached && current && age < (cached.ok ? AlzaCore.cashbackTermsMaxAgeMs : AlzaCore.cashbackTermsRetryMs)) return cached;
  if (!navigator.onLine) return cached || null;
  if (cashbackTermsInFlight.has(key)) return cashbackTermsInFlight.get(key);

  const task = (async () => {
    const result = await fetchCashbackPage(url);
    const now = Date.now();
    // Popisek řádku cashbacku („Akce platí do 3. 1. 2027 nebo do vyprodání zásob.“) doplní, co stránka akce nemá
    const fromTitle = title ? AlzaCore.readCashbackTerms(title, null, now) : null;
    const retryAt = now - AlzaCore.cashbackTermsMaxAgeMs + AlzaCore.cashbackTermsRetryMs; // Platí jen hodinu – zkusit znovu
    const v = AlzaCore.cashbackTermsVersion;
    // Starší termíny zůstanou, když se stránka zrovna nenačetla (Cloudflare, výpadek)
    const entry = result?.ok
      ? { ok: true, v, fetchedAt: now, ...AlzaCore.mergeCashbackTerms(AlzaCore.readCashbackTerms(result.text, title, now), fromTitle) }
      : cached?.ok
        ? { ...cached, v, fetchedAt: retryAt }
        : AlzaCore.hasCashbackTerms(fromTitle)
          ? { ok: true, v, fetchedAt: retryAt, ...AlzaCore.mergeCashbackTerms(fromTitle, null) }
          : { ok: false, v, fetchedAt: now };
    // Staré záznamy podle čerstvě přečtené mezipaměti, bez akcí, které se právě stahují – souběžný dotaz mohl
    // svůj záznam mezitím obnovit (nebo ho ještě zapíše) a smazání by ho zahodilo
    const { [termsKey]: latest = {} } = await chrome.storage.local.get(termsKey);
    const stale = Object.entries(latest && typeof latest === "object" ? latest : {})
      .filter(([other, value]) => other !== key && !cashbackTermsInFlight.has(other) && !(value?.fetchedAt > now - AlzaCore.cashbackTermsKeepDays * AlzaCore.dayMs))
      .map(([other]) => other);
    await AlzaStore.run({ type: "patchMap", key: termsKey, set: { [key]: entry }, remove: stale });
    return entry;
  })().finally(() => cashbackTermsInFlight.delete(key));
  cashbackTermsInFlight.set(key, task);
  return task;
}

async function notifyCashback(reminder, step, settings) {
  const domain = AlzaCore.isKnownDomain(reminder.domain) ? reminder.domain : "alza_cz";
  const lang = AlzaCore.getDisplayLanguage(settings, AlzaCore.domains[domain].lang);
  const refund = reminder.refund > 0 ? AlzaCore.formatPrice(reminder.refund, domain) : "–";
  const until = reminder.registerUntil > 0
    ? AlzaCore.formatTextDate(reminder.registerUntil, lang, true)
    : null;
  // Bez známé částky text bez „až –“ (dokud překlad chybí, vrací translate klíč – pak původní text)
  const noAmount = !(reminder.refund > 0) && until ? AlzaCore.translate(lang, "notifyCashbackOpenNoAmount", until) : null;
  const message =
    step === "soon"
      ? AlzaCore.translate(lang, "notifyCashbackSoon", refund, until)
      : noAmount && noAmount !== "notifyCashbackOpenNoAmount"
        ? noAmount
        : until
          ? AlzaCore.translate(lang, "notifyCashbackOpen", refund, until)
          : AlzaCore.translate(lang, "notifyCashbackOpenNoDate", refund);
  const iconUrl = await loadProductIcon(reminder.image);
  await createNotification(
    { title: reminder.name || reminder.title || "Cashback", message, requireInteraction: step === "soon", ...(iconUrl && { iconUrl }) },
    AlzaCore.isAlzaUrl(reminder.terms) ? reminder.terms : reminder.url
  );
}

// Konec tichých hodin: odložené notifikace a připomínky cashbacku hned, ne až s další kontrolou. Běžící kontrola
// je odešle sama
// afterReset = false jen z obnovy stavu po startu (staleRunReset) – ta by čekala sama na sebe
async function flushPendingNotifications({ afterReset = true } = {}) {
  // Po startu může být ve stavu ještě „running“ z přerušeného běhu – odložené notifikace by počkaly až na další běh
  if (afterReset) await staleRunReset;
  const settings = await AlzaCore.getSettings();
  if (AlzaCore.isQuietTime(settings)) return; // Tiché hodiny se mezitím změnily – odešle je další kontrola
  const pending = await withStateLock(async () => {
    const state = await getState();
    if (state.running || !state.pendingNotifications?.length) return [];
    await saveState({ ...state, pendingNotifications: [] });
    return state.pendingNotifications;
  });
  // Každé zvlášť – chyba notifikace nesmí zastavit připomínky
  await notifyChanges(pending).catch((error) => console.error("Odložené notifikace se nepodařilo odeslat:", error));
  if (!running) {
    await processCashbackReminders();
    await processWarrantyReminders();
  }
}

// Změny z deníku přerušeného běhu do přehledu změn, čísla na ikoně a odložených notifikací (stejně jako finishRun)
async function recoverJournal(state, journal) {
  const settings = await AlzaCore.getSettings();
  const shown = filterNotifications(journal, settings, { withRises: true });
  const unseen = state.unseen || [];
  const recent = addRecentChanges(state.recent, shown, unseen, Date.now());
  return {
    pendingNotifications: mergeNotifications([...(state.pendingNotifications || []), ...filterNotifications(journal, settings)]).slice(-config.maxPendingNotifications),
    recent,
    unseen: [...new Set([...unseen, ...shown.map(({ url, domain }) => AlzaCore.getProductKey(domain, url))])].filter((key) => recent.some((item) => item.key === key)),
  };
}

// Deník běhu: změny zjištěné do této chvíle. Přeruší-li se běh (zavřený prohlížeč, uspaná služba), obnoví je
// staleRunReset – cena je totiž v historii zapsaná hned a další běh by změnu už neviděl
function saveJournal(changes) {
  return withStateLock(async () => saveState({ ...(await getState()), journal: changes })).catch((error) => console.error("Deník běhu se nepodařilo uložit:", error));
}

// Produkty všech hlídaných seznamů, hlídané produkty z detailu a produkty s cílovou cenou bez duplicit
// (produkt může být ve více seznamech a pokaždé s trochu jinou adresou – porovnává se číslo produktu)
async function getWatchedProducts() {
  const {
    [WATCH_LISTS_KEY]: lists = {},
    [WATCH_PRODUCTS_KEY]: watchedProducts = {},
    [TARGETS_KEY]: targets = {},
    [PURCHASES_KEY]: purchases = {},
  } = await chrome.storage.local.get([WATCH_LISTS_KEY, WATCH_PRODUCTS_KEY, TARGETS_KEY, PURCHASES_KEY]);
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
  // Koupené zboží ve lhůtě pro vrácení – i když už je hlídané jinak, dostane údaje o nákupu (checkPurchase).
  // Hlídané jen kvůli nákupu (purchaseOnly – není v seznamu, z detailu ani s cílovou cenou): ohlásí se jen
  // zlevnění pod nákupní cenu, ne běžné změny ceny a dostupnosti
  if (settings.watchPurchases) {
    const now = Date.now();
    Object.values(purchases).forEach((purchase) => {
      if (!purchase || !(purchase.returnUntil > now)) return;
      const key = AlzaCore.getProductKey(purchase.domain, purchase.url);
      const watchedOtherwise = products.has(key);
      add(purchase.url, purchase.name, purchase.domain, purchase.url, purchase.image);
      const product = products.get(key);
      if (!product) return;
      product.purchase = purchase;
      if (!watchedOtherwise) {
        product.purchaseOnly = true;
        // Místo seznamu odkaz na Moje objednávky – v přehledu změn je vidět, proč se produkt hlídá
        product.listUrl = `${AlzaCore.domains[purchase.domain].origin}${AlzaCore.ordersPath}`;
        product.listName = AlzaCore.translate(product.textLang, "purchaseOrdersLink");
      }
    });
  }

  return [...products.values()];
}

// Hlídání po nákupu: zlevnění pod nákupní cenu ve lhůtě pro vrácení – „Koupili jste za X, teď stojí Y. Do D ho
// můžete vrátit a koupit znovu.“ Každé nové minimum jen jednou (notifiedPrice)
// history = historie před právě načtenou cenou – srovnává se s nejnižší cenou k zaplacení kolem nákupu (kód,
// AlzaPlus+), ne jen s cenou z objednávky; jinak by hlásilo zlevnění, které tu bylo už v den nákupu
function checkPurchase(product, priceMap, history) {
  const drop = AlzaCore.getPurchaseDrop(product.purchase, priceMap, Date.now(), history);
  if (!drop) return null;
  purchaseUpdates[AlzaCore.getProductKey(product.domain, product.url)] = drop.lowest;
  const format = (price) => AlzaCore.formatPrice(price, product.domain);
  const lang = product.textLang || product.lang;
  const until = AlzaCore.formatTextDate(product.purchase.returnUntil, lang);
  const paid = drop.reference ?? product.purchase.price;
  return { kind: "purchase", text: AlzaCore.translate(lang, "notifyPurchaseDrop", format(paid), format(drop.lowest), until) };
}

async function savePurchaseStates(updates) {
  if (Object.keys(updates).length === 0) return;
  // existingOnly: nákup mezitím odstraněný synchronizací (zrušená objednávka) se nevytvoří znovu jako osiřelý záznam
  await AlzaStore.run({
    type: "patchMap",
    key: PURCHASES_KEY,
    merge: Object.fromEntries(Object.entries(updates).map(([key, price]) => [key, { notifiedPrice: price }])),
    existingOnly: true,
  });
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
    const purchase = checkPurchase(product, last.p, before.slice(0, -1));
    const changes = target || purchase ? [target, purchase, ...describeSuspicious(before, last.p, product)].filter(Boolean) : [];
    return { skipped: true, changes, price: AlzaCore.getLowestPrice(last.p), name: AlzaCore.getLatestName(before) };
  }

  const result = await fetchProduct(url);
  if (!result.ok) {
    // blocked: Alza blokuje (403 / 429) nebo má výpadek (5xx) – několik takových po sobě běh ukončí (runWatch)
    const blocked = [403, 429].includes(result.status) || result.status >= 500;
    return { problem: AlzaCore.translate(textLang, "notifyProblemFetch", AlzaCore.localizeError(textLang, result.error)), blocked };
  }
  // Zboží bez DPH (knihy – bez vedlejší ceny „bez DPH“): ověření z historie produktu nebo z jiné stránky. Takový
  // výsledek je jen odvozený – nezapisovat ho jako nové ověření DPH, jinak by se obnovovalo bez důkazu ze stránky
  const vatFromPage = !(result.saveProblem === "notifyProblemVatUnknown" && result.vatSignMissing);
  result.saveProblem = await AlzaCore.resolveSaveProblem(result.saveProblem, result.vatSignMissing, result.prices, domain, url);

  // Ověření DPH pro stránky bez jeho znaku (homepage – browsing.js). getSaveProblem ověřuje DPH jen u produktu s cenou
  const vatChecked = result.saveProblem === "notifyProblemWithoutVat" ? false : !result.saveProblem && AlzaCore.getPriceEntries(result.prices || {}).length > 0 ? true : null;
  if (vatChecked !== null && vatFromPage) await AlzaCore.recordVatCheck(domain, vatChecked).catch((error) => console.error("Ověření DPH se nepodařilo uložit:", error));

  // Ceny se smí zapsat jen za přihlášeného uživatele a s DPH. Obojí je nastavení účtu, takže by selhaly i další
  // produkty – běh se přeruší. Neověřené DPH jednoho produktu (zboží bez DPH bez historie) ostatní nezastaví
  if (result.saveProblem) return { problem: AlzaCore.translate(textLang, result.saveProblem), abort: result.saveProblem !== "notifyProblemVatUnknown" };

  if (!result.isProduct) return { problem: AlzaCore.translate(textLang, "notifyProblemNotProduct") };

  const hasPrices = AlzaCore.getPriceEntries(result.prices).length > 0;
  const availability = AlzaCore.classifyAvailability(result.availability, lang);
  if (!hasPrices && availability === null) return { problem: AlzaCore.translate(textLang, "notifyProblemNoData") };

  const snapshot = AlzaCore.toPriceMap(result.prices);
  // Produkt hlídaný jen kvůli nákupu: historie se zapíše, ale ohlásí se jen zlevnění pod nákupní cenu (checkPurchase)
  const changes = product.purchaseOnly ? [] : describeChanges(last, snapshot, availability, { ...product, discountCode: result.prices?.discount?.code || null });
  const target = checkTarget(product, snapshot, targets, targetUpdates);
  if (target) changes.push(target);
  const purchase = checkPurchase(product, snapshot, before);
  if (purchase) changes.push(purchase);

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
function describeChanges(last, snapshot, availability, { domain, lang: domainLang, textLang, discountCode = null }) {
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
      // Nový slevový kód i se samotným kódem (trezor kódů v popupu) – „Nový slevový kód OPPOX10256GB: 26 490 Kč“
      const text = type === "discount" && discountCode ? AlzaCore.translate(lang, "notifyNewCode", discountCode, format(price)) : AlzaCore.translate(lang, "notifyNewPrice", label, format(price));
      changes.push({ kind: "new", text });
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
// Počet produktů se změnou od posledního otevření popupu, barva podle kaskády (AlzaCore.getBadgeTone): zelená =
// aspoň jedno zlevnění, červená = aspoň jedno zdražení, šedá = jen ukončení / nedostupnost. Když žádné nejsou,
// modré = produkty navržené ke smazání (nehlídané a dlouho nekontrolované), dokud je uživatel neodloží
const BADGE_COLORS = { down: "#2e7d32", up: "#c62828", off: "#757575" };

async function updateBadge({ unseen, recent } = {}) {
  unseen = Array.isArray(unseen) ? unseen : [];
  const { [CLEANUP_KEY]: cleanup = {} } = await chrome.storage.local.get(CLEANUP_KEY);
  const suggest = cleanup.count > 0 && !(cleanup.snoozedUntil > Date.now());
  const name = chrome.i18n.getMessage("name");

  if (unseen.length > 0 || !suggest) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[AlzaCore.getBadgeTone(recent, unseen)] });
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
    // Číslo na ikoně ve frontě – jinak by souběžné „viděno“ z popupu mohlo přepsat starým číslem
    await updateBadge(await getState());
  });
}

// keys = produkty otevřeného seznamu, null = vše (otevřený popup)
async function markSeen(keys) {
  // Před frontou – obnova po startu workeru sama čeká ve frontě (uvnitř by čekala sama na sebe) a jinak by
  // vrátila na ikonu staré číslo
  await staleRunReset;
  return withStateLock(async () => {
    const state = await getState();
    const unseen = keys ? (state.unseen || []).filter((key) => !keys.includes(key)) : [];
    if (unseen.length === (state.unseen || []).length) return updateBadge(state); // Beze změny – jen srovnat ikonu
    await saveState({ ...state, unseen });
    await updateBadge({ ...state, unseen });
  });
}

// Odložené notifikace z tichých hodin + nové: jeden záznam za produkt (podle čísla produktu – seznam a nákup můžou
// mít jinou adresu), řádky bez opakování
function mergeNotifications(notifications) {
  const byProduct = new Map();
  notifications.forEach((notification) => {
    const key = AlzaCore.isKnownDomain(notification.domain) ? AlzaCore.getProductKey(notification.domain, notification.url) : notification.url;
    const existing = byProduct.get(key);
    if (existing) {
      existing.lines = [...new Set([...existing.lines, ...notification.lines])];
    } else {
      byProduct.set(key, { ...notification, lines: [...notification.lines] });
    }
  });
  return [...byProduct.values()];
}

async function notifyChanges(changes) {
  if (changes.length === 0) return;

  // Windows ukáže v notifikaci jen pár řádků – po jednom produktu se čte nejlépe
  if (changes.length <= config.maxIndividualNotifications) {
    for (const change of changes) {
      try {
        const iconUrl = await loadProductIcon(change.image);
        await createNotification({ title: change.name, message: change.lines.join("\n"), ...(iconUrl && { iconUrl }) }, change.url);
      } catch (error) {
        console.error("Notifikaci se nepodařilo vytvořit:", error); // Ostatní produkty i tak
      }
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
    const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(config.notificationImageTimeoutMs) });
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
  // Cíl kliknutí uložit dřív, než se notifikace ukáže – rychlé kliknutí by jinak nic neotevřelo
  if (targetUrl) await chrome.storage.session.set({ [notifyTargetKey(notificationId)]: targetUrl });
  try {
    await chrome.notifications.create(notificationId, { ...defaults, ...options });
  } catch (error) {
    // Obrázek, který Chrome neumí zobrazit – raději ikona doplňku než žádná notifikace
    try {
      if (!options.iconUrl) throw error;
      await chrome.notifications.create(notificationId, { ...defaults, ...options, iconUrl: defaults.iconUrl });
    } catch (finalError) {
      if (targetUrl) await chrome.storage.session.remove(notifyTargetKey(notificationId));
      throw finalError;
    }
  }
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
    // Opakované pokusy bez připojení (každých pár minut) jako jeden záznam – jinak vytlačí skutečné běhy
    if (entry.offline && runs[0]?.offline) runs[0] = { ...entry, start: runs[0].start };
    else runs.unshift(entry);
    await chrome.storage.local.set({ [WATCH_LOG_KEY]: runs.slice(0, config.logMaxRuns) });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
