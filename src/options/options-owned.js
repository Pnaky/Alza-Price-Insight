// Stránka nastavení – záložka „Moje nákupy“ (volba ownedItems): všechno koupené z archivu objednávek na Alze
// (AlzaOwned v shared/orders.js, načítá služba na pozadí). Řádek = jeden nákup (produkt v jedné objednávce):
// kdy a za kolik, stav záruky (AlzaCore.getWarrantyState) a odkaz na objednávku. Nad tabulkou výdaje po letech.
// Načítá se za options.js a používá jeho pomocné funkce (t, cell, productLink, smallButton, sortItems…)

const OWNED_KEY = AlzaCore.storageKeys.owned;
const OWNED_ORDERS_KEY = AlzaCore.storageKeys.ownedOrders;
const OWNED_SYNC_KEY = AlzaCore.storageKeys.ownedSync;
const OWNED_ENDING_DAYS = 90; // Filtr „záruka končí do 90 dní“
const OWNED_PAGE_SIZE = 50;
const OWNED_SYNC_ROUNDS = 20; // Dávek načítání na jedno kliknutí (dávka = 60 detailů objednávek)

const ownedSearch = document.getElementById("ownedSearch");
const ownedFilter = document.getElementById("ownedFilter");
const ownedYear = document.getElementById("ownedYear");
const ownedMonth = document.getElementById("ownedMonth");
const ownedSyncButton = document.getElementById("ownedSync");
const ownedInfo = document.getElementById("ownedInfo");
const ownedView = { sort: "bought", desc: true, page: 0 };
let ownedRows = [];
let ownedOrders = {}; // Objednávky po doménách ({ číslo: [čas, částka] }) – součet za vybrané období
let ownedSyncing = false;

// Graf výdajů: nákupy v jiné měně se do společného sloupce přepočítají přibližným kurzem (kolik Kč je jednotka měny).
// Jen pro výšku sloupců – částky v bublině a v tabulce zůstávají v původní měně. Kurzy se nikde nestahují
const OWNED_RATES = { Kč: 1, "€": 25, Ft: 0.062 };
const OWNED_CHART_TICKS = 4; // Přibližný počet vodorovných linek grafu
const OWNED_CHART_SHORT_YEARS = 18; // Víc let = popisky „'26“ místo „2026“
const OWNED_SPENDING_OPEN_KEY = "alzaOwnedSpendingOpen"; // localStorage: sbalený / rozbalený graf (jen pohodlí)

const OWNED_COLUMNS = [
  { label: "colProduct", key: "name", text: true, value: (row) => row.name.toLowerCase() },
  { label: "colOwnedBought", key: "bought", value: (row) => row.buy.t },
  { label: "colOwnedCount", key: "count", value: (row) => row.buy.n },
  { label: "colOwnedPrice", key: "price", value: (row) => row.buy.p ?? null },
  { label: "colOwnedTotal", key: "total", value: (row) => ownedRowTotal(row) },
  { label: "colOwnedWarranty", key: "warranty", value: (row) => row.warranty.until },
  { label: "" },
];

const ownedIsObject = (value) => value && typeof value === "object" && !Array.isArray(value);

async function loadOwned() {
  const data = await chrome.storage.local.get([OWNED_KEY, OWNED_ORDERS_KEY, OWNED_SYNC_KEY]);
  const owned = ownedIsObject(data[OWNED_KEY]) ? data[OWNED_KEY] : {};
  const now = Date.now();
  const rows = [];
  Object.entries(owned).forEach(([key, product]) => {
    if (!ownedIsObject(product) || !isKnownDomain(product.domain) || !Array.isArray(product.buys)) return;
    product.buys.forEach((buy) => {
      if (!Number.isFinite(buy?.t)) return;
      rows.push({
        key,
        product,
        buy,
        name: product.name || nameFromUrl(product.url),
        category: (Array.isArray(product.cat) ? product.cat : []).join(" › "), // Jen pro hledání a bublinu názvu – sloupec nemá
        warranty: AlzaCore.getWarrantyState(buy, now),
      });
    });
  });
  return {
    rows,
    products: new Set(rows.map((row) => row.key)).size,
    orders: ownedIsObject(data[OWNED_ORDERS_KEY]) ? data[OWNED_ORDERS_KEY] : {},
    sync: ownedIsObject(data[OWNED_SYNC_KEY]) ? data[OWNED_SYNC_KEY] : {},
    pending: Object.keys(AlzaCore.domains).reduce((sum, domain) => sum + AlzaCore.getOwnedDetailQueue(owned, domain, now).length, 0),
    // Produkty, u kterých se délka záruky teprve zjistí z Alzy (po dávkách při načítání)
    warrantyPending: Object.keys(AlzaCore.domains).reduce((sum, domain) => sum + AlzaCore.getOwnedWarrantyQueue(owned, domain, now).length, 0),
  };
}

// Cena řádku = cena kusu × kusy; null = cenu kusu neznáme (starší nákupy bez načteného detailu)
function ownedRowTotal({ buy }) {
  return buy.p > 0 ? Math.round(buy.p * (buy.n || 1) * 100) / 100 : null;
}

// Vybrané období: rok, případně i měsíc (0–11); bez roku platí všechno. Časy v místním čase jako v grafu
function getOwnedPeriod() {
  const year = Number(ownedYear.value) || null;
  const month = year && ownedMonth.value !== "" ? Number(ownedMonth.value) : null;
  const matches = (time) => {
    if (!year) return true;
    const date = new Date(time);
    return date.getFullYear() === year && (month === null || date.getMonth() === month);
  };
  return { year, month, matches };
}

// Nabídka roků (jen ty, ve kterých je nákup) a měsíců v jazyce stránky; výběr zůstává
function renderOwnedPeriodOptions() {
  const years = [...new Set(ownedRows.map((row) => new Date(row.buy.t).getFullYear()))].sort((a, b) => b - a);
  const [year, month] = [ownedYear.value, ownedMonth.value];
  ownedYear.replaceChildren(ownedYear.options[0], ...years.map((value) => new Option(String(value), String(value))));
  ownedYear.value = years.includes(Number(year)) ? year : "";
  const monthName = (index) => new Date(2000, index, 1).toLocaleString(ui.locale, { month: "long" });
  ownedMonth.replaceChildren(ownedMonth.options[0], ...Array.from({ length: 12 }, (_, index) => new Option(monthName(index), String(index))));
  ownedMonth.value = ownedYear.value === "" ? "" : month;
  ownedMonth.disabled = ownedYear.value === "";
}

// Částky po doménách jako text („12 345 Kč + 120,00 €“) – každá Alza ve své měně
function ownedMoney(sums) {
  return Object.keys(AlzaCore.domains)
    .filter((domain) => sums[domain] !== undefined)
    .map((domain) => AlzaCore.formatPrice(Math.round(sums[domain] * 100) / 100, domain))
    .join(" + ");
}

// Součet nad tabulkou – vždy jedna částka, ať se neplete:
//   jen období (rok / měsíc) = částky celých objednávek z archivu (včetně dopravy, bez vráceného zboží) – stejné
//   číslo jako v grafu, známé i u starých let
//   hledání nebo filtr záruky = součet sloupce Celkem u vybraných řádků (vrácené se nepočítá; starší nákupy cenu
//   kusu nemají)
function renderOwnedSelection(matches, period, narrowed) {
  const box = document.getElementById("ownedSelection");
  box.hidden = (!period.year && !narrowed) || matches.length === 0;
  if (box.hidden) return;
  const kept = matches.filter((row) => !row.buy.ret);
  const pieces = kept.reduce((sum, row) => sum + (row.buy.n || 1), 0);
  if (period.year && !narrowed) {
    const totals = {};
    let count = 0;
    getOwnedSpending(ownedOrders, ownedRows, period.matches).forEach((entry) => {
      totals[entry.domain] = (totals[entry.domain] || 0) + entry.total;
      count += entry.count;
    });
    if (count > 0) {
      box.textContent = [t("ownedSelectionPeriod", kept.length, pieces, count, ownedMoney(totals)), ...getOwnedChanges(period.year, period.month)].join(" · ");
      return;
    }
  }
  const priced = kept.filter((row) => ownedRowTotal(row) !== null);
  const goods = {};
  priced.forEach((row) => (goods[row.product.domain] = (goods[row.product.domain] || 0) + ownedRowTotal(row)));
  const parts = [t("ownedSelection", kept.length, pieces)];
  if (priced.length > 0) parts.push(t("ownedSelectionGoods", ownedMoney(goods)));
  if (kept.length > priced.length) parts.push(t("ownedSelectionUnknown", kept.length - priced.length));
  if (matches.length > kept.length) parts.push(t("ownedSelectionReturned", matches.length - kept.length));
  box.textContent = parts.join(" · ");
}

// U konce záruky i odkud je: délka podle Alzy („36 měs.“), nebo „odhad“ (24 měsíců), dokud se ji nepodařilo zjistit
function ownedWarrantyCell(row, { state, until, daysLeft }, buy) {
  const date = formatDate(until);
  const texts = {
    active: () => t("ownedWarrantyUntil", date),
    ending: () => t("ownedWarrantyEnding", date, daysLeft),
    expired: () => t("ownedWarrantyExpired", date),
    extended: () => t("ownedWarrantyExtended"),
    returned: () => t("ownedWarrantyReturned"),
    claimed: () => t("ownedWarrantyClaimed"),
    none: () => t("ownedWarrantyNone"),
  };
  const td = cell(row, texts[state]());
  if (["active", "ending", "expired"].includes(state)) {
    const known = buy?.w > 0;
    const source = Object.assign(document.createElement("span"), { className: "owned-warranty-source", textContent: ` · ${known ? t("ownedWarrantyMonths", buy.w) : t("ownedWarrantyEstimate")}` });
    td.appendChild(source);
    td.title = known ? t("ownedWarrantyKnownTip", buy.w) : t("ownedWarrantyEstimateTip");
  }
  if (state === "ending") td.className = "owned-ending";
  if (state === "extended") td.className = "reached";
  return td;
}

function renderOwnedTable() {
  const container = document.getElementById("ownedTable");
  const pager = document.getElementById("ownedPager");
  const query = ownedSearch.value.trim().toLowerCase();
  const filter = ownedFilter.value;
  const period = getOwnedPeriod();
  const inWarranty = (state) => ["active", "ending", "extended"].includes(state);
  // Vybraný rok a měsíc jsou zvýrazněné i v grafech (kliknutím na sloupec se vybírají); vybraný rok má graf měsíců
  renderOwnedMonths(period.year);
  document.querySelectorAll(".owned-chart-col[data-year], .owned-chart-col[data-month]").forEach((column) => {
    const selected = column.dataset.month === undefined ? column.dataset.year === ownedYear.value : column.dataset.month === ownedMonth.value;
    column.classList.toggle("owned-chart-col--selected", selected);
    column.setAttribute("aria-pressed", String(selected));
  });
  const matches = ownedRows.filter(({ name, category, product, warranty, buy }) => {
    if (!period.matches(buy.t)) return false;
    if (filter === "warranty" && !inWarranty(warranty.state)) return false;
    if (filter === "ending" && !(["active", "ending"].includes(warranty.state) && warranty.daysLeft <= OWNED_ENDING_DAYS)) return false;
    if (filter === "expired" && warranty.state !== "expired") return false;
    if (filter === "returned" && !["returned", "claimed"].includes(warranty.state)) return false;
    return !query || [name, category, product.brand || ""].some((text) => text.toLowerCase().includes(query));
  });
  renderOwnedSelection(matches, period, query !== "" || filter !== "all");

  if (matches.length === 0) {
    container.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: t(ownedRows.length === 0 ? "noneYet" : "nothingFound") }));
    pager.replaceChildren();
    return;
  }

  const sorted = sortItems(matches, OWNED_COLUMNS, ownedView);
  const pageCount = Math.ceil(matches.length / OWNED_PAGE_SIZE);
  ownedView.page = Math.min(ownedView.page, pageCount - 1);
  const from = ownedView.page * OWNED_PAGE_SIZE;
  const pageItems = sorted.slice(from, from + OWNED_PAGE_SIZE);

  const table = createSortableTable(OWNED_COLUMNS, ownedView, () => {
    ownedView.page = 0;
    renderOwnedTable();
  });
  const body = table.createTBody();
  pageItems.forEach((item) => {
    const { product, buy, name, category, warranty } = item;
    const row = body.insertRow();
    if (["expired", "returned", "claimed", "none"].includes(warranty.state)) row.className = "owned-past";
    const nameCell = cell(row, productLink(product.url, name));
    nameCell.title = [name, product.brand, category].filter(Boolean).join("\n");
    cell(row, formatDate(buy.t));
    cell(row, String(buy.n || 1));
    cell(row, buy.p > 0 ? AlzaCore.formatPrice(buy.p, product.domain) : "–");
    cell(row, ownedRowTotal(item) !== null ? AlzaCore.formatPrice(ownedRowTotal(item), product.domain) : "–");
    ownedWarrantyCell(row, warranty, buy);
    const orderUrl = AlzaCore.getOrderUrl(product.domain, buy.o);
    // Odkaz na objednávku jen jako ikona (název v bublině a pro čtečku) – sloupec nezabírá místo
    const orderLink = orderUrl ? productLink(orderUrl, t("ownedOrderLink")) : null;
    if (orderLink instanceof HTMLAnchorElement) {
      Object.assign(orderLink, { title: t("ownedOrderLink"), className: "owned-order" });
      orderLink.setAttribute("aria-label", t("ownedOrderLink"));
      orderLink.replaceChildren(AlzaIcons.create(document, "open", { solo: true }));
    }
    cell(row, orderLink || "");
  });
  container.replaceChildren(table);

  const goTo = (page) => () => {
    ownedView.page = page;
    renderOwnedTable();
  };
  const prev = smallButton(t("pagerPrev"), t("pagerPrevTitle"), goTo(ownedView.page - 1));
  prev.disabled = ownedView.page === 0;
  const next = smallButton(t("pagerNext"), t("pagerNextTitle"), goTo(ownedView.page + 1));
  next.disabled = ownedView.page >= pageCount - 1;
  pager.replaceChildren(
    t("pagerRange", from + 1, from + pageItems.length, matches.length),
    Object.assign(document.createElement("span"), { className: "spacer" }),
    prev,
    t("pagerPage", ownedView.page + 1, pageCount),
    next
  );
}

const ownedEl = (tag, className, text) => Object.assign(document.createElement(tag), { className }, text === undefined ? {} : { textContent: text });
const ownedDomainName = (domain) => domain.replace("alza_", "alza.");
const ownedSwatch = (domain) => ownedEl("i", `owned-chart-swatch owned-seg--${domain.replace("alza_", "")}`);

// Výdaje z částek objednávek se zbožím (včetně dopravy, bez zrušených) – každá Alza ve své měně. Vrácené zboží se
// odečte (cena kusu × kusy u nákupů ve stavu „vráceno“; známe jen u objednávek s načteným detailem).
// inPeriod(čas) omezí součet na období, groupOf(čas) určí skupinu (výchozí rok; u grafu měsíců číslo měsíce).
// [{ year (skupina), domain, count, total (už bez vráceného), returned }]
function getOwnedSpending(orders, rows, inPeriod = () => true, groupOf = (time) => new Date(time).getFullYear()) {
  const groups = new Map(); // "skupina|doména" → záznam
  const entryOf = (time, domain) => {
    const year = groupOf(time);
    if (!groups.has(`${year}|${domain}`)) groups.set(`${year}|${domain}`, { year, domain, count: 0, total: 0, returned: 0 });
    return groups.get(`${year}|${domain}`);
  };
  Object.entries(orders).forEach(([domain, list]) => {
    if (!isKnownDomain(domain) || !ownedIsObject(list)) return;
    Object.values(list).forEach((order) => {
      const [time, total] = Array.isArray(order) ? order : [];
      if (!Number.isFinite(time) || !inPeriod(time)) return;
      const entry = entryOf(time, domain);
      entry.count++;
      entry.total += Number(total) || 0;
    });
  });
  rows.forEach(({ product, buy }) => {
    if (buy.ret && buy.p > 0 && inPeriod(buy.t) && groups.has(`${groupOf(buy.t)}|${product.domain}`)) entryOf(buy.t, product.domain).returned += buy.p * (buy.n || 1);
  });
  return [...groups.values()].map((entry) => ({ ...entry, returned: Math.min(entry.returned, entry.total), total: Math.max(0, entry.total - entry.returned) }));
}

const ownedCurrency = (domain) => AlzaCore.domains[domain].currency;
const ownedInCrowns = ({ domain, total }) => total * (OWNED_RATES[ownedCurrency(domain)] || 0);

// Společné měřítko obou grafů: Alzy s nákupem a z nich ta s největší útratou – v její měně je osa (ostatní měny
// přepočtené OWNED_RATES). Nastaví renderOwnedSpending; null = žádné objednávky
let ownedScale = null;

// Období jako rozsah časů [from, to): rok, nebo měsíc roku (měsíc −1 = prosinec předchozího roku)
function ownedRange(year, month = null) {
  if (month === null) return { from: new Date(year, 0, 1).getTime(), to: new Date(year + 1, 0, 1).getTime() };
  return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime() };
}

// Součet objednávek v rozsahu: částky po doménách, počet objednávek a hodnota ve společné měně (pro procenta)
function getOwnedRangeSum({ from, to }) {
  const sum = { totals: {}, count: 0, value: 0 };
  getOwnedSpending(ownedOrders, ownedRows, (time) => time >= from && time < to).forEach((entry) => {
    sum.totals[entry.domain] = (sum.totals[entry.domain] || 0) + entry.total;
    sum.count += entry.count;
    sum.value += ownedInCrowns(entry);
  });
  return sum;
}

// „meziročně +37 % (říjen 2025: 9 000 Kč)“ – změna období proti dřívějšímu. Období, které ještě běží (letošní rok,
// tento měsíc), se srovnává se stejně dlouhým začátkem dřívějšího („2025 do 11. 11.“), jinak by vždy vyšel pokles.
// null = v dřívějším období nic není
function getOwnedChange(key, current, earlier, label, now = Date.now()) {
  const running = now >= current.from && now < current.to;
  const to = running ? Math.min(earlier.to, earlier.from + (now - current.from)) : earlier.to;
  const before = getOwnedRangeSum({ from: earlier.from, to });
  if (before.count === 0 || before.value <= 0) return null;
  const change = Math.round((getOwnedRangeSum(current).value / before.value - 1) * 100);
  const cut = to < earlier.to ? t("ownedCompareUntil", label, new Date(to).toLocaleDateString(ui.locale, { day: "numeric", month: "numeric" })) : label;
  return t(key, `${change < 0 ? "−" : "+"}${Math.abs(change)} %`, cut, ownedMoney(before.totals));
}

// Srovnání vybraného období: rok meziročně; měsíc s předchozím měsícem a se stejným měsícem loni
function getOwnedChanges(year, month = null) {
  if (month === null) return [getOwnedChange("ownedYoY", ownedRange(year), ownedRange(year - 1), String(year - 1))].filter(Boolean);
  const name = (monthYear, index) => new Date(monthYear, index, 1).toLocaleString(ui.locale, { month: "long", year: "numeric" });
  return [
    getOwnedChange("ownedMoM", ownedRange(year, month), ownedRange(year, month - 1), name(year, month - 1)),
    getOwnedChange("ownedYoY", ownedRange(year, month), ownedRange(year - 1, month), name(year - 1, month)),
  ].filter(Boolean);
}

// Zaokrouhlený krok osy (1 / 2 / 5 × 10ⁿ), aby vyšlo kolem OWNED_CHART_TICKS linek
function ownedAxisStep(max) {
  const rough = max / OWNED_CHART_TICKS;
  const power = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 5, 10].map((multiple) => multiple * power).find((step) => step >= rough);
}

// Sloupcový graf: Alzy (.cz / .sk / .hu) ve sloupci na sobě, výška v měně ownedScale.base. Bublina sloupce (najetí
// myší i klávesnice) ukazuje částky v původní měně a srovnání. columns: [{ name (popisek osy), title (nadpis bubliny),
// entries (záznamy getOwnedSpending), ghost (výška šedého sloupce srovnání; 0 = žádný), lines (další řádky bubliny),
// data ({ year } / { month } – sloupec jde vybrat kliknutím) }]
function buildOwnedChart(columns, { label, legend = null, className = "" }) {
  const { base, height } = ownedScale;
  const sumOf = (column) => column.entries.reduce((sum, entry) => sum + height(entry), 0);
  const max = Math.max(1, ...columns.map((column) => Math.max(sumOf(column), column.ghost || 0)));
  const step = ownedAxisStep(max);
  const top = Math.ceil(max / step) * step;
  const compact = new Intl.NumberFormat(ui.locale, { notation: "compact", maximumFractionDigits: 1 });

  const chart = ownedEl("div", `owned-chart ${className}`.trim());
  if (legend) chart.appendChild(legend);
  const plot = ownedEl("div", "owned-chart-plot");
  plot.setAttribute("role", "group");
  plot.setAttribute("aria-label", label);
  for (let value = step; value <= top; value += step) {
    const line = ownedEl("div", "owned-chart-grid", value === top ? `${compact.format(value)} ${ownedCurrency(base)}` : compact.format(value));
    line.style.bottom = `${(value / top) * 100}%`;
    plot.appendChild(line);
  }
  const names = ownedEl("div", "owned-chart-years");
  columns.forEach(({ name, title, entries, ghost = 0, lines = [], data = {} }, index) => {
    const column = ownedEl("div", "owned-chart-col");
    const bars = ownedEl("div", "owned-chart-bars");
    const stack = ownedEl("div", "owned-chart-stack");
    const tip = ownedEl("div", `owned-chart-tip${index >= columns.length / 2 ? " owned-chart-tip--left" : ""}`);
    const spoken = [title]; // Popis sloupce pro čtečku – totéž co bublina
    tip.appendChild(ownedEl("strong", "", title));
    if (ghost > 0) bars.appendChild(ownedEl("div", "owned-chart-ghost")).style.height = `${(ghost / top) * 100}%`;
    const visible = entries.filter((entry) => entry.total > 0);
    visible.forEach((entry, position) => {
      const segment = ownedEl("div", `owned-chart-seg owned-seg--${entry.domain.replace("alza_", "")}${position === visible.length - 1 ? " owned-chart-seg--top" : ""}`);
      segment.style.height = `${(height(entry) / top) * 100}%`;
      stack.appendChild(segment);
    });
    bars.appendChild(stack);
    entries.forEach((entry) => {
      const parts = [AlzaCore.formatPrice(entry.total, entry.domain), t("ownedOrdersCount", entry.count)];
      if (entry.returned > 0) parts.push(t("ownedReturnedAmount", AlzaCore.formatPrice(entry.returned, entry.domain)));
      spoken.push(`${ownedDomainName(entry.domain)}: ${parts.join(", ")}`);
      tip.appendChild(ownedEl("div", "owned-chart-tip-row")).append(ownedSwatch(entry.domain), `${ownedDomainName(entry.domain)}: ${parts.join(" · ")}`);
    });
    lines.forEach((line) => {
      spoken.push(line);
      tip.appendChild(ownedEl("div", "owned-chart-tip-row", line));
    });
    if (entries.length > 0 || lines.length > 0) {
      column.tabIndex = 0;
      column.setAttribute("aria-label", spoken.join("; "));
      column.append(bars, tip);
      if (entries.length > 0) {
        Object.assign(column.dataset, data); // kliknutí = filtr tabulky na tento rok / měsíc
        column.setAttribute("role", "button");
      } else column.setAttribute("role", "img");
    } else if (ghost > 0) column.appendChild(bars);
    plot.appendChild(column);
    names.appendChild(ownedEl("span", "", name));
  });
  chart.append(plot, names);
  return chart;
}

// Roční graf, poznámka pod ním (co se počítá, případně kurz přepočtu) a tabulka týchž čísel
function renderOwnedSpending(orders, rows) {
  const block = document.getElementById("ownedSpending");
  const spending = getOwnedSpending(orders, rows);
  block.hidden = spending.length === 0;
  ownedScale = null;
  if (spending.length === 0) return;

  const domains = Object.keys(AlzaCore.domains).filter((domain) => spending.some((entry) => entry.domain === domain));
  const sumOf = (domain) => spending.filter((entry) => entry.domain === domain).reduce((sum, entry) => sum + ownedInCrowns(entry), 0);
  const base = domains.reduce((best, domain) => (sumOf(domain) > sumOf(best) ? domain : best), domains[0]);
  ownedScale = { domains, base, height: (entry) => ownedInCrowns(entry) / OWNED_RATES[ownedCurrency(base)] };

  const first = Math.min(...spending.map((entry) => entry.year));
  const last = Math.max(...spending.map((entry) => entry.year));
  const columns = Array.from({ length: last - first + 1 }, (_, index) => {
    const year = first + index;
    return {
      name: last - first + 1 > OWNED_CHART_SHORT_YEARS ? `'${String(year).slice(2)}` : String(year),
      title: String(year),
      entries: domains.map((domain) => spending.find((entry) => entry.year === year && entry.domain === domain)).filter(Boolean),
      lines: getOwnedChanges(year),
      data: { year: String(year) },
    };
  });
  let legend = null;
  if (domains.length > 1) {
    legend = ownedEl("div", "owned-chart-legend");
    domains.forEach((domain) => legend.appendChild(ownedEl("span", "owned-chart-key")).append(ownedSwatch(domain), ownedDomainName(domain)));
  }
  document.getElementById("ownedSpendingChart").replaceChildren(buildOwnedChart(columns, { label: t("ownedSpendingChart"), legend }));

  const notes = [t("ownedSpendingNote")];
  const foreign = domains.map(ownedCurrency).filter((currency) => currency !== ownedCurrency(base));
  if (foreign.length > 0) {
    const compact = new Intl.NumberFormat(ui.locale, { notation: "compact", maximumFractionDigits: 1 });
    const rate = (currency) => OWNED_RATES[currency] / OWNED_RATES[ownedCurrency(base)];
    // Čitelný směr kurzu: „1 € ≈ 25 Kč“, ne „1 Kč ≈ 0,04 €“
    const text = (currency) => (rate(currency) >= 1 ? `1 ${currency} ≈ ${compact.format(rate(currency))} ${ownedCurrency(base)}` : `1 ${ownedCurrency(base)} ≈ ${compact.format(1 / rate(currency))} ${currency}`);
    notes.push(t("ownedSpendingRate", [...new Set(foreign)].map(text).join(", ")));
  }
  document.getElementById("ownedSpendingNote").textContent = notes.join(" ");

  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  ["colOwnedYear", "colDomain", "colOwnedOrders", "colOwnedReturned", "colOwnedSpent"].forEach((label) => head.appendChild(Object.assign(document.createElement("th"), { textContent: t(label) })));
  const body = table.createTBody();
  spending
    .sort((a, b) => b.year - a.year || a.domain.localeCompare(b.domain))
    .forEach(({ year, domain, count, total, returned }) => {
      const row = body.insertRow();
      cell(row, String(year));
      cell(row, domain.replace("alza_", "."));
      cell(row, String(count));
      cell(row, returned > 0 ? AlzaCore.formatPrice(returned, domain) : "–");
      cell(row, AlzaCore.formatPrice(total, domain));
    });
  document.getElementById("ownedSpendingTable").replaceChildren(table);
}

// Graf měsíců vybraného roku (pod ročním): sloupec = měsíc, šedě vedle stejný měsíc o rok dřív; bublina přidá
// meziměsíční a meziroční změnu, kliknutí vybere měsíc. Staví se jen při změně roku nebo dat (ownedMonthsYear),
// aby výběr měsíce graf nepřekreslil a sloupec neztratil zaměření z klávesnice
let ownedMonthsYear = null;
function renderOwnedMonths(year) {
  const box = document.getElementById("ownedMonthsChart");
  if (!year || !ownedScale) {
    box.replaceChildren();
    ownedMonthsYear = null;
    return;
  }
  if (ownedMonthsYear === year) return;
  ownedMonthsYear = year;
  const monthOf = (time) => new Date(time).getMonth();
  const inYear = (wanted) => (time) => new Date(time).getFullYear() === wanted;
  const spending = getOwnedSpending(ownedOrders, ownedRows, inYear(year), monthOf);
  const before = getOwnedSpending(ownedOrders, ownedRows, inYear(year - 1), monthOf);
  const now = Date.now();
  const columns = Array.from({ length: 12 }, (_, month) => ({
    name: new Date(year, month, 1).toLocaleString(ui.locale, { month: "short" }),
    title: new Date(year, month, 1).toLocaleString(ui.locale, { month: "long", year: "numeric" }),
    entries: ownedScale.domains.map((domain) => spending.find((entry) => entry.year === month && entry.domain === domain)).filter(Boolean),
    ghost: before.filter((entry) => entry.year === month).reduce((sum, entry) => sum + ownedScale.height(entry), 0),
    lines: ownedRange(year, month).from <= now ? getOwnedChanges(year, month) : [], // měsíc, který ještě nezačal, se nesrovnává
    data: { month: String(month) },
  }));
  const legend = ownedEl("div", "owned-chart-legend");
  legend.appendChild(ownedEl("strong", "owned-chart-title", t("ownedMonthsTitle", year)));
  if (columns.some((column) => column.ghost > 0)) {
    if (ownedScale.domains.length === 1) legend.appendChild(ownedEl("span", "owned-chart-key")).append(ownedSwatch(ownedScale.base), String(year));
    legend.appendChild(ownedEl("span", "owned-chart-key")).append(ownedEl("i", "owned-chart-swatch owned-chart-swatch--ghost"), String(year - 1));
  }
  box.replaceChildren(buildOwnedChart(columns, { label: t("ownedMonthsTitle", year), legend, className: "owned-chart--months" }));
}

async function renderOwned() {
  const settings = await AlzaCore.getSettings();
  const { rows, products, orders, sync, pending, warrantyPending } = await loadOwned();
  ownedRows = rows;
  ownedOrders = orders;
  renderOwnedPeriodOptions();
  setTabCount("countOwned", products);

  // Vypnuto: výzva k zapnutí; načtená data zůstávají vidět a jdou smazat
  document.getElementById("ownedOff").hidden = settings.ownedItems;
  document.getElementById("ownedDelete").hidden = rows.length === 0;
  document.getElementById("ownedControls").hidden = !settings.ownedItems && rows.length === 0;
  ownedSyncButton.hidden = !settings.ownedItems;
  ownedSyncButton.disabled = ownedSyncing;

  const states = Object.values(sync).filter(ownedIsObject);
  const parts = [];
  if (rows.length > 0) parts.push(t("ownedSummary", products, rows.length));
  const unfinished = states.find((state) => !state.done && state.total > 0);
  if (unfinished) parts.push(t("ownedStatusLoading", unfinished.offset || 0, unfinished.total));
  if (pending > 0) parts.push(t("ownedStatusDetails", pending));
  if (warrantyPending > 0) parts.push(t("ownedStatusWarranties", warrantyPending));
  const last = Math.max(0, ...states.map((state) => Number(state.at) || 0));
  if (last > 0) parts.push(t("ownedStatusAt", new Date(last).toLocaleString(ui.locale, { dateStyle: "short", timeStyle: "short" })));
  document.getElementById("ownedSummary").textContent = parts.join(" · ");

  renderOwnedSpending(orders, rows);
  ownedMonthsYear = null; // nová data nebo jazyk – graf měsíců postavit znovu
  renderOwnedTable();
}

// Graf výdajů jde sbalit; volba se pamatuje jen v tomto prohlížeči (localStorage může být nedostupné – pak zůstane rozbalený)
const ownedSpendingBlock = document.getElementById("ownedSpending");
try {
  ownedSpendingBlock.open = localStorage.getItem(OWNED_SPENDING_OPEN_KEY) !== "0";
} catch {
  // Bez úložiště zůstane rozbalený
}
ownedSpendingBlock.addEventListener("toggle", () => {
  try {
    localStorage.setItem(OWNED_SPENDING_OPEN_KEY, ownedSpendingBlock.open ? "1" : "0");
  } catch {
    // Volba se jen nezapamatuje
  }
});

// Načtení hned (služba na pozadí): archiv objednávek a detaily po dávkách, dokud nějaké zbývají a přibývají
// (nejvýš OWNED_SYNC_ROUNDS dávek na kliknutí); průběh je vidět v souhrnu nad tabulkou
async function syncOwnedNow() {
  if (ownedSyncing) return;
  ownedSyncing = true;
  ownedSyncButton.disabled = true;
  setText(ownedInfo, "ownedSyncing");
  // Která Alza selhala (alza.sk: HTTP 403); chyba bez domény = celé načtení
  const ownedHost = (domain) => (isKnownDomain(domain) ? new URL(AlzaCore.domains[domain].origin).hostname.replace(/^www\./, "") : domain);
  const describeFailure = ({ domain, error }) => (domain ? `${ownedHost(domain)}: ${error}` : error);
  try {
    let added = 0;
    let warranties = 0; // Zjištěné délky záruky (API produktu) – ať je vidět, že kliknutí něco udělalo, i bez nových nákupů
    let failure = null; // Jedna Alza se nenačetla, jiná ano – řekne se to na konci
    for (let round = 0; round < OWNED_SYNC_ROUNDS; round++) {
      // Odpověď čte OptionsData.readOwnedSync: nepřihlášen jen tehdy, když to Alza opravdu řekla – vypnutá volba,
      // chybějící odpověď (ukončená služba na pozadí) a chyba načtení mají vlastní hlášku; samé „nic k načtení“
      // (skipped) = hotovo
      const reply = OptionsData.readOwnedSync(await chrome.runtime.sendMessage({ action: "ownedSync" }));
      if (reply.state === "error") {
        setText(ownedInfo, "ownedSyncFailed", describeFailure(reply));
        return;
      }
      if (reply.state !== "synced") {
        setText(ownedInfo, { off: "ownedSyncOff", noLogin: "ownedNoLogin" }[reply.state] || "ownedSyncRetry");
        return;
      }
      failure = reply.failure || failure;
      added += reply.synced.reduce((sum, domain) => sum + (Number(domain.added) || 0), 0);
      warranties += reply.synced.reduce((sum, domain) => sum + (Number(domain.warranties) || 0), 0);
      // Alza načítání odmítla (403 / 429, chyby za sebou) – další kolo by ji jen dál zatěžovalo
      if (reply.blocked) {
        setText(ownedInfo, "ownedSyncBlocked", added);
        return;
      }
      const more = reply.synced.some((domain) => (domain.pending > 0 && (domain.details > 0 || domain.warranties > 0)) || (!domain.done && domain.added > 0));
      if (!more) break;
      await renderOwned();
    }
    if (failure) setText(ownedInfo, "ownedSyncPartial", added, describeFailure(failure));
    else if (warranties > 0) setText(ownedInfo, "ownedSyncDoneWarranties", added, warranties);
    else setText(ownedInfo, "ownedSyncDone", added);
  } catch (error) {
    setText(ownedInfo, "ownedSyncFailed", error?.message || error);
  } finally {
    ownedSyncing = false;
    await renderOwned();
  }
}

ownedSyncButton.addEventListener("click", () => syncOwnedNow());

// Zapnutí přes políčko nastavení (uloží se stejně jako ruční přepnutí); načtení spustí posluchač změny nastavení
document.getElementById("ownedEnable").addEventListener("click", () => {
  form.ownedItems.checked = true;
  saveSettings(form.ownedItems).catch((error) => showActionError(error));
});

document.getElementById("ownedDelete").addEventListener("click", async () => {
  if (!confirm(t("ownedDeleteConfirm"))) return;
  await AlzaStore.run({ type: "remove", keys: [OWNED_KEY, OWNED_ORDERS_KEY, OWNED_SYNC_KEY] });
});

const renderOwnedFirstPage = () => {
  ownedView.page = 0;
  renderOwnedTable();
};
ownedSearch.addEventListener("input", renderOwnedFirstPage);
ownedFilter.addEventListener("change", renderOwnedFirstPage);
ownedMonth.addEventListener("change", renderOwnedFirstPage);
// Rok: měsíc jde vybrat jen s rokem; změna roku měsíc ruší
const selectOwnedYear = (year) => {
  ownedYear.value = year;
  ownedMonth.value = "";
  ownedMonth.disabled = ownedYear.value === "";
  renderOwnedFirstPage();
};
ownedYear.addEventListener("change", () => selectOwnedYear(ownedYear.value));
// Sloupec grafu vybere svůj rok (roční graf) nebo měsíc (graf měsíců), druhé kliknutí výběr zruší (myš i Enter / mezerník)
const toggleOwnedChartPeriod = (event) => {
  const column = event.target.closest(".owned-chart-col[data-year], .owned-chart-col[data-month]");
  if (!column || (event.type === "keydown" && event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  if (column.dataset.month === undefined) selectOwnedYear(ownedYear.value === column.dataset.year ? "" : column.dataset.year);
  else {
    ownedMonth.value = ownedMonth.value === column.dataset.month ? "" : column.dataset.month;
    renderOwnedFirstPage();
  }
};
["ownedSpendingChart", "ownedMonthsChart"].forEach((id) => {
  document.getElementById(id).addEventListener("click", toggleOwnedChartPeriod);
  document.getElementById(id).addEventListener("keydown", toggleOwnedChartPeriod);
});

// Data se mění i na pozadí (další detaily objednávek) – překreslit; zapnutí volby = hned načíst
let ownedRenderTimeout = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const settingsChange = changes[AlzaCore.storageKeys.settings];
  const turnedOn = settingsChange && !settingsChange.oldValue?.ownedItems && settingsChange.newValue?.ownedItems;
  if (turnedOn) syncOwnedNow().catch((error) => console.error("Koupené zboží se nepodařilo načíst:", error));
  if (!settingsChange && !changes[OWNED_KEY] && !changes[OWNED_SYNC_KEY]) return;
  clearTimeout(ownedRenderTimeout);
  ownedRenderTimeout = setTimeout(() => renderOwned().catch((error) => console.error("Moje nákupy se nepodařilo vykreslit:", error)), 300);
});

renderOwned().catch((error) => console.error("Moje nákupy se nepodařilo načíst:", error));
