// === Překlady ===
// Jazyk popupu podle jazyka prohlížeče (popup nepatří k žádné doméně Alzy); jiné jazyky → angličtina.
// Texty změn a problémů z kontroly na pozadí jsou už uložené v jazyce domény produktu.
const POPUP_TEXTS = {
  cz: {
    title: "Alza Price Insight",
    showProducts: "Zobrazit produkty",
    noProducts: "Žádné produkty",
    cleanupText: "🧹 {0} produktů už přes 3 měsíce nehlídáte ani neotevíráte – navrhujeme je smazat.",
    cleanupHint: "Produkty, které nejsou v žádném hlídaném seznamu, nehlídáte z detailu, nemají cílovou cenu a přes 3 měsíce se nekontrolovaly ani neotevřely (uložené při procházení přes rok). Smaže se jejich historie cen a uložené ceny – v nastavení si je nejdřív prohlédnete a smazání potvrdíte.",
    cleanupReview: "🧹 Prohlédnout a smazat",
    cleanupSnooze: "Připomenout za měsíc",
    openOptionsTitle: "Nastavení, hlídané produkty, cílové ceny, záloha",
    changes: "Změny cen",
    changesNew: "Nové změny cen ({0})",
    changesRecent: "Poslední změny cen",
    watchList: "🔔 Hlídat seznam",
    unwatchList: "🔕 Nehlídat seznam ({0})",
    openListHint: "Otevřete nákupní seznam na Alze",
    runNow: "▶️ Zkontrolovat",
    runNowTitle: "Zkontrolovat hlídané produkty teď",
    listSynced: "Synchronizováno {0}",
    openAlzaTitle: "Otevřít {0}",
    listSummary: "Za posledních 7 dní: zlevnilo {0}, zdražilo {1} (nejnižší cena)",
    listNoChanges: "beze změn",
    actionFailed: "⚠️ Nepovedlo se: {0}",
    watchedProducts: "Hlídané produkty ({0})",
    running: "⏳ Probíhá kontrola (od {0})",
    lastRun: "Kontrola {0} · {1} produktů · změn {2}",
    noRunYet: "Zatím neproběhla žádná kontrola",
    nextRun: "⏰ Další kontrola {0}",
    pending: "🌙 Odloženo do konce tichých hodin: {0}",
  },
  sk: {
    title: "Alza Price Insight",
    showProducts: "Zobraziť produkty",
    noProducts: "Žiadne produkty",
    cleanupText: "🧹 {0} produktov už viac ako 3 mesiace nesledujete ani neotvárate – navrhujeme ich zmazať.",
    cleanupHint: "Produkty, ktoré nie sú v žiadnom sledovanom zozname, nesledujete z detailu, nemajú cieľovú cenu a viac ako 3 mesiace sa nekontrolovali ani neotvorili (uložené pri prehliadaní viac ako rok). Zmaže sa ich história cien a uložené ceny – v nastaveniach si ich najprv pozriete a zmazanie potvrdíte.",
    cleanupReview: "🧹 Pozrieť a zmazať",
    cleanupSnooze: "Pripomenúť o mesiac",
    openOptionsTitle: "Nastavenia, sledované produkty, cieľové ceny, záloha",
    changes: "Zmeny cien",
    changesNew: "Nové zmeny cien ({0})",
    changesRecent: "Posledné zmeny cien",
    watchList: "🔔 Sledovať zoznam",
    unwatchList: "🔕 Nesledovať zoznam ({0})",
    openListHint: "Otvorte nákupný zoznam na Alze",
    runNow: "▶️ Skontrolovať",
    runNowTitle: "Skontrolovať sledované produkty teraz",
    listSynced: "Synchronizované {0}",
    openAlzaTitle: "Otvoriť {0}",
    listSummary: "Za posledných 7 dní: zlacnelo {0}, zdraželo {1} (najnižšia cena)",
    listNoChanges: "bez zmien",
    actionFailed: "⚠️ Nepodarilo sa: {0}",
    watchedProducts: "Sledované produkty ({0})",
    running: "⏳ Prebieha kontrola (od {0})",
    lastRun: "Kontrola {0} · {1} produktov · zmien {2}",
    noRunYet: "Zatiaľ neprebehla žiadna kontrola",
    nextRun: "⏰ Ďalšia kontrola {0}",
    pending: "🌙 Odložené do konca tichých hodín: {0}",
  },
  hu: {
    title: "Alza Price Insight",
    showProducts: "Termékek megjelenítése",
    noProducts: "Nincsenek termékek",
    cleanupText: "🧹 {0} terméket több mint 3 hónapja nem figyel és nem nyitott meg – javasoljuk a törlésüket.",
    cleanupHint: "Olyan termékek, amelyek nincsenek figyelt listán, nem figyeli őket a termékoldalról, nincs célár, és több mint 3 hónapja nem ellenőrizték vagy nyitották meg őket (a böngészés közben mentetteket több mint egy éve). Az árelőzményeik és mentett áraik törlődnek – a beállításokban előbb megtekinti, majd megerősíti a törlést.",
    cleanupReview: "🧹 Megtekintés és törlés",
    cleanupSnooze: "Emlékeztessen egy hónap múlva",
    openOptionsTitle: "Beállítások, figyelt termékek, célárak, biztonsági mentés",
    changes: "Árváltozások",
    changesNew: "Új árváltozások ({0})",
    changesRecent: "Legutóbbi árváltozások",
    watchList: "🔔 Lista figyelése",
    unwatchList: "🔕 Figyelés leállítása ({0})",
    openListHint: "Nyisson meg egy bevásárlólistát az Alzán",
    runNow: "▶️ Ellenőrzés",
    runNowTitle: "Figyelt termékek ellenőrzése most",
    listSynced: "Szinkronizálva: {0}",
    openAlzaTitle: "{0} megnyitása",
    listSummary: "Az elmúlt 7 napban: {0} olcsóbb lett, {1} drágább (legalacsonyabb ár)",
    listNoChanges: "nincs változás",
    actionFailed: "⚠️ Nem sikerült: {0}",
    watchedProducts: "Figyelt termékek ({0})",
    running: "⏳ Ellenőrzés folyamatban ({0} óta)",
    lastRun: "Ellenőrzés {0} · {1} termék · {2} változás",
    noRunYet: "Még nem volt ellenőrzés",
    nextRun: "⏰ Következő ellenőrzés: {0}",
    pending: "🌙 A csendes órák végéig elhalasztva: {0}",
  },
  en: {
    title: "Alza Price Insight",
    showProducts: "Show products",
    noProducts: "No products",
    cleanupText: "🧹 {0} products haven't been watched or opened for over 3 months – we suggest deleting them.",
    cleanupHint: "Products that aren't in any watched list, aren't watched from the product page, have no target price and haven't been checked or opened for over 3 months (products saved while browsing: over a year). Their price history and stored prices will be deleted – you review them in settings first and confirm the deletion.",
    cleanupReview: "🧹 Review and delete",
    cleanupSnooze: "Remind me in a month",
    openOptionsTitle: "Settings, watched products, target prices, backup",
    changes: "Price changes",
    changesNew: "New price changes ({0})",
    changesRecent: "Recent price changes",
    watchList: "🔔 Watch list",
    unwatchList: "🔕 Stop watching list ({0})",
    openListHint: "Open a shopping list on Alza",
    runNow: "▶️ Check now",
    runNowTitle: "Check watched products now",
    listSynced: "Synced {0}",
    openAlzaTitle: "Open {0}",
    listSummary: "Last 7 days: {0} cheaper, {1} more expensive (lowest price)",
    listNoChanges: "no changes",
    actionFailed: "⚠️ Failed: {0}",
    watchedProducts: "Watched products ({0})",
    running: "⏳ Check in progress (since {0})",
    lastRun: "Checked {0} · {1} products · {2} changes",
    noRunYet: "No check has run yet",
    nextRun: "⏰ Next check {0}",
    pending: "🌙 Postponed until quiet hours end: {0}",
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

function applyStaticTexts() {
  document.documentElement.lang = ui.locale.split("-")[0];
  document.querySelectorAll("[data-i18n]").forEach((element) => (element.textContent = t(element.dataset.i18n)));
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
  status.textContent = t("actionFailed", error?.message || error);
  status.classList.add("error");
}

function renderToggle() {
  toggleWatchButton.disabled = !watchState?.listId;
  toggleWatchButton.title = "";
  if (!watchState?.listId) {
    toggleWatchButton.textContent = t("watchList");
    toggleWatchButton.title = t("openListHint");
  } else if (watchState.watched) {
    toggleWatchButton.textContent = t("unwatchList", watchState.count);
  } else {
    toggleWatchButton.textContent = t("watchList");
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
  const addLine = (text, className) => {
    const line = document.createElement("div");
    line.textContent = text;
    if (className) line.className = className;
    status.appendChild(line);
  };

  if (state.running) {
    addLine(t("running", formatTime(state.lastRunStart)));
  } else if (state.lastRunEnd) {
    addLine(t("lastRun", formatTime(state.lastRunEnd), state.checked || 0, state.changes?.length || 0) + (targetCount ? ` · 🎯 ${targetCount}` : ""));
  } else {
    addLine(t("noRunYet"));
  }
  // Kdy proběhne další kontrola na pozadí (frekvence podle nastavení) – jen když je co hlídat
  const watching = Object.keys(lists).length > 0 || targetCount > 0 || productCount > 0;
  if (!state.running && watching && nextAlarm?.scheduledTime) addLine(t("nextRun", formatTime(nextAlarm.scheduledTime)));
  if (state.pendingNotifications?.length) addLine(t("pending", state.pendingNotifications.length));
  (state.problems || []).forEach((problem) => addLine(`⚠️ ${problem.name}: ${problem.message}`, "watch-problem"));
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
  document.getElementById("cleanupText").textContent = t("cleanupText", cleanup.count);
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
        line.textContent = text;
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
})().catch(showError);
