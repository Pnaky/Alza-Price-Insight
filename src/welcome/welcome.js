// Průvodce nastavením – otevře se po instalaci (background.js), znovu z nastavení. Úvod (od kdy se ceny ukládají a za
// jakých podmínek), krok 1 ověří na pozadí přihlášení, ceny s DPH, notifikace a ikonu na liště (checklist s nápovědou),
// kroky 2 a 3 nastaví hlídání a notifikace (stejné volby jako v nastavení), na konci odkaz na Alzu a stav hlídání.
const { settings: SETTINGS_KEY, watchLists: WATCH_LISTS_KEY, watchProducts: WATCH_PRODUCTS_KEY, targets: TARGETS_KEY } = AlzaCore.storageKeys;
const SCREENS = ["intro", "check", "watch", "notify", "done"];
const STEP_SCREENS = ["check", "watch", "notify"];
const DICTIONARY_LANG = { cs: "cz", sk: "sk", hu: "hu", en: "en" };
const PAGE_TIMEOUT_MS = 20000;

const form = document.querySelector("main");
let uiLanguage = AlzaCore.getUiLanguage();
let primaryDomain = AlzaCore.getPrimaryDomain(); // Hlavní Alza – na ní se ověřuje a vedou na ni odkazy
let lastCheck = null; // Výsledek posledního ověření – při návratu do záložky (přihlášení na Alze) se ověří znovu
let checking = false;
let recheck = false; // Během ověřování se změnila hlavní Alza – po doběhnutí ověřit znovu
let savedTimeoutId = null;

// === Texty ===
// data-w = text průvodce (WELCOME_TEXTS), data-o = text ze stránky nastavení (OPTIONS_TEXTS – popisky a nápovědy voleb)

const pick = (dictionary, key) => dictionary[DICTIONARY_LANG[uiLanguage]]?.[key] ?? dictionary.cz[key] ?? key;
const t = (key, ...params) => AlzaCore.fillTemplate(pick(WELCOME_TEXTS, key), params);
const o = (key) => pick(OPTIONS_TEXTS, key);

function applyTexts() {
  document.documentElement.lang = uiLanguage;
  document.querySelectorAll("[data-w]").forEach((element) => (element.textContent = t(element.dataset.w)));
  document.querySelectorAll("[data-o]").forEach((element) => (element.textContent = o(element.dataset.o)));
  document.querySelectorAll("[data-step-of]").forEach((element) => (element.textContent = t("stepOf", element.dataset.stepOf)));
  document.title = t("pageTitle");
  // „Jazyk rozšíření“ jako v nastavení – bublina u 🌐 a název výběru pro čtečky
  document.getElementById("languageLabel").title = o("uiLanguage");
  document.getElementById("language").setAttribute("aria-label", o("uiLanguage"));
  document.getElementById("openHelp").href = AlzaCore.getHelpUrl(uiLanguage);
  if (lastCheck) renderChecks(lastCheck);
  else resetChecks();
  renderDomainPick();
  renderOpenAlza();
  renderWatching().catch(logError);
}

const logError = (error) => console.error("Průvodce nastavením:", error);

// === Obrazovky ===

function show(screen) {
  if (!SCREENS.includes(screen)) screen = "intro";
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
    button.textContent = t(lastCheck ? "checkAgain" : "checkButton");
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

// === Volby (kroky 2 a 3) – každá změna se hned uloží ===

function updateDependentRows() {
  const toggle = (rowId, enabled) => {
    const row = document.getElementById(rowId);
    row.classList.toggle("disabled", !enabled);
    row.querySelectorAll("input").forEach((input) => (input.disabled = !enabled));
  };
  toggle("dropRow", form.querySelector('[name="notifyDrops"]').checked);
  toggle("quietRow", form.querySelector('[name="quietHours"]').checked);
  form.querySelector('[name="checkTime"]').hidden = form.querySelector('[name="checkSchedule"]').value !== "daily";
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
  updateDependentRows();
  applyTexts();
}

function readValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.name === "minDropPercent") {
    const percent = Math.round(Number(input.value));
    return Number.isFinite(percent) ? Math.min(99, Math.max(0, percent)) : 0;
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

async function saveSetting(input) {
  const value = readValue(input);
  if (input.name === "minDropPercent") input.value = value;
  try {
    await AlzaStore.run({ type: "assign", key: SETTINGS_KEY, values: { [input.name]: value } });
    showSaved(input, t("saved"));
  } catch (error) {
    logError(error);
    showSaved(input, t("saveFailed"), true);
  }
}

form.addEventListener("change", (event) => {
  const input = event.target.closest("[name]");
  if (!input) return;
  updateDependentRows();
  saveSetting(input);
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

applyTexts();
show(location.hash.slice(1));
loadSettings().catch(logError);
