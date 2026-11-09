// === Překlady ===
// Jazyk popupu podle jazyka prohlížeče (popup nepatří k žádné doméně Alzy); jiné jazyky → angličtina.
// Texty změn a problémů z kontroly na pozadí jsou už uložené v jazyce domény produktu.
const POPUP_TEXTS = {
  cz: {
    title: "Alza Price Insight",
    showProducts: "Zobrazit produkty",
    noProducts: "Žádné produkty",
    cleanupText: "{0} produktů už přes 3 měsíce nehlídáte ani neotevíráte – navrhujeme je smazat.",
    cleanupHint: "Produkty, které nejsou v žádném hlídaném seznamu, nehlídáte z detailu, nemají cílovou cenu a přes 3 měsíce se nekontrolovaly ani neotevřely (uložené při procházení přes rok). Smaže se jejich historie cen a uložené ceny – v nastavení si je nejdřív prohlédnete a smazání potvrdíte.",
    cleanupReview: "Prohlédnout a smazat",
    cleanupSnooze: "Připomenout za měsíc",
    openOptionsTitle: "Nastavení, hlídané produkty, cílové ceny, záloha",
    changes: "Změny cen",
    changesNew: "Nové změny cen ({0})",
    changesRecent: "Poslední změny cen",
    codesTitle: "Slevové kódy ({0})",
    codeWithPrice: "s kódem {0}",
    codeCopy: "Kopírovat",
    codeCopied: "Zkopírováno",
    cashbackTitle: "Cashback k registraci ({0})",
    cashbackRefund: "až {0} zpět",
    cashbackUntil: "registrace do {0}",
    cashbackFrom: "registrace od {0}",
    cashbackRange: "registrace {0} – {1}",
    cashbackNoDate: "lhůta v podmínkách akce",
    cashbackTerms: "Podmínky akce",
    cashbackDone: "Hotovo",
    cashbackDoneTitle: "Nákup mám zaregistrovaný – už nepřipomínat",
    watchList: "Hlídat seznam",
    unwatchList: "Nehlídat seznam ({0})",
    openListHint: "Otevřete nákupní seznam na Alze",
    runNow: "Zkontrolovat",
    runNowTitle: "Zkontrolovat hlídané produkty teď",
    listSynced: "Synchronizováno {0}",
    openAlzaTitle: "Otevřít {0}",
    listSummary: "Za posledních 7 dní: zlevnilo {0}, zdražilo {1} (nejnižší cena)",
    listNoChanges: "beze změn",
    actionFailed: "Nepovedlo se: {0}",
    watchedProducts: "Hlídané produkty ({0})",
    running: "Probíhá kontrola (od {0})",
    lastRun: "Kontrola {0} · {1} produktů · změn {2}",
    noRunYet: "Zatím neproběhla žádná kontrola",
    nextRun: "Další kontrola {0}",
    pending: "Odloženo do konce tichých hodin: {0}",
  },
  sk: {
    title: "Alza Price Insight",
    showProducts: "Zobraziť produkty",
    noProducts: "Žiadne produkty",
    cleanupText: "{0} produktov už viac ako 3 mesiace nesledujete ani neotvárate – navrhujeme ich zmazať.",
    cleanupHint: "Produkty, ktoré nie sú v žiadnom sledovanom zozname, nesledujete z detailu, nemajú cieľovú cenu a viac ako 3 mesiace sa nekontrolovali ani neotvorili (uložené pri prehliadaní viac ako rok). Zmaže sa ich história cien a uložené ceny – v nastaveniach si ich najprv pozriete a zmazanie potvrdíte.",
    cleanupReview: "Pozrieť a zmazať",
    cleanupSnooze: "Pripomenúť o mesiac",
    openOptionsTitle: "Nastavenia, sledované produkty, cieľové ceny, záloha",
    changes: "Zmeny cien",
    changesNew: "Nové zmeny cien ({0})",
    changesRecent: "Posledné zmeny cien",
    codesTitle: "Zľavové kódy ({0})",
    codeWithPrice: "s kódom {0}",
    codeCopy: "Kopírovať",
    codeCopied: "Skopírované",
    cashbackTitle: "Cashback na registráciu ({0})",
    cashbackRefund: "až {0} späť",
    cashbackUntil: "registrácia do {0}",
    cashbackFrom: "registrácia od {0}",
    cashbackRange: "registrácia {0} – {1}",
    cashbackNoDate: "lehota v podmienkach akcie",
    cashbackTerms: "Podmienky akcie",
    cashbackDone: "Hotovo",
    cashbackDoneTitle: "Nákup mám zaregistrovaný – už nepripomínať",
    watchList: "Sledovať zoznam",
    unwatchList: "Nesledovať zoznam ({0})",
    openListHint: "Otvorte nákupný zoznam na Alze",
    runNow: "Skontrolovať",
    runNowTitle: "Skontrolovať sledované produkty teraz",
    listSynced: "Synchronizované {0}",
    openAlzaTitle: "Otvoriť {0}",
    listSummary: "Za posledných 7 dní: zlacnelo {0}, zdraželo {1} (najnižšia cena)",
    listNoChanges: "bez zmien",
    actionFailed: "Nepodarilo sa: {0}",
    watchedProducts: "Sledované produkty ({0})",
    running: "Prebieha kontrola (od {0})",
    lastRun: "Kontrola {0} · {1} produktov · zmien {2}",
    noRunYet: "Zatiaľ neprebehla žiadna kontrola",
    nextRun: "Ďalšia kontrola {0}",
    pending: "Odložené do konca tichých hodín: {0}",
  },
  hu: {
    title: "Alza Price Insight",
    showProducts: "Termékek megjelenítése",
    noProducts: "Nincsenek termékek",
    cleanupText: "{0} terméket több mint 3 hónapja nem figyel és nem nyitott meg – javasoljuk a törlésüket.",
    cleanupHint: "Olyan termékek, amelyek nincsenek figyelt listán, nem figyeli őket a termékoldalról, nincs célár, és több mint 3 hónapja nem ellenőrizték vagy nyitották meg őket (a böngészés közben mentetteket több mint egy éve). Az árelőzményeik és mentett áraik törlődnek – a beállításokban előbb megtekinti, majd megerősíti a törlést.",
    cleanupReview: "Megtekintés és törlés",
    cleanupSnooze: "Emlékeztessen egy hónap múlva",
    openOptionsTitle: "Beállítások, figyelt termékek, célárak, biztonsági mentés",
    changes: "Árváltozások",
    changesNew: "Új árváltozások ({0})",
    changesRecent: "Legutóbbi árváltozások",
    codesTitle: "Kuponkódok ({0})",
    codeWithPrice: "kóddal {0}",
    codeCopy: "Másolás",
    codeCopied: "Másolva",
    cashbackTitle: "Regisztrálandó cashback ({0})",
    cashbackRefund: "akár {0} vissza",
    cashbackUntil: "regisztrációs határidő: {0}",
    cashbackFrom: "regisztráció kezdete: {0}",
    cashbackRange: "regisztráció: {0} – {1}",
    cashbackNoDate: "határidő az akció feltételeiben",
    cashbackTerms: "Akciós feltételek",
    cashbackDone: "Kész",
    cashbackDoneTitle: "A vásárlást regisztráltam – ne emlékeztessen",
    watchList: "Lista figyelése",
    unwatchList: "Figyelés leállítása ({0})",
    openListHint: "Nyisson meg egy bevásárlólistát az Alzán",
    runNow: "Ellenőrzés",
    runNowTitle: "Figyelt termékek ellenőrzése most",
    listSynced: "Szinkronizálva: {0}",
    openAlzaTitle: "{0} megnyitása",
    listSummary: "Az elmúlt 7 napban: {0} olcsóbb lett, {1} drágább (legalacsonyabb ár)",
    listNoChanges: "nincs változás",
    actionFailed: "Nem sikerült: {0}",
    watchedProducts: "Figyelt termékek ({0})",
    running: "Ellenőrzés folyamatban ({0} óta)",
    lastRun: "Ellenőrzés {0} · {1} termék · {2} változás",
    noRunYet: "Még nem volt ellenőrzés",
    nextRun: "Következő ellenőrzés: {0}",
    pending: "A csendes órák végéig elhalasztva: {0}",
  },
  en: {
    title: "Alza Price Insight",
    showProducts: "Show products",
    noProducts: "No products",
    cleanupText: "{0} products haven't been watched or opened for over 3 months – we suggest deleting them.",
    cleanupHint: "Products that aren't in any watched list, aren't watched from the product page, have no target price and haven't been checked or opened for over 3 months (products saved while browsing: over a year). Their price history and stored prices will be deleted – you review them in settings first and confirm the deletion.",
    cleanupReview: "Review and delete",
    cleanupSnooze: "Remind me in a month",
    openOptionsTitle: "Settings, watched products, target prices, backup",
    changes: "Price changes",
    changesNew: "New price changes ({0})",
    changesRecent: "Recent price changes",
    codesTitle: "Discount codes ({0})",
    codeWithPrice: "with code {0}",
    codeCopy: "Copy",
    codeCopied: "Copied",
    cashbackTitle: "Cashback to register ({0})",
    cashbackRefund: "up to {0} back",
    cashbackUntil: "register by {0}",
    cashbackFrom: "register from {0}",
    cashbackRange: "register {0} – {1}",
    cashbackNoDate: "deadline in the promotion terms",
    cashbackTerms: "Promotion terms",
    cashbackDone: "Done",
    cashbackDoneTitle: "I've registered the purchase – stop reminding me",
    watchList: "Watch list",
    unwatchList: "Stop watching list ({0})",
    openListHint: "Open a shopping list on Alza",
    runNow: "Check now",
    runNowTitle: "Check watched products now",
    listSynced: "Synced {0}",
    openAlzaTitle: "Open {0}",
    listSummary: "Last 7 days: {0} cheaper, {1} more expensive (lowest price)",
    listNoChanges: "no changes",
    actionFailed: "Failed: {0}",
    watchedProducts: "Watched products ({0})",
    running: "Check in progress (since {0})",
    lastRun: "Checked {0} · {1} products · {2} changes",
    noRunYet: "No check has run yet",
    nextRun: "Next check {0}",
    pending: "Postponed until quiet hours end: {0}",
  },
};

// Jiný jazyk prohlížeče než cs/sk/hu → angličtina
const UI_LANGUAGES = {
  cs: { lang: "cz", locale: "cs-CZ" },
  sk: { lang: "sk", locale: "sk-SK" },
  hu: { lang: "hu", locale: "hu-HU" },
  en: { lang: "en", locale: "en-GB" },
};
// Zatím podle prohlížeče – volbu z nastavení (storage je jen asynchronní) doplní init na konci souboru
let uiLanguage = AlzaCore.getUiLanguage();
let ui = UI_LANGUAGES[uiLanguage];

function t(key, ...params) {
  return AlzaCore.translateFrom(POPUP_TEXTS, ui.lang, key, params);
}

// Ikony před texty (src/shared/icons.js) – emoji v textech nejsou, ikonu přidá setText podle klíče textu
const POPUP_ICONS = {
  cleanupText: "cleaning",
  cleanupReview: "cleaning",
  watchList: "bell",
  unwatchList: "bell-off",
  runNow: "refresh",
  actionFailed: "warning",
  running: "hourglass",
  nextRun: "schedule",
  pending: "moon",
};

function setText(element, key, ...params) {
  element.textContent = t(key, ...params);
  if (POPUP_ICONS[key]) AlzaIcons.prepend(element, POPUP_ICONS[key], { tone: key === "actionFailed" });
  return element;
}

function applyStaticTexts() {
  document.documentElement.lang = ui.locale.split("-")[0];
  document.querySelectorAll("[data-i18n]").forEach((element) => setText(element, element.dataset.i18n));
  AlzaIcons.decorate(document);
  document.querySelectorAll("[data-i18n-title]").forEach((element) => (element.title = t(element.dataset.i18nTitle)));
}
applyStaticTexts();

// Služba na pozadí na tyto zprávy neodpovídá – zavřený port není chyba
function sendToBackground(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

document.getElementById("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

// === Domény Alzy ===
// Data jsou oddělená po doménách, popup ukazuje všechny dohromady. Doména otevřené záložky (null = jiná
// stránka než Alza) určuje odkaz na Alzu; štítek domény se ukáže, jen když hlídáte víc domén
let activeDomain = null;

async function getActiveTabDomain() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // Adresu záložky prohlížeč popupu prozradí jen u stránek Alzy (host_permissions)
    return tab?.url && AlzaCore.isAlzaUrl(tab.url) ? AlzaCore.getDomainKey(new URL(tab.url).hostname) : null;
  } catch {
    return null;
  }
}

function getUrlDomain(url) {
  return AlzaCore.isAlzaUrl(url) ? AlzaCore.getDomainKey(new URL(url).hostname) : null;
}

function getHost(domain) {
  return new URL(AlzaCore.domains[domain].origin).hostname.replace(/^www\./, "");
}

// Štítek „CZ“ / „SK“ / „HU“ (null = jedna doména, štítek není potřeba)
function createDomainBadge(domain, show) {
  if (!show || !AlzaCore.isKnownDomain(domain)) return null;
  const badge = document.createElement("span");
  badge.className = "domain-badge";
  badge.textContent = AlzaCore.domains[domain].lang.toUpperCase();
  badge.title = getHost(domain);
  return badge;
}

// Odkaz na Alzu: doména otevřené záložky, jinak hlavní Alza z nastavení (průvodce, nastavení), jinak prvního
// hlídaného seznamu, jinak podle jazyka prohlížeče
const UI_DOMAINS = { cz: "alza_cz", sk: "alza_sk", hu: "alza_hu", en: "alza_cz" };
let primaryDomain = null;
// Ikonou je favicona Alzy; když se nenačte (offline), zobrazí se doména
function renderAlzaLink(lists) {
  const domain =
    activeDomain || primaryDomain || Object.values(lists).find((list) => AlzaCore.isKnownDomain(list?.domain))?.domain || UI_DOMAINS[ui.lang] || "alza_cz";
  const origin = AlzaCore.domains[domain].origin;
  const host = getHost(domain);
  const link = document.getElementById("openAlza");
  link.href = `${origin}/`;
  link.title = t("openAlzaTitle", host);
  if (link.dataset.origin === origin) return;
  link.dataset.origin = origin;
  const icon = document.createElement("img");
  icon.alt = host;
  icon.addEventListener("error", () => (link.textContent = `${host} ↗`));
  icon.src = `${origin}/favicon-alza.ico`;
  link.replaceChildren(icon);
}

// === Hlídání cen na pozadí ===
const WATCH_LISTS_KEY = AlzaCore.storageKeys.watchLists;
const TARGETS_KEY = AlzaCore.storageKeys.targets;
const WATCH_PRODUCTS_KEY = AlzaCore.storageKeys.watchProducts;
const CLEANUP_KEY = AlzaCore.storageKeys.cleanup;
const WATCH_STATE_KEY = AlzaCore.storageKeys.watchState;
const CODES_KEY = AlzaCore.storageKeys.codes;
const CODES_MAX_AGE_MS = 30 * AlzaCore.dayMs; // Trezor ukazuje kódy viděné za posledních 30 dní
const CASHBACK_REMINDERS_KEY = AlzaCore.storageKeys.cashbackReminders;

const toggleWatchButton = document.getElementById("toggleWatch");
const runWatchNowButton = document.getElementById("runWatchNow");
let watchState = null;
let newChangeKeys = new Set(); // Produkty z čísla na ikoně při otevření popupu a z kontrol doběhlých, dokud je otevřený

function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString(ui.locale, { dateStyle: "short", timeStyle: "short" }) : "–";
}

// Odpověď content scriptu otevřené záložky; null = jiná stránka než seznam (content script neběží)
async function sendToActiveTab(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? ((await chrome.tabs.sendMessage(tab.id, message)) ?? null) : null;
  } catch {
    return null;
  }
}

// Chyba akce v popupu – uživatel ji uvidí místo „nic se nestalo“ (zapíše se i do logu chyb)
function showError(error) {
  console.error("Popup:", error);
  const status = document.getElementById("watchStatus");
  setText(status, "actionFailed", error?.message || error);
  status.classList.add("error");
}

function renderToggle() {
  toggleWatchButton.disabled = !watchState?.listId;
  toggleWatchButton.title = "";
  if (!watchState?.listId) {
    setText(toggleWatchButton, "watchList");
    toggleWatchButton.title = t("openListHint");
  } else if (watchState.watched) {
    setText(toggleWatchButton, "unwatchList", watchState.count);
  } else {
    setText(toggleWatchButton, "watchList");
  }
}

async function renderWatch() {
  const data = await chrome.storage.local.get([WATCH_LISTS_KEY, WATCH_STATE_KEY, TARGETS_KEY, WATCH_PRODUCTS_KEY, CLEANUP_KEY]);
  const lists = data[WATCH_LISTS_KEY] || {};
  const targetCount = Object.keys(data[TARGETS_KEY] || {}).length;
  const productCount = Object.keys(data[WATCH_PRODUCTS_KEY] || {}).length;
  const state = data[WATCH_STATE_KEY] || {};
  const nextAlarm = await chrome.alarms.get("alzaWatchRun").catch(() => null);

  renderAlzaLink(lists);
  const watchedProducts = Object.values(data[WATCH_PRODUCTS_KEY] || {}).filter(Boolean);
  // Poškozený záznam (null) nesmí shodit popup
  const validLists = Object.entries(lists).filter(([, list]) => list);
  const domains = new Set(
    [
      ...validLists.map(([, list]) => list.domain),
      ...watchedProducts.map((product) => product.domain),
      ...Object.values(data[TARGETS_KEY] || {}).map((target) => target?.domain),
      ...(state.recent || []).map((item) => getUrlDomain(item.url)),
    ].filter((domain) => AlzaCore.isKnownDomain(domain))
  );
  const showDomains = domains.size > 1;

  const listElement = document.getElementById("watchLists");
  listElement.replaceChildren(
    ...validLists.map(([key, list]) => {
      const link = document.createElement("a");
      if (AlzaCore.isAlzaUrl(list.url)) link.href = list.url;
      link.target = "_blank";
      link.textContent = `${list.name || list.listId || "–"} (${Object.keys(list.products || {}).length})`;
      link.title = t("listSynced", formatTime(list.syncedAt));

      const products = Object.entries(list.products || {}).map(([url, info]) => ({ url, domain: list.domain, name: info?.name, image: info?.image }));
      return createWatchGroup(`list:${key}`, link, products, { badge: createDomainBadge(list.domain, showDomains) }, createWatchSummary(products));
    })
  );

  // Produkty hlídané z detailu – název jen rozbalí seznam (správa je na stránce nastavení). Můžou být z více
  // domén – štítek pak má každý produkt
  if (productCount > 0) {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = t("watchedProducts", productCount);
    const item = createWatchGroup("products", link, watchedProducts, { productBadges: showDomains }, createWatchSummary(watchedProducts));
    link.addEventListener("click", (event) => {
      event.preventDefault();
      item.querySelector(".expand").click();
    });
    listElement.appendChild(item);
  }

  const status = document.getElementById("watchStatus");
  status.replaceChildren();
  status.classList.remove("error");
  const addLine = (text, className, icon) => {
    const line = document.createElement("div");
    line.textContent = text;
    if (className) line.className = className;
    if (icon) AlzaIcons.prepend(line, icon, { tone: icon === "warning" });
    status.appendChild(line);
    return line;
  };

  if (state.running) {
    addLine(t("running", formatTime(state.lastRunStart)), null, POPUP_ICONS.running);
  } else if (state.lastRunEnd) {
    const line = addLine(t("lastRun", formatTime(state.lastRunEnd), state.checked || 0, state.changes?.length || 0));
    // Počet cílových cen za ikonou terče
    if (targetCount) line.append(" · ", AlzaIcons.create(document, "target"), String(targetCount));
  } else {
    addLine(t("noRunYet"));
  }
  // Kdy proběhne další kontrola na pozadí (frekvence podle nastavení) – jen když je co hlídat
  const watching = Object.keys(lists).length > 0 || targetCount > 0 || productCount > 0;
  if (!state.running && watching && nextAlarm?.scheduledTime) addLine(t("nextRun", formatTime(nextAlarm.scheduledTime)), null, POPUP_ICONS.nextRun);
  if (state.pendingNotifications?.length) addLine(t("pending", state.pendingNotifications.length), null, POPUP_ICONS.pending);
  // Název produktu s problémem je odkaz – rychle se na produkt podívat
  (state.problems || []).forEach((problem) => {
    if (!problem.url || !AlzaCore.isAlzaUrl(problem.url)) {
      addLine(`${problem.name}: ${problem.message}`, "watch-problem", "warning");
      return;
    }
    const line = addLine("", "watch-problem", "warning");
    const link = document.createElement("a");
    link.href = problem.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = problem.name;
    line.append(link, `: ${problem.message}`);
  });
  runWatchNowButton.disabled = Boolean(state.running) || (Object.keys(lists).length === 0 && targetCount === 0 && productCount === 0);
  renderChanges(state.recent || [], showDomains);
  renderCleanup(data[CLEANUP_KEY] || {});
}

// === Návrh čistky ===
// Modré číslo na ikoně: nehlídané produkty bez kontroly přes 3 měsíce (počítá služba na pozadí).
// Mazání jen v nastavení po prohlédnutí a potvrzení, odložení skryje číslo i upozornění na měsíc
function renderCleanup(cleanup) {
  const notice = document.getElementById("cleanupNotice");
  notice.hidden = !(cleanup.count > 0) || cleanup.snoozedUntil > Date.now();
  if (notice.hidden) return;
  setText(document.getElementById("cleanupText"), "cleanupText", cleanup.count);
  notice.title = t("cleanupHint");
}

document.getElementById("cleanupReview").addEventListener("click", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html#cleanup") })
);

document.getElementById("cleanupSnooze").addEventListener("click", async () => {
  try {
    await AlzaStore.run({ type: "assign", key: CLEANUP_KEY, values: { snoozedUntil: Date.now() + AlzaCore.cleanupSnoozeDays * AlzaCore.dayMs } });
    sendToBackground({ action: "cleanupRefresh" });
  } catch (error) {
    showError(error);
  }
});

// === Rozbalené seznamy ===
// Řádek seznamu / hlídaných produktů se šipkou; rozbalení ukáže produkty s cenou z poslední kontroly.
// Rozbalené zůstávají i po překreslení (kontrola na pozadí mění stav a seznamy)
const expandedGroups = new Set();

// badge = štítek domény celé skupiny (před názvem), productBadges = štítek u každého produktu
function createWatchGroup(groupKey, link, products, { badge = null, productBadges = false } = {}, ...actions) {
  const item = document.createElement("li");
  const expand = document.createElement("button");
  expand.className = "expand";
  expand.title = t("showProducts");
  item.append(...[expand, badge, link, ...actions].filter(Boolean));

  const update = () => {
    const open = expandedGroups.has(groupKey);
    expand.textContent = open ? "▼" : "▶";
    expand.setAttribute("aria-expanded", String(open));
    item.querySelector(".watch-products")?.remove();
    if (open) item.appendChild(createProductPanel(products, productBadges));
  };
  expand.addEventListener("click", () => {
    if (!expandedGroups.delete(groupKey)) expandedGroups.add(groupKey);
    update();
  });
  update();
  return item;
}

// Kolik produktů skupiny za posledních 7 dní zlevnilo / zdražilo (nejnižší cena teď proti ceně před týdnem;
// produkty s historií kratší než týden se nepočítají). Doplní se po načtení historií
const SUMMARY_DAYS = 7;

function createWatchSummary(products) {
  const summary = document.createElement("span");
  summary.className = "watch-summary";
  const valid = products.filter((product) => AlzaCore.isKnownDomain(product.domain) && AlzaCore.isAlzaUrl(product.url));
  if (valid.length === 0) return summary;

  const historyKeys = valid.map((product) => AlzaCore.getHistoryKey(product.domain, product.url));
  chrome.storage.local.get(historyKeys).then((histories) => {
    const cutoff = Date.now() - SUMMARY_DAYS * AlzaCore.dayMs;
    let down = 0;
    let up = 0;
    historyKeys.forEach((key) => {
      const history = Array.isArray(histories[key]) ? histories[key] : [];
      const before = history.filter((entry) => entry?.t <= cutoff).at(-1);
      const now = AlzaCore.getLowestPrice(history.at(-1)?.p);
      const then = AlzaCore.getLowestPrice(before?.p);
      if (now === null || then === null || now === then) return;
      if (now < then) down++;
      else up++;
    });
    summary.title = t("listSummary", down, up);
    if (down === 0 && up === 0) {
      summary.textContent = t("listNoChanges");
      return;
    }
    const part = (className, text) => {
      const element = document.createElement("span");
      element.className = className;
      element.textContent = text;
      return element;
    };
    const parts = [down > 0 && part("down", `▼ ${down}`), up > 0 && part("up", `▲ ${up}`)].filter(Boolean);
    summary.replaceChildren(...parts.flatMap((element, index) => (index ? [" ", element] : [element])));
  }).catch(showError);
  return summary;
}

function createProductPanel(products, showDomains = false) {
  const panel = document.createElement("div");
  panel.className = "watch-products";
  const valid = products.filter((product) => AlzaCore.isKnownDomain(product.domain) && AlzaCore.isAlzaUrl(product.url));
  if (valid.length === 0) {
    panel.textContent = t("noProducts");
    return panel;
  }

  const historyKeys = valid.map((product) => AlzaCore.getHistoryKey(product.domain, product.url));
  chrome.storage.local.get(historyKeys).then((histories) => {
    panel.replaceChildren(
      ...valid.map((product, index) => {
        const history = Array.isArray(histories[historyKeys[index]]) ? histories[historyKeys[index]] : [];
        const row = document.createElement("div");
        row.className = "watch-product";

        const imageUrl = AlzaCore.getProductImageUrl(product.image, 48);
        if (imageUrl) {
          const image = document.createElement("img");
          image.src = imageUrl;
          image.alt = "";
          row.appendChild(image);
        }

        const badge = createDomainBadge(product.domain, showDomains);
        if (badge) row.appendChild(badge);

        const name = AlzaCore.getLatestName(history) || product.name || product.url;
        const link = document.createElement("a");
        link.href = product.url;
        link.target = "_blank";
        link.textContent = name;
        link.title = name;
        row.appendChild(link);

        const lowest = AlzaCore.getLowestPrice(history[history.length - 1]?.p);
        const price = document.createElement("span");
        price.className = "watch-product-price";
        price.textContent = lowest === null ? "–" : AlzaCore.formatPrice(lowest, product.domain);
        row.appendChild(price);
        return row;
      })
    );
  }).catch(showError);
  return panel;
}

// Přehled posledních změn – nové (číslo na ikoně při otevření popupu) zvýrazněné nahoře
// Trezor slevových kódů (AlzaCore.storageKeys.codes): produkt, kód, cena s kódem a Kopírovat – nejnovější kódy nahoře
async function renderCodes() {
  const { [CODES_KEY]: registry = {}, [AlzaCore.storageKeys.browsed]: browsed = {}, [WATCH_PRODUCTS_KEY]: watched = {} } = await chrome.storage.local.get([
    CODES_KEY,
    AlzaCore.storageKeys.browsed,
    WATCH_PRODUCTS_KEY,
  ]);
  const now = Date.now();
  const codes = Object.entries(registry)
    .filter(([, entry]) => entry?.code && AlzaCore.isAlzaUrl(entry.url) && now - (entry.seenAt || 0) < CODES_MAX_AGE_MS)
    .sort(([, a], [, b]) => (b.since || 0) - (a.since || 0))
    .slice(0, 30);
  const section = document.getElementById("codes");
  section.hidden = codes.length === 0;
  if (codes.length === 0) return;
  const toggle = document.getElementById("codesToggle");
  toggle.textContent = t("codesTitle", codes.length);
  if (!toggle.dataset.ready) {
    toggle.dataset.ready = "1";
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      document.getElementById("codesList").hidden = !open;
    });
  }

  document.getElementById("codesList").replaceChildren(
    ...codes.map(([key, entry]) => {
      const row = document.createElement("div");
      row.className = "change";
      const body = document.createElement("div");
      body.className = "change-body";
      const title = document.createElement("div");
      title.className = "change-title";
      const name = document.createElement("a");
      name.textContent = browsed[key]?.name || watched[key]?.name || decodeURIComponent(new URL(entry.url).pathname.split("/").pop().replace(/-d\d+\.htm$/, "").replace(/-/g, " "));
      name.title = name.textContent;
      name.href = entry.url;
      name.target = "_blank";
      title.appendChild(name);
      const line = document.createElement("div");
      line.className = "code-line";
      const pill = document.createElement("code");
      pill.className = "code-pill";
      pill.textContent = entry.code;
      const price = document.createElement("span");
      price.className = "code-price";
      price.textContent = Number.isFinite(entry.price) ? t("codeWithPrice", AlzaCore.formatPrice(entry.price, entry.domain)) : "";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "code-copy";
      copy.textContent = t("codeCopy");
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(entry.code).catch(() => {});
        copy.textContent = t("codeCopied");
        setTimeout(() => (copy.textContent = t("codeCopy")), 1500);
      });
      line.append(pill, price, copy);
      body.append(title, line);
      row.appendChild(body);
      return row;
    })
  );
}

// Cashback k registraci (AlzaCore.storageKeys.cashbackReminders): koupené zboží s cashbackem, lhůta registrace,
// odkaz na podmínky akce a Hotovo (už nepřipomínat) – nejbližší lhůta nahoře
async function renderCashbacks() {
  const { [CASHBACK_REMINDERS_KEY]: reminders = {} } = await chrome.storage.local.get(CASHBACK_REMINDERS_KEY);
  const now = Date.now();
  const items = Object.entries(reminders || {})
    .filter(([, reminder]) => reminder && !reminder.done && AlzaCore.isAlzaUrl(reminder.url) && AlzaCore.getCashbackReminderStep(reminder, now) !== "expired")
    .sort(([, a], [, b]) => (a.registerUntil || Infinity) - (b.registerUntil || Infinity));
  const section = document.getElementById("cashbacks");
  section.hidden = items.length === 0;
  if (items.length === 0) return;
  document.getElementById("cashbacksTitle").textContent = t("cashbackTitle", items.length);
  const date = (time) => new Date(time).toLocaleDateString(ui.locale, { day: "numeric", month: "numeric", year: "numeric" });

  document.getElementById("cashbacksList").replaceChildren(
    ...items.map(([key, reminder]) => {
      const row = document.createElement("div");
      row.className = "change";
      const body = document.createElement("div");
      body.className = "change-body";
      const title = document.createElement("div");
      title.className = "change-title";
      const name = document.createElement("a");
      name.textContent = reminder.name || reminder.title || reminder.url;
      name.title = name.textContent;
      name.href = reminder.url;
      name.target = "_blank";
      title.appendChild(name);

      const line = document.createElement("div");
      line.className = "code-line";
      const info = document.createElement("span");
      info.className = "code-price";
      const opensLater = reminder.registerFrom > now;
      const when =
        opensLater && reminder.registerUntil
          ? t("cashbackRange", date(reminder.registerFrom), date(reminder.registerUntil))
          : opensLater
            ? t("cashbackFrom", date(reminder.registerFrom))
            : reminder.registerUntil
              ? t("cashbackUntil", date(reminder.registerUntil))
              : t("cashbackNoDate");
      info.textContent = [reminder.refund > 0 ? t("cashbackRefund", AlzaCore.formatPrice(reminder.refund, reminder.domain)) : null, when].filter(Boolean).join(" · ");
      line.appendChild(info);
      if (AlzaCore.isAlzaUrl(reminder.terms)) {
        const terms = document.createElement("a");
        terms.className = "cashback-terms";
        terms.textContent = t("cashbackTerms");
        terms.href = reminder.terms;
        terms.target = "_blank";
        line.appendChild(terms);
      }
      const done = document.createElement("button");
      done.type = "button";
      done.className = "code-copy";
      done.textContent = t("cashbackDone");
      done.title = t("cashbackDoneTitle");
      done.addEventListener("click", () => {
        done.disabled = true;
        AlzaStore.run({ type: "patchMap", key: CASHBACK_REMINDERS_KEY, merge: { [key]: { done: true } } }).catch(showError);
      });
      line.appendChild(done);
      body.append(title, line);
      row.appendChild(body);
      return row;
    })
  );
}

function renderChanges(recent, showDomains = false) {
  const section = document.getElementById("changes");
  section.hidden = recent.length === 0;
  if (recent.length === 0) return;

  const newCount = recent.filter((item) => newChangeKeys.has(item.key)).length;
  document.getElementById("changesTitle").textContent = newCount > 0 ? t("changesNew", newCount) : t("changesRecent");

  const link = (url, text) => {
    const element = document.createElement("a");
    element.textContent = text;
    if (AlzaCore.isAlzaUrl(url)) {
      element.href = url;
      element.target = "_blank";
    }
    return element;
  };

  document.getElementById("changesList").replaceChildren(
    ...recent.map((item) => {
      const row = document.createElement("div");
      const lines = item.lines.map((text) => AlzaCore.upgradePriceDropText(text, item.url));
      // Druh změny: core.js getChangeTone (stejný určuje barvu čísla na ikoně)
      const tones = lines.map((text) => AlzaCore.getChangeTone(text));
      // Nová změna (číslo na ikoně) má řádek podbarvený podle první změny ceny / dostupnosti (výstraha ho
      // neurčuje); viděné zůstávají bílé a druh změny ukazuje jen barva textu
      const tone = newChangeKeys.has(item.key) && tones.find((value) => value && value !== "warning");
      row.className = tone ? `change change--${tone}` : "change";

      const imageUrl = AlzaCore.getProductImageUrl(item.image, 80);
      if (imageUrl) {
        const image = document.createElement("img");
        image.src = imageUrl;
        image.alt = "";
        row.appendChild(image);
      }

      const body = document.createElement("div");
      body.className = "change-body";
      const title = document.createElement("div");
      title.className = "change-title";
      const name = link(item.url, item.name);
      name.title = item.name;
      title.appendChild(name);
      if (item.price) {
        const price = document.createElement("span");
        price.className = "change-price";
        price.textContent = item.price;
        title.appendChild(price);
      }
      body.appendChild(title);

      lines.forEach((text, index) => {
        const line = document.createElement("div");
        line.className = tones[index] ? `change-line change-line--${tones[index]}` : "change-line";
        // Výstraha / cílová cena s ikonou (starší uložené řádky mají místo ní emoji na začátku textu)
        line.textContent = AlzaCore.stripChangeEmoji(text);
        const icon = AlzaCore.getChangeIcon(text);
        if (icon) AlzaIcons.prepend(line, icon, { tone: true });
        body.appendChild(line);
      });

      const meta = document.createElement("div");
      meta.className = "change-meta";
      const badge = createDomainBadge(getUrlDomain(item.url), showDomains);
      if (badge) meta.append(badge, " ");
      meta.append(formatTime(item.at));
      if (item.listName) meta.append(" · ", link(item.listUrl, item.listName));
      body.appendChild(meta);

      row.appendChild(body);
      return row;
    })
  );
}

toggleWatchButton.addEventListener("click", async () => {
  if (!watchState?.listId) return;
  toggleWatchButton.disabled = true;
  const next = await sendToActiveTab({ action: "setWatch", enabled: !watchState.watched });
  if (!next) showError(t("watchList"));
  watchState = next || watchState;
  renderToggle();
});

runWatchNowButton.addEventListener("click", () => {
  runWatchNowButton.disabled = true;
  sendToBackground({ action: "watchRunNow" });
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes[CODES_KEY]) renderCodes().catch(showError);
  if (area === "local" && changes[CASHBACK_REMINDERS_KEY]) renderCashbacks().catch(showError);
  if (area !== "local" || ![WATCH_LISTS_KEY, WATCH_STATE_KEY, TARGETS_KEY, WATCH_PRODUCTS_KEY, CLEANUP_KEY].some((key) => changes[key])) return;
  // Změny z kontroly doběhlé při otevřeném popupu (např. tlačítko Zkontrolovat) – zvýraznit a hned označit viděné
  const unseen = changes[WATCH_STATE_KEY]?.newValue?.unseen || [];
  // I znovu změněný, už zvýrazněný produkt – jinak by po zavření zůstalo číslo na ikoně (markSeen zapíše [] → bez smyčky)
  if (unseen.length > 0) {
    unseen.forEach((key) => newChangeKeys.add(key));
    sendToBackground({ action: "watchSeen" });
  }
  renderWatch().catch(showError);
  if (changes[WATCH_LISTS_KEY]) {
    watchState = (await sendToActiveTab({ action: "getWatchState" })) || watchState;
    renderToggle();
  }
});

(async () => {
  // Jazyk zvolený v nastavení – před prvním vykreslením
  const settings = await AlzaCore.getSettings();
  uiLanguage = AlzaCore.getUiLanguage(settings);
  ui = UI_LANGUAGES[uiLanguage];
  primaryDomain = AlzaCore.getPrimaryDomain(settings);
  applyStaticTexts();

  // Otevřený popup = změny viděny – vynulovat číslo na ikoně, ale v přehledu je nechat zvýrazněné
  const { [WATCH_STATE_KEY]: initialState = {} } = await chrome.storage.local.get(WATCH_STATE_KEY);
  newChangeKeys = new Set([...newChangeKeys, ...(initialState.unseen || [])]);
  sendToBackground({ action: "watchSeen" });
  activeDomain = await getActiveTabDomain();
  watchState = await sendToActiveTab({ action: "getWatchState" });
  renderToggle();
  await renderWatch();
  await renderCodes();
  await renderCashbacks();
})().catch(showError);
