// Stránka nastavení: notifikace hlídání na pozadí, hlídané produkty a přehled cílových cen
const { settings: SETTINGS_KEY, targets: TARGETS_KEY, watchProducts: WATCH_PRODUCTS_KEY } = AlzaCore.storageKeys;

const form = document.getElementById("settings");
let savedTimeoutId = null;

// === Překlady ===
// Jazyk stránky jako u popupu: volba z nastavení (uiLanguage), jinak jazyk prohlížeče; jiné jazyky → angličtina.
// Slovník OPTIONS_TEXTS je v options-texts.js. Do načtení nastavení (asynchronní) platí jazyk prohlížeče
const UI_LANGUAGES = {
  cs: { lang: "cz", locale: "cs-CZ" },
  sk: { lang: "sk", locale: "sk-SK" },
  hu: { lang: "hu", locale: "hu-HU" },
  en: { lang: "en", locale: "en-GB" },
};
let ui = UI_LANGUAGES[AlzaCore.getUiLanguage()];

function t(key, ...params) {
  return AlzaCore.fillTemplate(OPTIONS_TEXTS[ui.lang][key] ?? OPTIONS_TEXTS.cz[key] ?? key, params);
}

const formatDate = (ts) => new Date(ts).toLocaleDateString(ui.locale);

// data-i18n = text, data-i18n-title = title, data-i18n-tip = bublina „?“ (data-tip) i aria-label,
// data-i18n-placeholder = placeholder, data-i18n-label = aria-label (název řady záložek)
// Ikony před texty (src/shared/icons.js) – emoji v textech nejsou, ikonu přidá setText podle klíče textu;
// tone = ikona v barvě textu (výstrahy a mazání)
const OPTIONS_ICONS = {
  helpLink: "help",
  welcomeLink: "explore",
  newsLink: "news",
  tracking: "chart",
  notifications: "bell",
  testNotifications: "bell",
  categories: "cart",
  general: "settings",
  language: "language",
  backup: "save",
  exportJson: "download",
  exportCsv: "download",
  importJson: "upload",
  pruneData: "cleaning",
  diagnostics: "build",
  reportBug: "bug",
  exportDiagnostics: "download",
  wipeSummary: { icon: "warning", tone: true },
  wipeButton: { icon: "delete", tone: true },
  wipeButtonConfirm: { icon: "delete", tone: true },
  tabLists: "list",
  tabProducts: "bell",
  tabOwned: "bag",
  tabData: "storage",
  tabLog: "history",
  cleanupBannerStart: "cleaning",
  cleanupDelete: { icon: "delete", tone: true },
  actionFailed: { icon: "warning", tone: true },
  unwatch: "bell-off",
};

function setText(element, key, ...params) {
  element.textContent = t(key, ...params);
  const icon = OPTIONS_ICONS[key];
  if (icon) AlzaIcons.prepend(element, icon.icon || icon, { tone: Boolean(icon.tone) });
  return element;
}

// Text s ikonou do buňky tabulky (důvody sledování, cílová cena, počty v logu běhů)
function iconText(icon, text, tone = false) {
  return AlzaIcons.prepend(Object.assign(document.createElement("span"), { textContent: text }), icon, { tone });
}

function applyStaticTexts() {
  document.documentElement.lang = ui.locale.split("-")[0];
  document.querySelectorAll("[data-i18n]").forEach((element) => setText(element, element.dataset.i18n));
  document.querySelectorAll("[data-i18n-title]").forEach((element) => (element.title = t(element.dataset.i18nTitle)));
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => (element.placeholder = t(element.dataset.i18nPlaceholder)));
  document.querySelectorAll("[data-i18n-label]").forEach((element) => element.setAttribute("aria-label", t(element.dataset.i18nLabel)));
  document.querySelectorAll("[data-i18n-tip]").forEach((element) => {
    const text = t(element.dataset.i18nTip);
    element.dataset.tip = text;
    element.setAttribute("aria-label", text);
  });
}
applyStaticTexts();

// Jazyk z nastavení (načtení stránky, změna výběru, import zálohy). Při změně se přepíšou statické texty
// a překreslí vše, co skládá options.js (tabulky, souhrny, štítky)
function applyLanguage(settings) {
  const next = UI_LANGUAGES[AlzaCore.getUiLanguage(settings)];
  if (next === ui) return;
  ui = next;
  applyStaticTexts();
  renderVersion();
  updateWipeButton();
  const logError = (error) => console.error(error);
  renderProducts().catch(logError);
  renderLists().catch(logError);
  renderLog().catch(logError);
  renderErrorSummary().catch(logError);
  refreshStoredProducts().catch(logError);
  if (typeof renderOwned === "function") renderOwned().catch(logError); // options-owned.js se načítá až za tímto souborem
}

function renderVersion() {
  document.getElementById("version").textContent = t("version", chrome.runtime.getManifest().version);
}

// === Notifikace ===

function updateDependentRows() {
  const toggle = (rowId, enabled) => {
    const row = document.getElementById(rowId);
    row.classList.toggle("disabled", !enabled);
    row.querySelectorAll("input").forEach((input) => (input.disabled = !enabled));
  };
  toggle("dropRow", form.notifyDrops.checked);
  toggle("quietRow", form.quietHours.checked);
  toggle("cashbackRow", form.watchPurchases.checked); // Připomínka cashbacku potřebuje objednávky
  toggle("warrantyRow", form.ownedItems.checked); // Připomínka konce záruky potřebuje Moje nákupy
  toggle("energyRow", form.energyCost.checked);
  toggle("energyUsageRow", form.energyCost.checked);
  toggle("energyHoursRow", form.energyCost.checked);
  form.checkTime.hidden = form.checkSchedule.value !== "daily"; // Čas jen u kontroly jednou denně
}

// Cena elektřiny se zadává v měně hlavní Alzy – políčko dostane název nastavení pro tuto měnu (energyPriceCZK…),
// ostatní měny si nechají svou hodnotu
const energyPriceInput = document.getElementById("energyPrice");
function updateEnergyField(settings) {
  const { currency } = AlzaCore.domains[AlzaCore.getPrimaryDomain(settings)];
  energyPriceInput.name = AlzaCore.energyPriceKeys[currency];
  energyPriceInput.value = AlzaCore.getEnergyPrice(settings, AlzaCore.getPrimaryDomain(settings));
  document.getElementById("energyPriceUnit").textContent = `${currency}/kWh`;
}

// Odkaz na nápovědu v hlavičce – v jazyce zvoleném v nastavení
function updateHelpLink(settings) {
  document.getElementById("helpLink").href = AlzaCore.getHelpUrl(AlzaCore.getUiLanguage(settings));
}

async function loadSettings() {
  const settings = await AlzaCore.getSettings();
  form.notifyDrops.checked = settings.notifyDrops;
  form.minDropPercent.value = settings.minDropPercent;
  form.notifyNewPrices.checked = settings.notifyNewPrices;
  form.notifyAvailability.value = settings.notifyAvailability;
  form.quietHours.checked = settings.quietHours;
  form.quietFrom.value = settings.quietFrom;
  form.quietTo.value = settings.quietTo;
  form.checkSchedule.value = Object.hasOwn(AlzaCore.checkSchedules, settings.checkSchedule) ? settings.checkSchedule : AlzaCore.defaultSettings.checkSchedule;
  form.checkTime.value = settings.checkTime;
  form.categoryUnitPrice.checked = settings.categoryUnitPrice;
  form.categoryDiscountFilter.checked = settings.categoryDiscountFilter;
  form.saveBrowsing.checked = settings.saveBrowsing;
  form.watchPurchases.checked = settings.watchPurchases;
  form.remindCashback.checked = settings.remindCashback;
  form.ownedItems.checked = settings.ownedItems;
  form.remindWarranty.checked = settings.remindWarranty;
  form.energyCost.checked = settings.energyCost;
  form.energyYears.value = settings.energyYears;
  form.energyCyclesPerWeek.value = settings.energyCyclesPerWeek;
  form.energyHoursPerDay.value = settings.energyHoursPerDay;
  updateEnergyField(settings);
  form.uiLanguage.value = settings.uiLanguage;
  form.primaryDomain.value = Object.hasOwn(AlzaCore.domains, settings.primaryDomain) ? settings.primaryDomain : "auto";
  updateHelpLink(settings);
  applyLanguage(settings);
  updateDependentRows();
}

// „✓ Uloženo“ / chyba vpravo v řadě záložek nastavení
function showSaved(source, text) {
  const info = source.closest("form")?.querySelector("[data-saved]");
  if (!info) return;
  document.querySelectorAll("[data-saved]").forEach((element) => (element.textContent = ""));
  info.textContent = text;
  clearTimeout(savedTimeoutId);
  savedTimeoutId = setTimeout(() => (info.textContent = ""), 2000);
}

async function saveSettings(source) {
  const percent = Math.round(Number(form.minDropPercent.value));
  // Sloučit s uloženými – nastavení bez políčka ve formuláři se nesmí ztratit
  const settings = {
    ...(await AlzaCore.getSettings()),
    notifyDrops: form.notifyDrops.checked,
    minDropPercent: Number.isFinite(percent) ? Math.min(99, Math.max(0, percent)) : 0,
    notifyNewPrices: form.notifyNewPrices.checked,
    notifyAvailability: form.notifyAvailability.value,
    quietHours: form.quietHours.checked,
    quietFrom: form.quietFrom.value || AlzaCore.defaultSettings.quietFrom,
    quietTo: form.quietTo.value || AlzaCore.defaultSettings.quietTo,
    checkSchedule: form.checkSchedule.value,
    checkTime: form.checkTime.value || AlzaCore.defaultSettings.checkTime,
    categoryUnitPrice: form.categoryUnitPrice.checked,
    categoryDiscountFilter: form.categoryDiscountFilter.checked,
    saveBrowsing: form.saveBrowsing.checked,
    watchPurchases: form.watchPurchases.checked,
    remindCashback: form.remindCashback.checked,
    ownedItems: form.ownedItems.checked,
    remindWarranty: form.remindWarranty.checked,
    energyCost: form.energyCost.checked,
    uiLanguage: form.uiLanguage.value,
    primaryDomain: form.primaryDomain.value,
  };
  // Čísla ceny provozu: mimo rozsah nebo prázdné = zůstane uložená hodnota. Rozsahy jsou stejné jako u importu
  // zálohy (OptionsData.SETTING_RANGES)
  const within = (input, key) => (input.value === "" ? null : (OptionsData.sanitizeSettings({ [key]: Number(input.value) })[key] ?? null));
  const energyPrice = within(energyPriceInput, energyPriceInput.name);
  const energyYears = within(form.energyYears, "energyYears");
  const energyCycles = within(form.energyCyclesPerWeek, "energyCyclesPerWeek");
  const energyHours = within(form.energyHoursPerDay, "energyHoursPerDay");
  settings.energyHoursPerDay = energyHours ?? settings.energyHoursPerDay;
  if (energyPrice !== null && Object.hasOwn(AlzaCore.defaultSettings, energyPriceInput.name)) settings[energyPriceInput.name] = energyPrice;
  settings.energyYears = energyYears ?? settings.energyYears;
  settings.energyCyclesPerWeek = energyCycles ?? settings.energyCyclesPerWeek;
  await AlzaStore.run({ type: "assign", key: SETTINGS_KEY, values: settings });
  updateHelpLink(settings);
  applyLanguage(settings);

  form.minDropPercent.value = settings.minDropPercent;
  // Do políček ceny provozu se vrací jen oprava neplatné hodnoty – jinak by uložení jedné změny přepsalo hodnotu,
  // kterou uživatel mezitím napsal do vedlejšího pole. Změna hlavní Alzy přepne měnu políčka ceny elektřiny
  if (energyYears === null) form.energyYears.value = settings.energyYears;
  if (energyCycles === null) form.energyCyclesPerWeek.value = settings.energyCyclesPerWeek;
  if (energyHours === null) form.energyHoursPerDay.value = settings.energyHoursPerDay;
  const energyKey = AlzaCore.energyPriceKeys[AlzaCore.domains[AlzaCore.getPrimaryDomain(settings)].currency];
  if (energyPrice === null || energyPriceInput.name !== energyKey) updateEnergyField(settings);
  updateDependentRows();
  showSaved(source, t("saved"));
}

// Jen pole nastavení – formulář obsahuje i zálohu a mazání dat (potvrzovací políčko nastavení neukládá)
form.addEventListener("change", (event) => {
  if (!Object.hasOwn(AlzaCore.defaultSettings, event.target.name || event.target.id)) return;
  saveSettings(event.target).catch((error) => showSaved(event.target, t("saveFailed", error.message)));
});
form.addEventListener("submit", (event) => event.preventDefault());

// Služba na pozadí pošle ukázkové notifikace (na zprávu neodpovídá – zavřený port není chyba)
document.getElementById("testNotifications").addEventListener("click", () =>
  chrome.runtime.sendMessage({ action: "watchTestNotifications" }).catch(() => {})
);

// === Hlídané produkty a cílové ceny ===

function productLink(url, name) {
  if (!AlzaCore.isAlzaUrl(url)) return document.createTextNode(name || url);
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = name || url;
  return link;
}

// Dialog historie cen (graf, tabulka, cílová cena) z content scriptu – stejný jako v seznamu a na detailu.
// Stránka nastavení není na Alze: doménu (měna, klíče historie) a jazyk dostane dialog podle produktu
let historyTargetsReady = false;

async function openHistory(product) {
  const tracker = window.AlzaPriceTracker;
  if (!tracker || !AlzaCore.isAlzaUrl(product.url) || !isKnownDomain(product.domain)) return;
  if (!historyTargetsReady) {
    tracker.setupTargets(); // Cílové ceny i jejich změny z dialogu (načte je a hlídá storage)
    tracker.state.targets = (await chrome.storage.local.get(TARGETS_KEY))[TARGETS_KEY] || {};
    historyTargetsReady = true;
  }
  const { currency, locale, lang } = AlzaCore.domains[product.domain];
  const settings = await AlzaCore.getSettings();
  Object.assign(tracker.state, { currencySymbol: currency, locale, language: lang, uiLanguage: AlzaCore.getDisplayLanguage(settings, lang) });
  tracker.getAlzaDomain = () => product.domain;
  // Obrázek jen z Alzy – data mohou pocházet z importované zálohy
  await tracker.openHistoryDialog({ url: product.url, name: product.name, image: AlzaCore.isAlzaImageUrl(product.image) ? product.image : null }, null);
}

// Buňka s názvem produktu: ikona grafu otevře historii cen přímo tady, název vede na Alzu
function productCell(row, product) {
  const td = cell(row, "");
  const button = AlzaIcons.prepend(smallButton("", t("historyButtonTitle"), () => openHistory(product)), "chart");
  button.className = "history-button";
  td.append(button, productLink(product.url, product.name));
  td.title = product.name || "";
  return td;
}

function cell(row, content, className) {
  const td = row.insertCell();
  if (content instanceof Node) td.appendChild(content);
  else td.textContent = content;
  if (className) td.className = className;
  return td;
}

// Zápisy přes službu na pozadí (AlzaStore) – jinak by se přepsaly se souběžnou kontrolou nebo záložkou Alzy
function removeFrom(storageKey, key) {
  return () => AlzaStore.run({ type: "patchMap", key: storageKey, remove: [key] });
}

// Chyba kterékoli akce na stránce (tlačítka, export, import…) – uživatel ji uvidí, místo aby se „nic nestalo“.
// Do logu chyb ji zapíše AlzaCore.installErrorLog
function showActionError(error) {
  let toast = document.getElementById("actionError");
  if (!toast) {
    toast = Object.assign(document.createElement("div"), { id: "actionError", className: "action-error", role: "alert" });
    toast.addEventListener("click", () => toast.remove());
    document.body.appendChild(toast);
  }
  setText(toast, "actionFailed", error?.message || error);
  clearTimeout(showActionError.timeout);
  showActionError.timeout = setTimeout(() => toast.remove(), 10000);
}
window.addEventListener("unhandledrejection", (event) => showActionError(event.reason));
window.addEventListener("error", (event) => showActionError(event.error || event.message));

function smallButton(text, title, onClick) {
  const button = Object.assign(document.createElement("button"), { type: "button", textContent: text, title });
  button.addEventListener("click", onClick);
  return button;
}

// === Řaditelné tabulky ===
// Sloupec: { label (klíč textu), key?, value?: (položka) => číslo | text | null, text?: true }. Klik na záhlaví řadí –
// nový sloupec text A→Z, čísla a data od největšího, stejný sloupec obrátí směr; prázdné hodnoty vždy na
// konec. view = { sort, desc } je stav řazení, který přežije překreslení tabulky

function sortItems(items, columns, view) {
  const column = columns.find((candidate) => candidate.key === view.sort);
  if (!column) return items;
  const isEmpty = (value) => value === null || value === undefined || value === "";
  return [...items].sort((a, b) => {
    const x = column.value(a);
    const y = column.value(b);
    if (x === y) return 0;
    if (isEmpty(x)) return 1;
    if (isEmpty(y)) return -1;
    const result = typeof x === "string" ? x.localeCompare(y, ui.locale) : x - y;
    return view.desc ? -result : result;
  });
}

function createSortableTable(columns, view, onSort) {
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  columns.forEach(({ label, key, text }) => {
    const th = Object.assign(document.createElement("th"), { textContent: label ? t(label) : "" });
    if (key) {
      th.className = key === view.sort ? "sortable sorted" : "sortable";
      if (key === view.sort) th.textContent += view.desc ? " ▼" : " ▲";
      th.title = t("sortTitle");
      th.addEventListener("click", (event) => {
        event.stopPropagation(); // záhlaví vnořené tabulky nesmí sbalit rozbalený řádek
        view.desc = key === view.sort ? !view.desc : !text;
        view.sort = key;
        onSort();
      });
    }
    head.appendChild(th);
  });
  return table;
}

// Řádek, který klikem rozbalí pod sebou detail přes všechny sloupce (odkazy a tlačítka v řádku dělají
// své). openKeys = rozbalené řádky – zůstanou otevřené i po překreslení
function addExpandableRow(body, { key, openKeys, colSpan, fill, detail }) {
  const row = body.insertRow();
  row.className = "expandable";
  const expand = Object.assign(document.createElement("button"), { type: "button", className: "expand" });
  fill(row, expand);

  const detailRow = body.insertRow();
  detailRow.className = "detail-row";
  cell(detailRow, detail()).colSpan = colSpan;

  const update = () => {
    const open = openKeys.has(key);
    detailRow.hidden = !open;
    expand.textContent = open ? "▼" : "▶";
    expand.setAttribute("aria-expanded", String(open));
  };
  row.addEventListener("click", (event) => {
    if (event.target.closest("a, button:not(.expand)")) return;
    if (!openKeys.delete(key)) openKeys.add(key);
    update();
  });
  update();
  return row;
}

// Jedna tabulka pro hlídané produkty (z detailu) a cílové ceny – stejný produkt bývá v obou.
// Aktuální cena je z poslední kontroly v historii
const productsView = { sort: "name", desc: false };
const PRODUCT_COLUMNS = [
  { label: "colProduct", key: "name", text: true, value: (product) => product.name.toLowerCase() },
  { label: "colCurrent", key: "lowest", value: (product) => product.lowest },
  { label: "colTarget", key: "target", value: (product) => product.target?.price ?? null },
  { label: "colWatchedSince", key: "since", value: (product) => product.since },
  { label: "" },
];

async function renderProducts() {
  const container = document.getElementById("productsTable");
  const { [WATCH_PRODUCTS_KEY]: watched = {}, [TARGETS_KEY]: targets = {} } = await chrome.storage.local.get([WATCH_PRODUCTS_KEY, TARGETS_KEY]);
  const keys = [...new Set([...Object.keys(watched), ...Object.keys(targets)])];
  setTabCount("countProducts", keys.length);

  if (keys.length === 0) {
    container.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: t("noneYet") }));
    return;
  }

  // Poškozená položka (null) se přeskočí – služba na pozadí ji také ignoruje
  const products = keys
    .map((key) => ({ key, watched: watched[key] || null, target: targets[key] || null, info: watched[key] || targets[key] }))
    .filter(({ info }) => info && isKnownDomain(info.domain));
  const historyKey = ({ info }) => AlzaCore.getHistoryKey(info.domain, info.url);
  const histories = await chrome.storage.local.get(products.map(historyKey));

  products.forEach((product) => {
    const history = histories[historyKey(product)] || [];
    product.name = AlzaCore.getLatestName(history) || product.info.name || nameFromUrl(product.info.url);
    product.lowest = AlzaCore.getLowestPrice(history[history.length - 1]?.p);
    product.since = product.watched?.since || product.target?.since || null;
  });

  const table = createSortableTable(PRODUCT_COLUMNS, productsView, () => renderProducts());
  const body = table.createTBody();
  sortItems(products, PRODUCT_COLUMNS, productsView).forEach((product) => {
      const { key, watched: watchedItem, target, info, name, lowest, since } = product;
      const format = (price) => AlzaCore.formatPrice(price, info.domain);
      const row = body.insertRow();

      productCell(row, { url: info.url, name, image: info.image, domain: info.domain });
      cell(row, lowest === null ? "–" : format(lowest), target && lowest !== null && lowest <= target.price ? "reached" : null);
      cell(row, target ? iconText("target", AlzaCore.formatTargetValue(target.price, target, info.domain, AlzaCore.domains[info.domain]?.lang)) : "–");
      cell(row, since ? formatDate(since) : "–");

      const actions = document.createElement("span");
      if (watchedItem) actions.appendChild(setText(smallButton("", t("unwatchProductTitle"), removeFrom(WATCH_PRODUCTS_KEY, key)), "unwatch"));
      if (target) actions.appendChild(smallButton(t("removeTarget"), t("removeTargetTitle"), removeFrom(TARGETS_KEY, key)));
      actions.style.display = "inline-flex";
      actions.style.gap = "4px";
      cell(row, actions);
    });

  container.replaceChildren(table);
}

// === Záloha dat ===
// Zálohují se jen data rozšíření se známým klíčem (ne stav běhů, log, nákupy a slevové kódy – OptionsData v
// options-backup.js). Import kontroluje klíče i tvar hodnot – adresy produktů z importu se stahují s cookies, ale
// služba na pozadí pouští jen https Alzu.

const BACKUP_FORMAT = "alza-wishlist-price-insights";
const { browsed: BROWSED_KEY, cashbackReminders: CASHBACK_REMINDERS_KEY } = AlzaCore.storageKeys;
const { history: HISTORY_PREFIX, price: PRICE_PREFIX } = AlzaCore.storagePrefixes;
const {
  BACKUP_KEY_PATTERN,
  PRICE_KEY_PATTERN,
  LEGACY_PRICES_KEY_PATTERN,
  HISTORY_KEY_PATTERN,
  isPlainObject,
  isOptionalString,
  isKnownDomain,
  toImportTime,
  toImportImage,
  sanitizeProductMap,
  sanitizeCashbackReminders,
  sanitizeSettings,
} = OptionsData;
const backupInfo = document.getElementById("backupInfo");

function showBackupInfo(text, isError = false) {
  backupInfo.textContent = text;
  backupInfo.style.color = isError ? "#c62828" : "";
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000); // Firefox s dotazem „Kam uložit“ čte soubor až po potvrzení
}

// Místní datum (ISO by po půlnoci dalo včerejší)
function today() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}

// Obsazené místo v bajtech. Firefox getBytesInUse u storage.local nemá – odhad z velikosti JSON
async function getBytesInUse(all = null) {
  if (typeof chrome.storage.local.getBytesInUse === "function") {
    try {
      return await chrome.storage.local.getBytesInUse(null);
    } catch {
      // odhad níže
    }
  }
  return new Blob([JSON.stringify(all ?? (await chrome.storage.local.get(null)))]).size;
}

async function getBackupData() {
  const all = await chrome.storage.local.get(null);
  return Object.fromEntries(Object.entries(all).filter(([key]) => BACKUP_KEY_PATTERN.test(key)));
}

// Typ ceny se používá i v názvu CSS třídy – jen písmena, číslice a podtržítko
const PRICE_TYPE_PATTERN = /^\w+$/;
const isPriceMap = (prices) =>
  isPlainObject(prices) && Object.entries(prices).every(([type, price]) => PRICE_TYPE_PATTERN.test(type) && Number.isFinite(price));
const isHistory = (value) =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      isPlainObject(entry) &&
      Number.isFinite(entry.t) &&
      Number.isFinite(entry.s) &&
      isPriceMap(entry.p) &&
      isOptionalString(entry.a) &&
      (entry.n === undefined || typeof entry.n === "string")
  );

const MAX_IMPORT_BYTES = 200 * 1024 * 1024; // Větší soubor by stránku zamrazil – záloha tak velká nebývá

// Meta klíč záznamu ceny ve správném tvaru? Čas v budoucnosti (posunuté hodiny, ruční úprava zálohy) by
// záznam držel „čerstvý“ navždy – seznam by produkt už nikdy nestáhl
function isValidPriceMeta(key, value, now = Date.now()) {
  const isTime = (time) => Number.isFinite(time) && time > 0 && time <= now + AlzaCore.dayMs;
  const isPoint = (point) => isPlainObject(point) && Number.isFinite(point.value) && isTime(point.timestamp);
  switch (key) {
    case "lastUpdated":
      return isTime(value);
    case "minPrice":
    case "maxPrice":
    case "maxLowestPrice":
      return isPoint(value);
    case "oldLowestPrice":
    case "newLowestPrice":
      return Number.isFinite(value);
    case "noPrice":
      return typeof value === "boolean";
    case "url":
      return AlzaCore.isAlzaUrl(value);
    case "listId":
      return typeof value === "string" || Number.isFinite(value);
    case "packCount":
      return Number.isInteger(value) && value > 0;
    case "quantityTiers":
      return AlzaCore.getQuantityTiers({ quantityTiers: value }) !== null;
    case "conditions":
      return isPlainObject(value) && typeof value.current === "string" && isPlainObject(value.prices) && Object.values(value.prices).every(Number.isFinite);
    default:
      return false;
  }
}

// Záznam ceny: ceny jen číselné (u akcí { price, icon }), meta klíče (min/max, čas…) jen ve správném tvaru
function sanitizePriceRecord(record) {
  const isPriceValue = (price) =>
    Number.isFinite(price) || (isPlainObject(price) && Number.isFinite(price.price) && isOptionalString(price.icon) && isOptionalString(price.code));
  return Object.fromEntries(
    Object.entries(record).filter(([key, price]) =>
      AlzaCore.metaKeys.includes(key) ? isValidPriceMeta(key, price) : PRICE_TYPE_PATTERN.test(key) && isPriceValue(price)
    )
  );
}

// Starší záloha: uložené ceny jedné domény { adresa produktu na Alze: záznam }
function sanitizePriceRecords(value) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([url, record]) => AlzaCore.isAlzaUrl(url) && isPlainObject(record))
      .map(([url, record]) => [url, sanitizePriceRecord(record)])
  );
}

// Importované nastavení kontroluje OptionsData.sanitizeSettings (známé volby, správný typ, rozsah jako formulář)

// Hlídané seznamy bez products by rozbily popup i službu na pozadí; produkty jen s adresou Alzy
function sanitizeWatchLists(value) {
  const isListProduct = ([url, info]) => AlzaCore.isAlzaUrl(url) && isPlainObject(info) && isOptionalString(info.name) && isOptionalString(info.image);
  const isListId = (listId) => (typeof listId === "string" && listId !== "") || Number.isFinite(listId);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, list]) => isPlainObject(list) && isKnownDomain(list.domain) && isListId(list.listId) && isOptionalString(list.name))
      .map(([key, list]) => [
        key,
        {
          domain: list.domain,
          listId: list.listId,
          name: list.name ?? null,
          url: AlzaCore.isAlzaUrl(list.url) ? list.url : null,
          since: list.since == null ? null : toImportTime(list.since),
          syncedAt: list.syncedAt == null ? null : toImportTime(list.syncedAt),
          products: isPlainObject(list.products)
            ? Object.fromEntries(
                Object.entries(list.products)
                  .filter(isListProduct)
                  .map(([url, info]) => [url, { ...info, image: toImportImage(info.image) }])
              )
            : {},
        },
      ])
  );
}

// Stáhne zálohu, vrací uložená data (i pro smazání všech dat – maže se jen to, co je v záloze)
async function exportBackup() {
  const data = await getBackupData();
  const backup = { format: BACKUP_FORMAT, version: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString(), data };
  download(`alza-ceny-zaloha-${today()}.json`, JSON.stringify(backup), "application/json");
  return data;
}

document.getElementById("exportJson").addEventListener("click", async () => {
  const data = await exportBackup();
  const histories = Object.keys(data).filter((key) => key.startsWith(HISTORY_PREFIX)).length;
  showBackupInfo(t("exportedJson", Object.keys(data).length, histories));
});

// Dlouhý formát (řádek = jedna cena v jednom období) se v Excelu dobře filtruje i dává do kontingenční tabulky
document.getElementById("exportCsv").addEventListener("click", async () => {
  const data = await getBackupData();

  // Název z historie (od záznamu, kde se změnil); u starších záznamů bez názvu ze seznamů a hlídání
  const names = {};
  Object.values(data[AlzaCore.storageKeys.watchLists] || {}).forEach((list) =>
    Object.entries(list?.products || {}).forEach(([url, info]) => (names[AlzaCore.getProductKey(list.domain, url)] ??= { url, name: info?.name }))
  );
  [data[WATCH_PRODUCTS_KEY], data[TARGETS_KEY]].forEach((items) =>
    Object.entries(items || {}).forEach(([key, item]) => item && (names[key] ??= { url: item.url, name: item.name }))
  );

  // Buňka začínající = + - @ by se v Excelu vyhodnotila jako vzorec (název produktu je z webu / zálohy)
  const quote = (value) => {
    const text = String(value ?? "");
    return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
  };
  // Data souboru, ne texty stránky – formát pro český Excel (středník, desetinná čárka) bez ohledu na jazyk
  const date = (ts) => new Date(ts).toLocaleString("cs-CZ");
  const rows = [["domena", "produkt", "nazev", "url", "od", "do", "dostupnost", "typ_ceny", "cena"]];

  Object.entries(data)
    .filter(([key]) => key.startsWith(HISTORY_PREFIX))
    .forEach(([key, entries]) => {
      const productKey = key.slice(HISTORY_PREFIX.length);
      const [, domain, id] = key.match(HISTORY_KEY_PATTERN) || [];
      const { url = "", name = "" } = names[productKey] || {};
      const lang = AlzaCore.domains[domain]?.lang || "cz";
      let currentName = name;
      (Array.isArray(entries) ? entries : []).forEach((entry) => {
        if (entry.n) currentName = entry.n;
        const base = [domain, id, currentName, url, date(entry.t), date(entry.s), AlzaCore.getAvailabilityLabel(entry.a, lang)];
        const prices = Object.entries(entry.p || {});
        if (prices.length === 0) rows.push([...base, "", ""]);
        prices.forEach(([type, price]) => rows.push([...base, AlzaCore.translate(lang, `type_${type}`), String(price).replace(".", ",")]));
      });
    });

  // BOM + středník, ať český Excel soubor otevře rovnou správně
  download(`alza-ceny-historie-${today()}.csv`, `﻿${rows.map((row) => row.map(quote).join(";")).join("\r\n")}`, "text/csv");
  showBackupInfo(t("exportedCsv", rows.length - 1));
});

const importFile = document.getElementById("importFile");
document.getElementById("importJson").addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = "";
  if (!file) return;

  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error(t("importTooBig"));
    const backup = JSON.parse(await file.text());
    if (backup?.format !== BACKUP_FORMAT || !isPlainObject(backup.data)) throw new Error(t("importNotBackup"));

    const valid = {};
    let skipped = 0;
    Object.entries(backup.data).forEach(([key, value]) => {
      const ok = BACKUP_KEY_PATTERN.test(key) && (key.startsWith(HISTORY_PREFIX) ? isHistory(value) : isPlainObject(value));
      if (!ok) {
        skipped++;
      } else if (key === SETTINGS_KEY) {
        valid[key] = sanitizeSettings(value);
      } else if (key === AlzaCore.storageKeys.watchLists) {
        valid[key] = sanitizeWatchLists(value);
        skipped += Object.keys(value).length - Object.keys(valid[key]).length; // Neplatné položky uvnitř se počítají taky
      } else if (key === TARGETS_KEY || key === WATCH_PRODUCTS_KEY || key === BROWSED_KEY) {
        valid[key] = sanitizeProductMap(value, key === TARGETS_KEY);
        skipped += Math.max(0, Object.keys(value).length - Object.keys(valid[key]).length);
      } else if (key === CASHBACK_REMINDERS_KEY) {
        valid[key] = sanitizeCashbackReminders(value);
        skipped += Math.max(0, Object.keys(value).length - Object.keys(valid[key]).length);
      } else if (LEGACY_PRICES_KEY_PATTERN.test(key)) {
        valid[key] = sanitizePriceRecords(value);
      } else if (PRICE_KEY_PATTERN.test(key)) {
        valid[key] = sanitizePriceRecord(value);
      } else {
        valid[key] = value; // historie – ověřená isHistory
      }
    });
    // Připomínky cashbacku, které tu už jsou, mají přednost (aktuální Hotovo a odeslaná upozornění) – ze zálohy jen chybějící
    if (valid[CASHBACK_REMINDERS_KEY]) {
      const { [CASHBACK_REMINDERS_KEY]: current } = await chrome.storage.local.get(CASHBACK_REMINDERS_KEY);
      const fresh = Object.entries(valid[CASHBACK_REMINDERS_KEY]).filter(([key]) => !(isPlainObject(current) && Object.hasOwn(current, key)));
      if (fresh.length > 0) valid[CASHBACK_REMINDERS_KEY] = Object.fromEntries(fresh);
      else delete valid[CASHBACK_REMINDERS_KEY];
    }
    const count = Object.keys(valid).length;
    if (count === 0) throw new Error(t("importEmpty"));

    const histories = Object.keys(valid).filter((key) => key.startsWith(HISTORY_PREFIX)).length;
    const exported = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString(ui.locale) : t("importUnknownDate");
    const question = t("importConfirm", exported, count, histories);
    if (!confirm(question)) return;

    // Vše sloučit se stávajícími daty, ať import nesmaže, co v záloze není: seznamy, hlídané produkty,
    // cílové ceny, uložené ceny a nastavení po položkách, historii podle času záznamů (AlzaStore importData –
    // ve frontě služby na pozadí, souběžná kontrola se nepřepíše)
    await AlzaStore.run({ type: "importData", items: valid });
    showBackupInfo(t("imported", count) + (skipped ? t("importedSkipped", skipped) : ""));
    loadSettings();
  } catch (error) {
    showBackupInfo(t("importFailed", error.message), true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[TARGETS_KEY] || changes[WATCH_PRODUCTS_KEY])) renderProducts();
});

// === Úklid starých dat ===
// Nehlídané produkty bez kontroly přes AlzaCore.staleDataDays (AlzaCore.findStaleProducts – stejné pravidlo
// počítá služba na pozadí pro modré číslo na ikoně). Maže se jen po potvrzení; seznam se těsně před
// smazáním ověří znovu – otevřený seznam nebo detail mohl produkt mezitím obnovit

async function deleteStaleProducts(keys) {
  const stale = AlzaCore.findStaleProducts(await chrome.storage.local.get(null)).filter((product) => keys.has(product.key));
  await AlzaStore.run({ type: "removeProducts", productKeys: stale.map((product) => product.key) });
  // Modré číslo na ikoně přepočítá služba na pozadí (na zprávu neodpovídá – zavřený port není chyba)
  chrome.runtime.sendMessage({ action: "cleanupRefresh" }).catch(() => {});
  return stale.length;
}

async function runCleanup(report) {
  try {
    const stale = AlzaCore.findStaleProducts(await chrome.storage.local.get(null));
    if (stale.length === 0) {
      report(t("cleanupNothing"));
      return;
    }
    const question = t("cleanupConfirm", stale.length);
    if (!confirm(question)) return;
    report(t("cleanupDone", await deleteStaleProducts(new Set(stale.map((product) => product.key)))));
  } catch (error) {
    report(t("cleanupFailed", error.message), true);
  }
}

document.getElementById("pruneData").addEventListener("click", () => runCleanup(showBackupInfo));

// === Uložená data ===
// Přehled všech produktů, o kterých jsou data (historie cen, uložené ceny ze seznamů) nebo které se
// hlídají. Název je nejaktuálnější z historie cen, jinak ze seznamů, hlídaných produktů, cílových cen
// a logu, nakonec z adresy produktu
const DATA_PAGE_SIZES = [25, 50, 100, 200];
const dataSearch = document.getElementById("dataSearch");
const dataFilter = document.getElementById("dataFilter");
let storedProducts = [];
let storedProductsTimeout = null;
// Řazení kliknutím na záhlaví; stránka se vrací na první při změně hledání, filtru nebo řazení
const dataView = { sort: "checkedAt", desc: true, page: 0, pageSize: 50 };

const DATA_COLUMNS = [
  { label: "colProduct", key: "name", text: true, value: (product) => product.name.toLowerCase() },
  { label: "colDomain", key: "domain", text: true, value: (product) => product.domain },
  { label: "colCurrent", key: "lowest", value: (product) => product.lowest },
  { label: "colMin", key: "min", value: (product) => product.min },
  { label: "colMax", key: "max", value: (product) => product.max },
  { label: "colHistory", key: "history", value: (product) => product.history?.length ?? null },
  { label: "colLastChecked", key: "checkedAt", value: (product) => product.checkedAt },
  { label: "colTracked", key: "tracked", text: true, value: (product) => product.reasons.map(({ text }) => text).join(", ").toLowerCase() },
  { label: "" },
];

function nameFromUrl(url) {
  try {
    const slug = decodeURIComponent(new URL(url).pathname.split("/").pop())
      .replace(/-d\d+\.htm$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : url;
  } catch {
    return url;
  }
}

async function loadStoredProducts() {
  const all = await chrome.storage.local.get(null);
  const staleKeys = new Set(AlzaCore.findStaleProducts(all).map((product) => product.key));
  const products = new Map();
  const get = (domain, url, key = AlzaCore.getProductKey(domain, url)) => {
    if (!products.has(key)) {
      products.set(key, { key, domain, url: null, name: null, image: null, lists: [], watched: false, target: null, browsed: null, history: null, record: null });
    }
    const product = products.get(key);
    if (!product.url && AlzaCore.isAlzaUrl(url)) product.url = url;
    return product;
  };

  Object.values(all[AlzaCore.storageKeys.watchLists] || {}).forEach((list) =>
    Object.entries(list?.products || {}).forEach(([url, info]) => {
      const product = get(list.domain, url);
      product.lists.push(list.name);
      product.name ||= info?.name;
      product.image ||= info?.image;
    })
  );
  Object.entries(all[WATCH_PRODUCTS_KEY] || {}).forEach(([key, item]) => {
    if (!item) return;
    const product = get(item.domain, item.url, key);
    product.watched = true;
    product.name ||= item.name;
    product.image ||= item.image;
  });
  Object.entries(all[TARGETS_KEY] || {}).forEach(([key, item]) => {
    if (!item) return;
    const product = get(item.domain, item.url, key);
    product.target = item;
    product.name ||= item.name;
    product.image ||= item.image;
  });
  Object.entries(all).forEach(([storageKey, record]) => {
    const match = storageKey.match(PRICE_KEY_PATTERN);
    if (match && isPlainObject(record)) get(match[1], record.url, storageKey.slice(PRICE_PREFIX.length)).record = record;
  });
  Object.entries(all[BROWSED_KEY] || {}).forEach(([key, item]) => {
    if (!item) return;
    const product = get(item.domain, item.url, key);
    product.browsed = item;
    product.name ||= item.name;
    product.image ||= item.image;
  });
  Object.keys(all).forEach((storageKey) => {
    if (!storageKey.startsWith(HISTORY_PREFIX)) return;
    const key = storageKey.slice(HISTORY_PREFIX.length);
    const domain = storageKey.match(HISTORY_KEY_PATTERN)?.[1];
    if (domain) get(domain, null, key).history = Array.isArray(all[storageKey]) ? all[storageKey] : [];
  });

  // Nejaktuálnější název je v historii cen (ukládá se při každé změně); bez historie z logu kontrol
  products.forEach((product) => {
    const latest = AlzaCore.getLatestName(product.history);
    if (latest) product.name = latest;
  });
  (all[AlzaCore.storageKeys.watchLog] || []).forEach((run) =>
    (run?.items || []).forEach((item) => {
      if (!AlzaCore.isAlzaUrl(item?.url)) return;
      const product = products.get(AlzaCore.getProductKey(AlzaCore.getDomainKey(new URL(item.url).hostname), item.url));
      if (!product) return;
      product.name ||= item.name;
      product.url ||= item.url;
    })
  );

  // Položka bez platné domény (poškozená data) by shodila celou tabulku
  return [...products.values()].filter((product) => isKnownDomain(product.domain)).map((product) => {
    const history = product.history || [];
    const last = history[history.length - 1];
    const recordPrices = product.record ? AlzaCore.toPriceMap(product.record) : {};
    const historyLows = history.map((entry) => AlzaCore.getLowestPrice(entry.p)).filter((price) => price !== null);
    const plausibleLows = history.map((entry) => AlzaCore.getPlausibleMinPrice(entry.p)).filter((price) => price !== null);
    // Proč se produkt sleduje: { icon, text } – v tabulce ikona a text, k řazení a v bublině jen texty
    const reasons = [
      ...product.lists.map((name) => ({ icon: "list", text: name })),
      ...(product.watched ? [{ icon: "bell", text: t("reasonDetail") }] : []),
      ...(product.target
        ? [{ icon: "target", text: AlzaCore.formatTargetValue(product.target.price, product.target, product.domain, AlzaCore.domains[product.domain]?.lang) }]
        : []),
      ...(product.browsed ? [{ icon: "visibility", text: t("reasonBrowsed") }] : []),
    ];
    const stale = staleKeys.has(product.key);
    if (stale) reasons.push({ icon: "cleaning", text: t("reasonStale") });
    return {
      ...product,
      reasons,
      stale,
      name: product.name || (product.url ? nameFromUrl(product.url) : product.key),
      tracked: product.lists.length > 0 || product.watched || Boolean(product.target),
      lowest: AlzaCore.getLowestPrice(Object.keys(recordPrices).length > 0 ? recordPrices : last?.p),
      min: product.record?.minPrice?.value ?? (plausibleLows.length ? Math.min(...plausibleLows) : null),
      max: product.record?.maxPrice?.value ?? (historyLows.length ? Math.max(...historyLows) : null),
      checkedAt: Math.max(last?.s || 0, product.record?.lastUpdated || 0, product.browsed?.seenAt || 0) || null,
    };
  });
}

// Smaže historii a uložené ceny produktu; hlídání a cílová cena zůstávají (pak se data začnou ukládat znovu)
async function deleteProductData(product) {
  await AlzaStore.run({ type: "removeProducts", productKeys: [product.key] });
}

function renderStoredProducts() {
  const container = document.getElementById("storedProducts");
  const query = dataSearch.value.trim().toLowerCase();
  const filter = dataFilter.value;
  const matches = storedProducts
    .filter((product) => {
      if (filter === "tracked" && !product.tracked) return false;
      if (filter === "untracked" && product.tracked) return false;
      if (filter === "target" && !product.target) return false;
      if (filter === "stale" && !product.stale) return false;
      if (filter === "browsed" && !product.browsed) return false;
      return !query || product.name.toLowerCase().includes(query) || (product.url || "").toLowerCase().includes(query);
    });

  const pager = document.getElementById("dataPager");
  if (matches.length === 0) {
    container.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: t("nothingFound") }));
    pager.replaceChildren();
    return;
  }

  const sorted = sortItems(matches, DATA_COLUMNS, dataView);
  const pageCount = Math.ceil(matches.length / dataView.pageSize);
  dataView.page = Math.min(dataView.page, pageCount - 1); // po smazání / změně dat může stránka zmizet
  const from = dataView.page * dataView.pageSize;
  const pageItems = sorted.slice(from, from + dataView.pageSize);

  const table = createSortableTable(DATA_COLUMNS, dataView, () => {
    dataView.page = 0;
    renderStoredProducts();
  });
  const body = table.createTBody();
  pageItems.forEach((product) => {
    const format = (price) => (price === null || price === undefined ? "–" : AlzaCore.formatPrice(price, product.domain));
    const row = body.insertRow();
    if (!product.tracked) row.className = "untracked";

    productCell(row, product);
    cell(row, product.domain.replace("alza_", "."));
    cell(row, format(product.lowest));
    cell(row, format(product.min));
    cell(row, format(product.max));
    cell(row, product.history ? String(product.history.length) : "–");
    cell(row, product.checkedAt ? formatDate(product.checkedAt) : "–");

    const trackedBy = cell(row, product.reasons.length ? "" : "–", "tracked-by");
    product.reasons.forEach(({ icon, text }, index) => trackedBy.append(...(index ? [", "] : []), iconText(icon, text)));
    trackedBy.title = product.reasons.map(({ text }) => text).join("\n");

    const hasData = Boolean(product.history || product.record);
    cell(
      row,
      hasData
        ? AlzaIcons.prepend(
            smallButton("", t("deleteProductTitle"), async () => {
              const note = product.tracked ? t("deleteProductStillTracked") : "";
              if (!confirm(t("deleteProductConfirm", product.name) + note)) return;
              await deleteProductData(product);
            }),
            "delete"
          )
        : ""
    );
  });

  container.replaceChildren(table);
  renderPager(pager, matches.length, pageCount, from, pageItems.length);
}

function renderPager(pager, total, pageCount, from, shown) {
  const goTo = (page) => () => {
    dataView.page = page;
    renderStoredProducts();
  };
  const prev = smallButton(t("pagerPrev"), t("pagerPrevTitle"), goTo(dataView.page - 1));
  prev.disabled = dataView.page === 0;
  const next = smallButton(t("pagerNext"), t("pagerNextTitle"), goTo(dataView.page + 1));
  next.disabled = dataView.page >= pageCount - 1;

  const size = document.createElement("select");
  DATA_PAGE_SIZES.forEach((value) => size.add(new Option(t("pageSize", value), value, false, value === dataView.pageSize)));
  size.addEventListener("change", () => {
    dataView.pageSize = Number(size.value);
    dataView.page = 0;
    renderStoredProducts();
  });

  pager.replaceChildren(
    t("pagerRange", from + 1, from + shown, total),
    Object.assign(document.createElement("span"), { className: "spacer" }),
    prev,
    t("pagerPage", dataView.page + 1, pageCount),
    next,
    size
  );
}

async function refreshStoredProducts() {
  storedProducts = await loadStoredProducts();
  setTabCount("countData", storedProducts.length);
  renderCleanupBanner();
  const bytes = await getBytesInUse();
  const tracked = storedProducts.filter((product) => product.tracked).length;
  const entries = storedProducts.reduce((sum, product) => sum + (product.history?.length || 0), 0);
  const kilobytes = (bytes / 1024).toLocaleString(ui.locale, { maximumFractionDigits: 0 });
  document.getElementById("dataSummary").textContent = t("dataSummary", storedProducts.length, tracked, entries, kilobytes);
  renderStoredProducts();
}

// Návrh čistky nad tabulkou – stejné produkty jako modré číslo na ikoně
const cleanupInfo = document.getElementById("cleanupInfo");

function renderCleanupBanner() {
  const count = storedProducts.filter((product) => product.stale).length;
  document.getElementById("cleanupBanner").hidden = count === 0;
  document.getElementById("cleanupCount").textContent = String(count);
  dataFilter.querySelector('option[value="stale"]').textContent = t("filterStaleCount", count);
}

document.getElementById("cleanupShow").addEventListener("click", () => {
  dataFilter.value = "stale";
  renderFirstPage();
});
document.getElementById("cleanupDelete").addEventListener("click", () =>
  runCleanup((text, isError = false) => {
    cleanupInfo.textContent = text;
    cleanupInfo.style.color = isError ? "#c62828" : "";
  })
);

const renderFirstPage = () => {
  dataView.page = 0;
  renderStoredProducts();
};
let searchTimeout = null;
dataSearch.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(renderFirstPage, 150);
});
dataFilter.addEventListener("change", renderFirstPage);

// Přehled stojí na historii, uložených cenách, seznamech, hlídání, cílových cenách a logu (názvy). Stav
// běhu, nastavení a log chyb se mění často a přehled neovlivní – celé storage kvůli nim znovu nečíst
const STORED_PRODUCTS_KEYS = new Set([AlzaCore.storageKeys.watchLists, WATCH_PRODUCTS_KEY, TARGETS_KEY, BROWSED_KEY, AlzaCore.storageKeys.watchLog]);
const affectsStoredProducts = (key) => STORED_PRODUCTS_KEYS.has(key) || key.startsWith(HISTORY_PREFIX) || key.startsWith(PRICE_PREFIX);

// Kontrola na pozadí zapisuje po každém produktu a přehled čte celé storage – překreslit až po chvíli bez
// dalších změn: na otevřené záložce dat po sekundě, jinak po 10 s (jen počet v záložce), na skryté stránce
// až po návratu na ni
let storedProductsDirty = false;

function scheduleStoredProductsRefresh() {
  storedProductsDirty = true;
  clearTimeout(storedProductsTimeout);
  if (document.hidden) return;
  const dataTabOpen = !document.getElementById("tab-data").hidden;
  storedProductsTimeout = setTimeout(() => {
    storedProductsDirty = false;
    refreshStoredProducts().catch((error) => console.error(error));
  }, dataTabOpen ? 1000 : 10000);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(changes).some(affectsStoredProducts)) scheduleStoredProductsRefresh();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && storedProductsDirty) scheduleStoredProductsRefresh();
});

refreshStoredProducts().catch((error) => console.error("Přehled uložených dat se nepodařilo načíst:", error));

// === Diagnostika ===
// Soubor pro autora: verze, prostředí, nastavení, počty dat, log kontrol a chyby (AlzaCore.installErrorLog).
// Stack ukazuje soubor a řádek nezminifikovaného kódu – dohledá se ve zdrojácích uvedené verze.

const { errorLog: ERROR_LOG_KEY, watchState: WATCH_STATE_KEY, watchLog: WATCH_LOG_KEY, watchLists: WATCH_LISTS_KEY } = AlzaCore.storageKeys;

async function renderErrorSummary() {
  const { [ERROR_LOG_KEY]: log = [] } = await chrome.storage.local.get(ERROR_LOG_KEY);
  const last = log[log.length - 1];
  document.getElementById("errorSummary").textContent = last
    ? t("errorSummary", log.length, new Date(last.t).toLocaleString(ui.locale))
    : t("errorSummaryNone");
}

async function buildDiagnostics() {
  const all = await chrome.storage.local.get(null);
  const histories = Object.entries(all).filter(([key]) => key.startsWith(HISTORY_PREFIX));
  const lists = Object.values(all[WATCH_LISTS_KEY] || {});
  // Co kdo koupil, do diagnostiky nepatří: nové nákupy jen počtem, produkt hlídaný jen kvůli nákupu beze jména
  const redacted = OptionsData.redactDiagnostics({
    watchLog: all[WATCH_LOG_KEY],
    watchState: all[WATCH_STATE_KEY],
    errors: all[ERROR_LOG_KEY],
    sensitive: getSensitiveTexts(all),
  });
  return {
    format: `${BACKUP_FORMAT}-diagnostics`,
    version: chrome.runtime.getManifest().version,
    createdAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    language: navigator.language,
    settings: all[SETTINGS_KEY] || null,
    counts: {
      watchedLists: lists.length,
      watchedListProducts: lists.reduce((sum, list) => sum + Object.keys(list.products || {}).length, 0),
      watchedProducts: Object.keys(all[WATCH_PRODUCTS_KEY] || {}).length,
      browsedProducts: Object.keys(all[BROWSED_KEY] || {}).length,
      targets: Object.keys(all[TARGETS_KEY] || {}).length,
      histories: histories.length,
      historyEntries: histories.reduce((sum, [, entries]) => sum + (Array.isArray(entries) ? entries.length : 0), 0),
      priceRecords: Object.fromEntries(
        Object.keys(AlzaCore.domains).map((domain) => [domain, Object.keys(all).filter((key) => key.startsWith(`${PRICE_PREFIX}${domain}_`)).length])
      ),
      // Jen počty – kódy, nákupy a připomínky cashbacku samotné do diagnostiky nepatří
      codes: Object.keys(all[AlzaCore.storageKeys.codes] || {}).length,
      purchases: Object.keys(all[AlzaCore.storageKeys.purchases] || {}).length,
      cashbackReminders: Object.keys(all[CASHBACK_REMINDERS_KEY] || {}).length,
      bytesInUse: await getBytesInUse(all),
    },
    watchState: redacted.watchState,
    watchLog: redacted.watchLog.slice(0, 30), // Log je od nejnovějšího
    errors: redacted.errors,
  };
}

document.getElementById("exportDiagnostics").addEventListener("click", async () => {
  const report = await buildDiagnostics();
  download(`alza-ceny-diagnostika-${today()}.json`, JSON.stringify(report, null, 2), "application/json");
});

// Nahlásit chybu: nové issue na GitHubu s předvyplněnou osnovou, verzí, prohlížečem a posledními chybami.
// Nic se neodesílá – uživatel hlášení zkontroluje a odešle sám (účet na GitHubu). Adresa se drží pod limitem délky URL
const REPORT_BUG_URL = "https://github.com/Pnaky/Alza-Price-Insight/issues/new";
const REPORT_BUG_ERRORS = 5;
const REPORT_BUG_MAX_URL = 7500;

// Hlášení je veřejné – adresy, slevové kódy a názvy koupeného zboží z chyb pryč (OptionsData.redactForReport)
const { redactForReport, getSensitiveTexts } = OptionsData;

function getBrowserName() {
  const ua = navigator.userAgent;
  // Edge a Opera mají v textu i "Chrome/" (dřív) – nejdřív hledat je. Safari se hlásí "Version/27.2 Safari/605.1.15"
  // bez "Chrome/" (Chrome má "Safari/537.36", ale ne "Version/")
  const safari = ua.match(/Version\/(\d+)[\d.]* Safari\//);
  const match = ua.match(/(Edg|OPR|Firefox)\/(\d+)/) || ua.match(/(Chrome)\/(\d+)/) || (safari && [safari[0], "Safari", safari[1]]);
  const name = { Edg: "Edge", OPR: "Opera" }[match?.[1]] || match?.[1] || "?";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return [match ? `${name} ${match[2]}` : name, os].filter(Boolean).join(", ");
}

document.getElementById("reportBug").addEventListener("click", async () => {
  // Kódy a názvy koupeného zboží (hlídání po nákupu, připomínky cashbacku, Moje nákupy) – z chyb se začerní
  const stored = await chrome.storage.local.get([ERROR_LOG_KEY, ...OptionsData.SENSITIVE_KEYS]);
  const log = Array.isArray(stored[ERROR_LOG_KEY]) ? stored[ERROR_LOG_KEY] : [];
  const sensitive = getSensitiveTexts(stored);
  const settings = await AlzaCore.getSettings();
  const version = chrome.runtime.getManifest().version;
  const errors = log.slice(-REPORT_BUG_ERRORS).map(
    (entry) =>
      `- ${new Date(entry.t).toISOString().slice(0, 16).replace("T", " ")} UTC ${entry.version || ""} [${redactForReport(entry.source, sensitive)}] ${redactForReport(String(entry.message).replace(/\s+/g, " "), sensitive).slice(0, 300)}`
  );
  const primary = new URL(AlzaCore.domains[AlzaCore.getPrimaryDomain(settings)].origin).hostname.replace(/^www\./, "");
  const buildUrl = (lines) => {
    const body = t("reportBugBody", version, getBrowserName(), AlzaCore.getUiLanguage(settings), primary, lines.join("\n") || t("reportBugNoErrors"));
    // Bez předvyplněného názvu – GitHub název vyžaduje, takže ho uživatel napíše sám (verze je v textu)
    return `${REPORT_BUG_URL}?${new URLSearchParams({ body })}`;
  };
  // Hotová adresa (po zakódování) pod limitem GitHubu – ubírat nejstarší chyby
  let url = buildUrl(errors);
  while (url.length > REPORT_BUG_MAX_URL && errors.length > 0) {
    errors.shift();
    url = buildUrl(errors);
  }
  chrome.tabs.create({ url: url.slice(0, REPORT_BUG_MAX_URL) });
});

document.getElementById("clearErrorLog").addEventListener("click", async () => {
  await AlzaStore.run({ type: "remove", keys: [ERROR_LOG_KEY] });
  renderErrorSummary();
});

// === Smazání všech dat ===
// Jen po napsání potvrzovacího slova a vždy s automatickou zálohou předem. Co se smaže a co zůstane (nastavení,
// log chyb), určuje OptionsData.getWipeKeys – nákupy, slevové kódy a cashbacky se smažou taky, i když v záloze nejsou

// Potvrzovací slovo je v jazyce stránky (SMAZAT / ZMAZAŤ / TÖRLÉS / DELETE) – stejné jako v poznámce nad políčkem
const wipeConfirm = document.getElementById("wipeConfirm");
const wipeButton = document.getElementById("wipeData");
const isWipeConfirmed = () => wipeConfirm.value.trim().toUpperCase() === t("wipeWord");

// Data zálohy stažené prvním klepnutím – maže se až druhým, po potvrzení, že soubor opravdu vznikl
// (stažení může uživatel zrušit nebo prohlížeč zablokovat)
let wipeBackup = null;

// Text tlačítka podle kroku (i po změně jazyka); povolené jen s napsaným potvrzovacím slovem
function updateWipeButton() {
  setText(wipeButton, wipeBackup ? "wipeButtonConfirm" : "wipeButton");
  wipeButton.disabled = !isWipeConfirmed();
}

function resetWipe() {
  wipeBackup = null;
  updateWipeButton();
}

resetWipe();
wipeConfirm.addEventListener("input", resetWipe);

wipeButton.addEventListener("click", async () => {
  if (!isWipeConfirmed()) return;
  wipeButton.disabled = true;
  try {
    if (!wipeBackup) {
      wipeBackup = await exportBackup();
      showBackupInfo(t("wipeDownloading", `alza-ceny-zaloha-${today()}.json`));
      updateWipeButton();
      return;
    }
    // Číslo na ikoně se týká mazaných produktů – vynulovat (služba na pozadí neodpovídá)
    await chrome.runtime.sendMessage({ action: "watchSeen" }).catch(() => {});
    // Produkty jen ze zálohy (co mezitím přibylo, zůstane), k tomu všechny přehledy rozšíření kromě nastavení a logu chyb
    const keys = OptionsData.getWipeKeys(wipeBackup);
    const count = Object.keys(await chrome.storage.local.get(keys)).length;
    await AlzaStore.run({ type: "remove", keys });
    wipeConfirm.value = "";
    resetWipe();
    showBackupInfo(t("wipeDone", count));
    renderProducts();
    chrome.runtime.sendMessage({ action: "cleanupRefresh" }).catch(() => {});
  } catch (error) {
    resetWipe();
    showBackupInfo(t("wipeFailed", error.message), true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[ERROR_LOG_KEY]) renderErrorSummary();
});

// Nastavení změněné jinde (průvodce, druhá záložka nastavení) – načíst do formuláře, jinak by ho další uložení
// z této stránky vrátilo zpět
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SETTINGS_KEY]) return;
  const next = { ...AlzaCore.defaultSettings, ...changes[SETTINGS_KEY].newValue };
  const value = (input) => String(input.type === "checkbox" ? input.checked : input.value);
  // Vlastní uložení formulář nepřekresluje – jen když se uložené liší od toho, co je ve formuláři
  if ([...form.elements].some((input) => input.name && Object.hasOwn(next, input.name) && value(input) !== String(next[input.name]))) {
    loadSettings().catch((error) => console.error("Nastavení se nepodařilo načíst:", error));
  }
});

// === Hlídané seznamy ===
// Klik na řádek seznamu rozbalí pod ním jeho produkty s cenami z historie (kontrola na pozadí ji plní).
// Řazení produktů je společné pro všechny rozbalené seznamy

const openLists = new Set();
const listsView = { sort: "name", desc: false };
const listProductsView = { sort: "name", desc: false };
const formatDateTime = (ts) => (ts ? new Date(ts).toLocaleString(ui.locale, { dateStyle: "short", timeStyle: "short" }) : "–");

const LIST_COLUMNS = [
  { label: "colList", key: "name", text: true, value: (list) => list.name.toLowerCase() },
  { label: "colDomain", key: "domain", text: true, value: (list) => list.domain },
  { label: "colProductCount", key: "count", value: (list) => list.entries.length },
  { label: "colSynced", key: "syncedAt", value: (list) => list.syncedAt || null },
  { label: "colWatchedSince", key: "since", value: (list) => list.since || null },
  { label: "" },
];

const LIST_PRODUCT_COLUMNS = [
  { label: "colProduct", key: "name", text: true, value: (product) => product.name.toLowerCase() },
  { label: "colCurrent", key: "lowest", value: (product) => product.lowest },
  { label: "colMin", key: "min", value: (product) => product.min },
  { label: "colMax", key: "max", value: (product) => product.max },
  { label: "colLastChecked", key: "checkedAt", value: (product) => product.checkedAt },
];

async function renderLists() {
  const container = document.getElementById("listsTable");
  const { [WATCH_LISTS_KEY]: stored = {} } = await chrome.storage.local.get(WATCH_LISTS_KEY);
  const lists = Object.entries(stored)
    .filter(([, list]) => isPlainObject(list) && isKnownDomain(list.domain))
    .map(([key, list]) => ({ ...list, key, name: list.name || t("listFallbackName", list.listId), entries: Object.entries(list.products || {}) }));
  setTabCount("countLists", lists.length);
  if (lists.length === 0) {
    container.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: t("noneYet") }));
    return;
  }

  const historyKeys = lists.flatMap((list) => list.entries.map(([url]) => AlzaCore.getHistoryKey(list.domain, url)));
  const histories = await chrome.storage.local.get(historyKeys);

  const table = createSortableTable(LIST_COLUMNS, listsView, () => renderLists());
  const body = table.createTBody();
  sortItems(lists, LIST_COLUMNS, listsView).forEach((list) =>
    addExpandableRow(body, {
      key: list.key,
      openKeys: openLists,
      colSpan: LIST_COLUMNS.length,
      fill: (row, expand) => {
        const name = Object.assign(document.createElement("span"), { className: "row-title" });
        name.appendChild(productLink(list.url, list.name));
        const nameCell = cell(row, expand);
        nameCell.appendChild(name);
        nameCell.title = list.name;
        cell(row, list.domain.replace("alza_", "."));
        cell(row, String(list.entries.length));
        cell(row, formatDateTime(list.syncedAt));
        cell(row, list.since ? formatDate(list.since) : "–");
        cell(
          row,
          setText(
            smallButton("", t("unwatchListTitle"), async () => {
              if (!confirm(t("unwatchListConfirm", list.name))) return;
              openLists.delete(list.key);
              await removeFrom(WATCH_LISTS_KEY, list.key)();
            }),
            "unwatch"
          )
        );
      },
      detail: () => createListProducts(list, histories),
    })
  );

  container.replaceChildren(table);
}

function createListProducts(list, histories) {
  if (list.entries.length === 0) return Object.assign(document.createElement("p"), { className: "empty", textContent: t("listEmpty") });

  const products = list.entries.map(([url, info]) => {
    const stored = histories[AlzaCore.getHistoryKey(list.domain, url)];
    const history = Array.isArray(stored) ? stored : [];
    const lows = history.map((entry) => AlzaCore.getLowestPrice(entry.p)).filter((price) => price !== null);
    const plausibleLows = history.map((entry) => AlzaCore.getPlausibleMinPrice(entry.p)).filter((price) => price !== null);
    return {
      url,
      name: AlzaCore.getLatestName(history) || info?.name || nameFromUrl(url),
      image: info?.image || null,
      lowest: AlzaCore.getLowestPrice(history[history.length - 1]?.p),
      min: plausibleLows.length ? Math.min(...plausibleLows) : null,
      max: lows.length ? Math.max(...lows) : null,
      checkedAt: history[history.length - 1]?.s || null,
    };
  });

  const table = createSortableTable(LIST_PRODUCT_COLUMNS, listProductsView, () => renderLists());
  const body = table.createTBody();
  const format = (price) => (price === null ? "–" : AlzaCore.formatPrice(price, list.domain));
  sortItems(products, LIST_PRODUCT_COLUMNS, listProductsView).forEach((product) => {
    const row = body.insertRow();
    productCell(row, { ...product, domain: list.domain });
    cell(row, format(product.lowest));
    cell(row, format(product.min));
    cell(row, format(product.max));
    cell(row, formatDateTime(product.checkedAt));
  });
  return table;
}

// === Log běhů ===
// Řádek = jeden běh; rozkliknutí ukáže změny, chyby a nezměněné produkty

const openRuns = new Set();
const logView = { sort: "start", desc: true };

function getRunStatus(run) {
  if (run.aborted) return t("statusAborted");
  if (run.offline) return t("statusOffline");
  return run.end ? t("statusDone") : t("statusUnfinished");
}

const getRunTrigger = (run) => t(run.trigger === "manual" ? "triggerManual" : "triggerAuto");

const LOG_COLUMNS = [
  { label: "colStart", key: "start", value: (run) => run.start },
  { label: "colTrigger", key: "trigger", text: true, value: (run) => getRunTrigger(run) },
  { label: "colChecked", key: "checked", value: (run) => run.items.length },
  { label: "colChanges", key: "changed", value: (run) => run.changed.length },
  { label: "colErrors", key: "failed", value: (run) => run.failed.length },
  { label: "colSkipped", key: "skipped", value: (run) => run.skipped || 0 },
  { label: "colDuration", key: "duration", value: (run) => (run.end ? run.end - run.start : null) },
  { label: "colStatus", key: "status", text: true, value: (run) => getRunStatus(run) },
];

async function renderLog() {
  const container = document.getElementById("watchLog");
  const { [WATCH_LOG_KEY]: stored = [] } = await chrome.storage.local.get(WATCH_LOG_KEY);
  setTabCount("countLog", stored.length);
  if (stored.length === 0) {
    container.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: t("logEmpty") }));
    return;
  }

  const runs = stored.map((run) => {
    const items = Array.isArray(run.items) ? run.items : [];
    return {
      ...run,
      items,
      changed: items.filter((item) => item.lines?.length > 0),
      failed: items.filter((item) => item.problem),
      unchanged: items.filter((item) => !item.lines?.length && !item.problem),
    };
  });

  const table = createSortableTable(LOG_COLUMNS, logView, () => renderLog());
  const body = table.createTBody();
  sortItems(runs, LOG_COLUMNS, logView).forEach((run) => {
    const row = addExpandableRow(body, {
      key: run.start,
      openKeys: openRuns,
      colSpan: LOG_COLUMNS.length,
      fill: (row, expand) => {
        cell(row, expand).append(formatDateTime(run.start));
        cell(row, getRunTrigger(run));
        cell(row, `${run.items.length}/${run.total ?? run.items.length}`);
        cell(row, run.changed.length ? iconText("bell", String(run.changed.length)) : "–");
        cell(row, run.failed.length ? iconText("warning", String(run.failed.length), true) : "–");
        cell(row, run.skipped ? String(run.skipped) : "–");
        cell(row, run.end ? t("durationSeconds", Math.max(1, Math.round((run.end - run.start) / 1000))) : "–");
        cell(row, getRunStatus(run));
      },
      detail: () => createRunDetail(run),
    });
    if (run.failed.length || run.aborted) row.classList.add("watch-problem");
  });

  container.replaceChildren(table);
}

function createRunDetail(run) {
  const detail = document.createElement("div");
  const addEntry = (item, text, className) => {
    const entry = document.createElement("div");
    entry.className = `watch-log-entry ${className}`;
    entry.append(productLink(item.url, item.name), `: ${text}`);
    detail.appendChild(entry);
  };
  const addNote = (text) => detail.appendChild(Object.assign(document.createElement("div"), { className: "watch-log-note", textContent: text }));

  // Obsah hlídaných seznamů z API (položky přidané / odebrané jinde, např. v mobilní aplikaci)
  const names = (list, count) => list.join(", ") + (count > list.length ? ", …" : "");
  (Array.isArray(run.lists) ? run.lists : []).forEach((list) => {
    // Objednávky (hlídání po nákupu) – stejný tvar záznamu, vlastní texty
    if (list.problem) return addEntry(list, t(list.orders ? "logOrdersProblem" : "logListProblem", list.problem), "watch-problem");
    if (list.addedCount) addEntry(list, t(list.orders ? "logOrdersAdded" : "logListAdded", list.addedCount, names(list.added || [], list.addedCount)), "watch-log-change");
    if (list.removedCount) addEntry(list, t("logListRemoved", list.removedCount, names(list.removed || [], list.removedCount)), "watch-log-change");
  });
  run.changed.forEach((item) => addEntry(item, item.lines.map((text) => AlzaCore.upgradePriceDropText(text, item.url)).join(" · "), "watch-log-change"));
  run.failed.forEach((item) => addEntry(item, item.problem, "watch-problem"));
  if (run.unchanged.length) addNote(t("logUnchanged", run.unchanged.length, run.unchanged.map((item) => item.name).join(", ")));
  if (run.skipped) addNote(t("logSkipped", run.skipped));
  if (run.offline) addNote(t("logOffline"));
  if (!detail.hasChildNodes()) addNote(t("logNoDetails"));
  return detail;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[WATCH_LISTS_KEY]) renderLists().catch((error) => console.error(error));
  if (changes[WATCH_LOG_KEY]) renderLog().catch((error) => console.error(error));
});

renderLists().catch((error) => console.error("Hlídané seznamy se nepodařilo načíst:", error));
renderLog().catch((error) => console.error("Log běhů se nepodařilo načíst:", error));

// === Záložky ===
// Nastavení: vybraná záložka se pamatuje v prohlížeči (localStorage – jen pohodlí, bez něj se otevře první)
const SETTINGS_TABS = ["tracking", "notifications", "categories", "general"];
const SETTINGS_TAB_KEY = "alzaSettingsTab";

// Vybraná záložka: aria-selected a jako jediná v pořadí tabulátoru (ostatní šipkami – setupTabKeys)
function markSelectedTab(buttons, isSelected) {
  buttons.forEach((button) => {
    const selected = isSelected(button);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

// Klávesnice v řadě záložek: šipky vlevo / vpravo (dokola), Home a End přejdou na záložku a rovnou ji otevřou
function setupTabKeys(tablist) {
  tablist.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (index < 0) return;
    const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    tab.focus();
    tab.click();
  });
}
document.querySelectorAll('[role="tablist"]').forEach(setupTabKeys);

function showSettingsTab(name) {
  const tab = SETTINGS_TABS.includes(name) ? name : SETTINGS_TABS[0];
  markSelectedTab(document.querySelectorAll("[data-settings-tab]"), (button) => button.dataset.settingsTab === tab);
  SETTINGS_TABS.forEach((panel) => (document.getElementById(`settings-${panel}`).hidden = panel !== tab));
  return tab;
}

// Otevře záložku nastavení a zapamatuje ji
function selectSettingsTab(name) {
  const tab = showSettingsTab(name);
  try {
    localStorage.setItem(SETTINGS_TAB_KEY, tab);
  } catch {
    // Volba se jen nezapamatuje
  }
}

document.querySelectorAll("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => selectSettingsTab(button.dataset.settingsTab)));
try {
  showSettingsTab(localStorage.getItem(SETTINGS_TAB_KEY));
} catch {
  showSettingsTab(SETTINGS_TABS[0]);
}

// Data: vybraná záložka je v adrese (#lists, #products, #data, #log) – po obnovení stránky zůstane otevřená.
// Přímý odkaz na záložku nastavení: #s-<záložka> (#s-tracking, #s-notifications, #s-categories, #s-general) –
// otevře ji a zapamatuje jako po kliknutí; v adrese pak zase zůstane záložka dat (applyHash)

const TABS = ["lists", "products", "owned", "data", "log"]; // owned = Moje nákupy (options-owned.js)
const SETTINGS_HASH_PREFIX = "s-";
let currentTab = TABS[0];

function showTab(name) {
  // #cleanup (odkaz z popupu) = uložená data s filtrem navržených ke smazání
  if (name === "cleanup") {
    dataFilter.value = "stale";
    if (storedProducts.length > 0) renderFirstPage();
  }
  const tab = name === "cleanup" ? "data" : TABS.includes(name) ? name : TABS[0];
  currentTab = tab;
  markSelectedTab(document.querySelectorAll(".tab[data-tab]"), (button) => button.dataset.tab === tab);
  TABS.forEach((panel) => (document.getElementById(`tab-${panel}`).hidden = panel !== tab));
  if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
  if (tab === "data" && storedProductsDirty) scheduleStoredProductsRefresh();
}

function setTabCount(id, count) {
  document.getElementById(id).textContent = `(${count})`;
}

// Adresa → záložky. #s-<záložka> patří nastavení (záložka dat zůstane, jak je), cokoli jiného záložkám dat
function applyHash() {
  const name = location.hash.slice(1);
  if (!name.startsWith(SETTINGS_HASH_PREFIX)) return showTab(name);
  const settingsTab = name.slice(SETTINGS_HASH_PREFIX.length);
  if (SETTINGS_TABS.includes(settingsTab)) {
    selectSettingsTab(settingsTab);
    form.scrollIntoView({ block: "nearest" });
  }
  showTab(currentTab);
}

document.querySelectorAll(".tab[data-tab]").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)));
window.addEventListener("hashchange", applyHash);
applyHash();

renderErrorSummary().catch((error) => console.error("Log chyb se nepodařilo načíst:", error));

renderVersion();
loadSettings().catch((error) => console.error("Nastavení se nepodařilo načíst:", error));
renderProducts().catch((error) => console.error("Hlídané produkty se nepodařilo načíst:", error));
