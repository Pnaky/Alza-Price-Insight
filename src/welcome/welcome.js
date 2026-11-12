// Průvodce nastavením – otevře se po instalaci (background.js), znovu z nastavení. Úvod (od kdy se ceny ukládají a za
// jakých podmínek), krok 1 ověří na pozadí přihlášení, ceny s DPH, notifikace a ikonu na liště (checklist s nápovědou),
// kroky 2–4 nastaví hlídání (i po nákupu a Moje nákupy – čtení objednávek z Alzy), výpisy kategorií a notifikace
// (stejné volby jako v nastavení), na konci odkaz na Alzu a stav hlídání.
// #news = novinky po aktualizaci (background.js, popup, nastavení): odrážky vydání (RELEASE_NEWS) a nové volby
// (AlzaCore.releases) – kopie voleb z kroků, zvýrazněné zeleně i v krocích, dokud je uživatel neviděl.
const { settings: SETTINGS_KEY, watchLists: WATCH_LISTS_KEY, watchProducts: WATCH_PRODUCTS_KEY, targets: TARGETS_KEY } = AlzaCore.storageKeys;
const SCREENS = ["intro", "check", "watch", "categories", "notify", "done", "news"];
const STEP_SCREENS = ["check", "watch", "categories", "notify"];
const NEWS_KEY = AlzaCore.storageKeys.news;
const DICTIONARY_LANG = { cs: "cz", sk: "sk", hu: "hu", en: "en" };
const PAGE_TIMEOUT_MS = 20000;

const form = document.querySelector("main");
let uiLanguage = AlzaCore.getUiLanguage();
let primaryDomain = AlzaCore.getPrimaryDomain(); // Hlavní Alza – na ní se ověřuje a vedou na ni odkazy
let lastCheck = null; // Výsledek posledního ověření – při návratu do záložky (přihlášení na Alze) se ověří znovu
let checking = false;
let recheck = false; // Během ověřování se změnila hlavní Alza – po doběhnutí ověřit znovu
let savedTimeoutId = null;
let currentScreen = "intro"; // Zobrazená obrazovka (show) – podle ní titulek záložky a podtitul
let newsReleases = []; // Vydání na stránce novinek: neviděná, jinak nejnovější
let newSettings = new Set(); // Nové volby zvýrazněné zeleně (štítek Nové)

// === Texty ===
// data-w = text průvodce (WELCOME_TEXTS), data-o = text ze stránky nastavení (OPTIONS_TEXTS – popisky a nápovědy voleb)

const pick = (dictionary, key) => dictionary[DICTIONARY_LANG[uiLanguage]]?.[key] ?? dictionary.cz[key] ?? key;
const t = (key, ...params) => AlzaCore.fillTemplate(pick(WELCOME_TEXTS, key), params);
const o = (key) => pick(OPTIONS_TEXTS, key);

// Ikony před texty (src/shared/icons.js) – emoji v textech nejsou, ikonu přidá podle klíče textu (data-w i data-o)
const WELCOME_ICONS = {
  factHistoryTitle: "event",
  factAccountTitle: "key",
  factPrivacyTitle: "lock",
  checkButton: "search",
  checkAgain: "refresh",
  watchHowList: "list",
  watchHowProduct: "bag",
  watchHowTarget: "target",
  openHelp: "help",
  openSettings: "settings",
  newsAll: "settings",
  testNotifications: "bell",
};

function setText(element, key, text) {
  element.textContent = text;
  if (WELCOME_ICONS[key]) AlzaIcons.prepend(element, WELCOME_ICONS[key]);
}

function applyTexts() {
  document.documentElement.lang = uiLanguage;
  document.querySelectorAll("[data-w]").forEach((element) => setText(element, element.dataset.w, t(element.dataset.w)));
  document.querySelectorAll("[data-o]").forEach((element) => setText(element, element.dataset.o, o(element.dataset.o)));
  AlzaIcons.decorate(document.querySelector(".app-header"));
  document.querySelectorAll("[data-step-of]").forEach((element) => (element.textContent = t("stepOf", element.dataset.stepOf)));
  renderHeader();
  // „Jazyk rozšíření“ jako v nastavení – bublina u ikony glóbu a název výběru pro čtečky
  document.getElementById("languageLabel").title = o("uiLanguage");
  document.getElementById("language").setAttribute("aria-label", o("uiLanguage"));
  document.getElementById("openHelp").href = AlzaCore.getHelpUrl(uiLanguage);
  if (lastCheck) renderChecks(lastCheck);
  else resetChecks();
  renderDomainPick();
  renderOpenAlza();
  renderNewsTexts();
  markNew();
  renderWatching().catch(logError);
}

const logError = (error) => console.error("Průvodce nastavením:", error);

// === Obrazovky ===

// Titulek záložky a podtitul v záhlaví podle obrazovky – novinky po aktualizaci nejsou „Vítejte“ ani průvodce
function renderHeader() {
  const news = currentScreen === "news";
  document.title = t(news ? "newsPageTitle" : "pageTitle");
  document.querySelector(".app-header .app-sub").textContent = t(news ? "newsSubtitle" : "subtitle");
}

function show(screen) {
  if (!SCREENS.includes(screen)) screen = "intro";
  currentScreen = screen;
  renderHeader();
  document.querySelectorAll("[data-screen]").forEach((section) => (section.hidden = section.dataset.screen !== screen));
  const index = STEP_SCREENS.indexOf(screen);
  document.querySelectorAll(`[data-screen="${screen}"] .steps span`).forEach((span, i) => {
    span.classList.toggle("active", i === index);
    span.classList.toggle("done", i < index);
  });
  history.replaceState(null, "", `#${screen}`);
  window.scrollTo(0, 0);
  // Fokus na nadpis – tlačítko, které obrazovku přeplo, je teď skryté (klávesnice a čtečky by spadly na začátek)
  document.querySelector(`[data-screen="${screen}"] :is(h1, h2)`)?.focus({ preventScroll: true });
  if (screen === "done") renderWatching().catch(logError);
  if (screen === "news") markNewsSeen();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-go]");
  if (target) show(target.dataset.go);
});

// === Ověření (krok 1) ===

const hostName = (domainKey) => new URL(AlzaCore.domains[domainKey].origin).hostname.replace(/^www\./, "");

async function fetchText(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: "include", signal: controller.signal });
    return response.ok && AlzaCore.isAlzaUrl(response.url) ? await response.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Ceny s DPH se poznají jen na detailu produktu: vyhledávání vrátí výpis s odkazy na produkty, první se rozebere
// stejně jako při ukládání cen (fetchProductPage → getSaveProblem). true = s DPH, false = bez DPH, null = nevím
async function checkVat(origin) {
  const html = await fetchText(`${origin}/search.htm?exps=usb`);
  const href = html?.match(/href="((?:https:\/\/www\.alza\.(?:cz|sk|hu))?\/[^"?#\s]+-d\d+\.htm)"/)?.[1];
  if (!href) return null;
  const url = new URL(href, origin).href;
  if (!AlzaCore.isAlzaUrl(url)) return null;
  const page = await fetchProductPage(url);
  if (!page.ok || !page.isProduct) return null;
  // Bez cen getSaveProblem DPH neposuzuje (saveProblem null) – to není „s DPH“, ale „nevím“
  if (AlzaCore.getPriceEntries(page.prices || {}).length === 0) return null;
  if (page.saveProblem === null) return true;
  return page.saveProblem === "notifyProblemWithoutVat" ? false : null;
}

// Přihlášení podle úvodní stránky Alzy (stejné znaky jako při ukládání), u přihlášeného i ceny s DPH
async function checkDomain(domainKey) {
  const { origin } = AlzaCore.domains[domainKey];
  const home = await fetchProductPage(`${origin}/`);
  if (!home.ok) return { domainKey, login: null, vat: null };
  const login = home.saveProblem === "notifyProblemNotLogged" ? false : home.saveProblem === "notifyProblemLoginUnknown" ? null : true;
  return { domainKey, login, vat: login ? await checkVat(origin) : null };
}

async function getNotificationPermission() {
  try {
    return (await chrome.notifications.getPermissionLevel?.()) ?? null; // Firefox ji nemá
  } catch {
    return null;
  }
}

async function getPinned() {
  try {
    return (await chrome.action.getUserSettings?.())?.isOnToolbar ?? null;
  } catch {
    return null;
  }
}

async function runCheck() {
  if (checking) {
    recheck = true;
    return;
  }
  checking = true;
  const button = document.getElementById("runCheck");
  button.disabled = true;
  button.textContent = t("checking");
  document.querySelectorAll("#checks li").forEach((item) => setCheck(item.dataset.check, "busy", t("checking")));
  document.getElementById("checkSummary").textContent = "";
  try {
    // Jen hlavní Alza – rychlejší a bez matoucích „nepřihlášen“ u Alz, kde nenakupujete
    const [domain, notifications, pinned] = await Promise.all([
      checkDomain(primaryDomain),
      getNotificationPermission(),
      getPinned(),
    ]);
    lastCheck = { domain, notifications, pinned };
    renderChecks(lastCheck);
  } catch (error) {
    logError(error);
    resetChecks();
  } finally {
    checking = false;
    button.disabled = false;
    const key = lastCheck ? "checkAgain" : "checkButton";
    setText(button, key, t(key));
  }
  if (recheck || (lastCheck && lastCheck.domain.domainKey !== primaryDomain)) {
    recheck = false;
    runCheck();
  }
}

document.getElementById("runCheck").addEventListener("click", runCheck);

// Návrat do záložky (třeba po přihlášení na Alze) = ověřit znovu, ať se položky odškrtnou samy
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && lastCheck && !document.querySelector('[data-screen="check"]').hidden) runCheck();
});

// Stav položky: ok ✓, todo ✗ (musíte něco udělat), info i (nevím / tip), busy (ověřuje se), prázdný = neověřeno
function setCheck(name, state, status, help = "", actions = []) {
  const item = document.querySelector(`[data-check="${name}"]`);
  item.dataset.state = state;
  item.querySelector(".mark").textContent = { ok: "✓", todo: "✗", info: "i" }[state] || "";
  item.querySelector(".check-status").textContent = status;
  item.querySelector(".check-help").textContent = help;
  const box = item.querySelector(".check-actions");
  if (box) box.replaceChildren(...actions);
}

function resetChecks() {
  document.querySelectorAll("#checks li").forEach((item) => setCheck(item.dataset.check, "", ""));
  document.getElementById("checkSummary").textContent = "";
}

function alzaLink(domainKey) {
  const link = document.createElement("a");
  link.className = "button";
  link.href = `${AlzaCore.domains[domainKey].origin}/`;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = t("openAlza", hostName(domainKey));
  return link;
}

function renderChecks({ domain, notifications, pinned }) {
  const name = hostName(domain.domainKey);
  const todo = [];

  // Přihlášení na hlavní Alze
  if (domain.login === true) setCheck("login", "ok", t("checkLoginOk", name));
  else if (domain.login === false) {
    setCheck("login", "todo", t("checkLoginNo", name), t("checkLoginNoHelp"), [alzaLink(domain.domainKey)]);
    todo.push("login");
  } else setCheck("login", "info", t("checkLoginUnknown"), t("checkLoginUnknownHelp"), [alzaLink(domain.domainKey)]);

  // Ceny s DPH – jen přihlášenému (nepřihlášený vidí jiné ceny)
  if (domain.login !== true) setCheck("vat", "info", t("checkVatWaiting"));
  else if (domain.vat === false) {
    setCheck("vat", "todo", t("checkVatNo", name), t("checkVatNoHelp"));
    todo.push("vat");
  } else if (domain.vat === true) setCheck("vat", "ok", t("checkVatOk"));
  else setCheck("vat", "info", t("checkVatUnknown"), t("checkVatUnknownHelp"));

  // Notifikace: prohlížeč je povoluje? (zákaz v systému rozšíření nepozná – proto nápověda i u ✓)
  if (notifications === "denied") {
    setCheck("notifications", "todo", t("checkNotificationsNo"), t("checkNotificationsHelp"));
    todo.push("notifications");
  } else if (notifications === "granted") setCheck("notifications", "ok", t("checkNotificationsOk"), t("checkNotificationsHelp"));
  else setCheck("notifications", "info", t("checkNotificationsTry"), t("checkNotificationsHelp"));

  // Ikona na liště – jen doporučení (Firefox stav nemusí prozradit)
  if (pinned === true) setCheck("pin", "ok", t("checkPinOk"));
  else setCheck("pin", "info", pinned === false ? t("checkPinNo") : t("checkPinTip"), t("checkPinHelp"));

  // Zeleně jen když jsou přihlášení i DPH opravdu ověřené; co nejde ověřit, se pozná až při načtení seznamu
  const verified = domain.login === true && domain.vat === true;
  const summary = document.getElementById("checkSummary");
  summary.className = `summary ${todo.length || !verified ? "todo" : "ok"}`;
  summary.textContent = t(todo.length ? "checkSummaryTodo" : verified ? "checkSummaryOk" : "checkSummaryUnknown");
  renderOpenAlza();
}

// === Volby (kroky 2–4 a novinky) – každá změna se hned uloží ===

// Ovládání, které potřebuje jinou volbu (data-needs = její název): připomínka cashbacku objednávky, připomínka záruky
// Moje nákupy, cena elektřiny cenu provozu… Volba může být na stránce dvakrát (kopie v novinkách) – stačí první
function updateDependentRows() {
  form.querySelectorAll("[data-needs]").forEach((row) => {
    const enabled = Boolean(form.querySelector(`[name="${row.dataset.needs}"]`)?.checked);
    row.classList.toggle("disabled", !enabled);
    row.querySelectorAll("input").forEach((input) => (input.disabled = !enabled));
  });
  const daily = form.querySelector('[name="checkSchedule"]').value === "daily";
  form.querySelectorAll('[name="checkTime"]').forEach((input) => (input.hidden = !daily));
}

// Cena elektřiny se zadává v měně hlavní Alzy – políčko dostane název nastavení pro tuto měnu (energyPriceCZK…),
// ostatní měny si nechají svou hodnotu (stejně jako v nastavení)
function updateEnergyFields(settings) {
  const { currency } = AlzaCore.domains[primaryDomain];
  form.querySelectorAll("[data-energy-price]").forEach((input) => {
    input.name = AlzaCore.energyPriceKeys[currency];
    input.value = AlzaCore.getEnergyPrice(settings, primaryDomain);
  });
  form.querySelectorAll("[data-energy-unit]").forEach((unit) => (unit.textContent = `${currency}/kWh`));
}

async function loadSettings() {
  const settings = await AlzaCore.getSettings();
  uiLanguage = AlzaCore.getUiLanguage(settings);
  primaryDomain = AlzaCore.getPrimaryDomain(settings);
  document.getElementById("language").value = settings.uiLanguage;
  form.querySelectorAll("[name]").forEach((input) => {
    let value = settings[input.name];
    if (input.name === "checkSchedule" && !Object.hasOwn(AlzaCore.checkSchedules, value)) value = AlzaCore.defaultSettings.checkSchedule;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value ?? "";
  });
  updateEnergyFields(settings);
  updateDependentRows();
  applyTexts();
}

// Hodnota políčka k uložení; null = neplatná (uložená zůstane)
function readValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.name === "minDropPercent") {
    const percent = Math.round(Number(input.value));
    return Number.isFinite(percent) ? Math.min(99, Math.max(0, percent)) : 0;
  }
  // Cena elektřiny: stejný rozsah jako v nastavení a u importu zálohy (OptionsData.SETTING_RANGES)
  if (input.hasAttribute("data-energy-price")) {
    const price = Number(input.value);
    return input.value !== "" && price >= 0.01 && price <= 99999 ? price : null;
  }
  return input.value || AlzaCore.defaultSettings[input.name];
}

function showSaved(source, text, error = false) {
  const info = source.closest("section")?.querySelector("[data-saved]");
  if (!info) return;
  info.textContent = text;
  info.classList.toggle("error", error);
  clearTimeout(savedTimeoutId);
  savedTimeoutId = setTimeout(() => (info.textContent = ""), 2000);
}

// true = uloženo
async function saveSetting(input) {
  const value = readValue(input);
  if (value === null) {
    updateEnergyFields(await AlzaCore.getSettings()); // Neplatná cena elektřiny – vrátit uloženou
    return false;
  }
  if (input.name === "minDropPercent") form.querySelectorAll('[name="minDropPercent"]').forEach((other) => (other.value = value));
  try {
    await AlzaStore.run({ type: "assign", key: SETTINGS_KEY, values: { [input.name]: value } });
    showSaved(input, t("saved"));
    return true;
  } catch (error) {
    logError(error);
    showSaved(input, t("saveFailed"), true);
    return false;
  }
}

form.addEventListener("change", (event) => {
  const input = event.target.closest("[name]");
  if (!input) return;
  // Stejná volba v kroku i v novinkách – obě kopie ukazují totéž
  form.querySelectorAll(`[name="${input.name}"]`).forEach((other) => {
    if (other === input) return;
    if (other.type === "checkbox") other.checked = input.checked;
    else other.value = input.value;
  });
  updateDependentRows();
  const turnedOnOwned = input.name === "ownedItems" && input.checked;
  saveSetting(input).then((saved) => {
    // Zapnuté Moje nákupy načíst hned (jako v nastavení), ne až po příští kontrole na pozadí – až po uložení volby,
    // jinak by služba na pozadí viděla „vypnuto“. Odpověď (výsledek načítání) nečekáme
    if (saved && turnedOnOwned) chrome.runtime.sendMessage({ action: "ownedSync" }).catch(() => {});
  });
});

document.getElementById("language").addEventListener("change", async (event) => {
  const value = event.target.value;
  let settings = AlzaCore.defaultSettings;
  try {
    await AlzaStore.run({ type: "assign", key: SETTINGS_KEY, values: { uiLanguage: value } });
    settings = await AlzaCore.getSettings();
  } catch (error) {
    logError(error);
  }
  uiLanguage = AlzaCore.getUiLanguage({ ...settings, uiLanguage: value });
  primaryDomain = AlzaCore.getPrimaryDomain({ ...settings, uiLanguage: value }); // „automaticky“ jde za jazykem
  updateEnergyFields(settings); // Hlavní Alza „automaticky“ mohla změnit měnu ceny elektřiny
  applyTexts();
});

// === Hlavní Alza (krok 1) ===

function renderDomainPick() {
  document.querySelectorAll(".domain").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.domain === primaryDomain)));
}

// Logo z CDN Alzy – bez připojení zůstane jen název
document.querySelectorAll(".domain img").forEach((image) => image.addEventListener("error", () => image.classList.add("broken")));

document.querySelectorAll(".domain").forEach((button) =>
  button.addEventListener("click", async () => {
    if (button.dataset.domain === primaryDomain) return;
    primaryDomain = button.dataset.domain;
    renderDomainPick();
    renderOpenAlza();
    try {
      await AlzaStore.run({ type: "assign", key: SETTINGS_KEY, values: { primaryDomain } });
      updateEnergyFields(await AlzaCore.getSettings()); // Cena elektřiny v měně nové hlavní Alzy
    } catch (error) {
      logError(error);
      showSaved(button, t("saveFailed"), true);
    }
    // Výsledek patřil jiné Alze – ověřit znovu tu vybranou
    if (lastCheck) runCheck();
  })
);

// Služba na pozadí pošle ukázkové notifikace (na zprávu neodpovídá – zavřený port není chyba)
document.getElementById("testNotifications").addEventListener("click", () =>
  chrome.runtime.sendMessage({ action: "watchTestNotifications" }).catch(() => {})
);

// === Hotovo ===

// Odkaz na hlavní Alzu
function renderOpenAlza() {
  const link = document.getElementById("openAlza");
  link.href = `${AlzaCore.domains[primaryDomain].origin}/`;
  link.textContent = t("openAlza", hostName(primaryDomain));
}

const countOf = (value) => (Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0);

async function renderWatching() {
  const stored = await chrome.storage.local.get([WATCH_LISTS_KEY, WATCH_PRODUCTS_KEY, TARGETS_KEY]);
  const lists = countOf(stored[WATCH_LISTS_KEY]);
  // Hlídané produkty i cílové ceny (kontrola na pozadí hlídá obojí) – produkt s oběma jen jednou
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const products = new Set(
    [stored[WATCH_PRODUCTS_KEY], stored[TARGETS_KEY]].flatMap((map) => (isObject(map) ? Object.keys(map) : []))
  ).size;
  if (lists + products > 0) setCheck("watching", "ok", t("doneWatchOk", lists, products));
  else setCheck("watching", "todo", t("doneWatchNo"), t("doneWatchHelp"));
}

// Hlídání zapnuté na Alze se odškrtne samo
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[WATCH_LISTS_KEY] || changes[WATCH_PRODUCTS_KEY] || changes[TARGETS_KEY])) renderWatching().catch(logError);
});

// === Novinky (#news) ===

// Které novinky ukázat: neviděná vydání (od alzaNews.seen po nainstalovanou verzi), jinak nejnovější (otevřeno ručně
// z popupu nebo nastavení). Zeleně se zvýrazní nové volby neviděných vydání – i v krocích průvodce – a na stránce
// novinek vždy. Volby v novinkách jsou kopie voleb z kroků (stejné názvy, change je drží v souladu)
async function prepareNews() {
  const { [NEWS_KEY]: news } = await chrome.storage.local.get(NEWS_KEY);
  const current = chrome.runtime.getManifest().version;
  const fresh = AlzaCore.getReleaseNews(news?.seen, current);
  const released = AlzaCore.releases.filter(({ version }) => AlzaCore.compareVersions(version, current) <= 0);
  newsReleases = fresh.length ? fresh : released.slice(0, 3);
  newSettings = new Set(fresh.flatMap((release) => release.settings));

  const keys = [...new Set(newsReleases.flatMap((release) => release.settings))];
  const options = keys
    .map((key) => form.querySelector(`[data-screen]:not([data-screen="news"]) [data-setting="${key}"]`))
    .filter(Boolean)
    .map((option) => option.cloneNode(true));
  document.getElementById("newsOptions").replaceChildren(...options);
  document.getElementById("newsSettings").hidden = options.length === 0;
}

function renderNewsTexts() {
  document.getElementById("newsLead").textContent = t("newsLead", chrome.runtime.getManifest().version);
  const lang = DICTIONARY_LANG[uiLanguage];
  const blocks = newsReleases.map(({ version }) => {
    const block = document.createElement("div");
    block.className = "release";
    const heading = document.createElement("h3");
    heading.textContent = t("newsRelease", version);
    const list = document.createElement("ul");
    const items = RELEASE_NEWS[version]?.[lang] || RELEASE_NEWS[version]?.cz || [];
    list.append(...items.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
    block.append(heading, list);
    return block;
  });
  document.getElementById("newsReleases").replaceChildren(...blocks);
}

// Zelené zvýraznění a štítek Nové – po každém přepsání textů (popisek volby se přepisuje celý)
function markNew() {
  document.querySelectorAll(".new-badge").forEach((badge) => badge.remove());
  form.querySelectorAll("[data-setting]").forEach((option) => {
    const isNew = newSettings.has(option.dataset.setting) || Boolean(option.closest("#newsOptions"));
    option.classList.toggle("is-new", isNew);
    if (!isNew) return;
    const badge = document.createElement("span");
    badge.className = "new-badge";
    badge.textContent = t("newBadge");
    option.querySelector(".option-label")?.append(badge);
  });
}

// Novinky jsou viděné, jakmile se stránka novinek ukáže – popup přestane ukazovat značku Novinky
function markNewsSeen() {
  const seen = newsReleases[0]?.version;
  if (seen) AlzaStore.run({ type: "assign", key: NEWS_KEY, values: { seen } }).catch(logError);
}

// Hotovo = zavřít záložku (otevřelo ji rozšíření); kdyby to nešlo, aspoň okno
document.getElementById("newsClose").addEventListener("click", async () => {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) {
      await chrome.tabs.remove(tab.id);
      return;
    }
  } catch (error) {
    logError(error);
  }
  window.close();
});

async function start() {
  try {
    await prepareNews();
  } catch (error) {
    logError(error);
  }
  if (!document.querySelector('[data-screen="news"]').hidden) markNewsSeen();
  await loadSettings(); // Nastaví i kopie voleb v novinkách a znovu texty (applyTexts → novinky, štítky Nové)
}

applyTexts();
show(location.hash.slice(1));
start().catch(logError);
