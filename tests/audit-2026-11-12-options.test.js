// Audit 2026-11-12, stránka nastavení: rozsahy čísel při importu zálohy, začernění hlášení chyby a souboru
// diagnostiky (koupené zboží), odpověď na načtení Mých nákupů, pole formuláře ↔ AlzaCore.defaultSettings, párování
// záložek s panely a pravidlo [hidden] ve společném stylu.
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadCore } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const html = read("src/options/options.html");
const script = read("src/options/options.js");

function loadOptionsData() {
  const { AlzaCore, context } = loadCore({ files: ["src/options/options-backup.js"] });
  return { AlzaCore, data: context.OptionsData };
}
// Objekty z izolovaného kontextu mají jiný prototyp – porovnávat jako prostá data
const plain = (value) => JSON.parse(JSON.stringify(value));
const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const settingsForm = html.match(/<form id="settings">([\s\S]*?)<\/form>/)[1];

// === Import zálohy: nastavení ===

test("import nastavení: číslo mimo rozsah formuláře se nepřevezme, celá čísla se zaokrouhlí", () => {
  const { data } = loadOptionsData();
  const clean = (settings) => plain(data.sanitizeSettings(settings));
  assert.deepEqual(clean({ energyYears: 500, energyHoursPerDay: 0, energyCyclesPerWeek: 22, energyPriceCZK: 0, minDropPercent: 100 }), {});
  assert.deepEqual(clean({ energyYears: -1, energyPriceEUR: 100000, energyPriceHUF: Infinity, minDropPercent: -5, energyHoursPerDay: 24.5 }), {});
  assert.deepEqual(clean({ energyYears: 30, energyHoursPerDay: 0.5, energyCyclesPerWeek: 1, energyPriceCZK: 0.01, energyPriceEUR: 99999, minDropPercent: 99 }), {
    energyYears: 30,
    energyHoursPerDay: 0.5,
    energyCyclesPerWeek: 1,
    energyPriceCZK: 0.01,
    energyPriceEUR: 99999,
    minDropPercent: 99,
  });
  // Formulář celá čísla zaokrouhluje (roky, praní týdně, procenta); cena a hodiny zůstávají desetinné
  assert.deepEqual(clean({ energyYears: 9.6, energyCyclesPerWeek: 3.4, minDropPercent: 12.5, energyHoursPerDay: 3.25, energyPriceEUR: 0.257 }), {
    energyYears: 10,
    energyCyclesPerWeek: 3,
    minDropPercent: 13,
    energyHoursPerDay: 3.25,
    energyPriceEUR: 0.257,
  });
  assert.deepEqual(clean({ energyYears: 30.6 }), {}, "po zaokrouhlení mimo rozsah");
});

test("import nastavení: jen známé volby ve správném typu a s platnou hodnotou", () => {
  const { data } = loadOptionsData();
  const clean = (settings) => plain(data.sanitizeSettings(settings));
  assert.deepEqual(
    clean({
      notifyDrops: "yes",
      energyYears: "10",
      notifyAvailability: "sometimes",
      uiLanguage: "de",
      primaryDomain: "alza_at",
      quietFrom: "25:00",
      checkSchedule: "5m",
      unknown: 1,
      ["__proto__"]: { polluted: true },
    }),
    {}
  );
  const valid = { notifyDrops: false, notifyAvailability: "inStock", uiLanguage: "hu", primaryDomain: "alza_sk", quietFrom: "23:30", checkSchedule: "daily", ownedItems: true };
  assert.deepEqual(clean(valid), valid);
});

test("import nastavení: rozsahy jsou stejné jako min / max políček formuláře a žádné číselné nastavení nechybí", () => {
  const { AlzaCore, data } = loadOptionsData();
  const ranges = plain(data.SETTING_RANGES);
  const inputs = [...settingsForm.matchAll(/<input\b[^>]*type="number"[^>]*>/g)].map(([tag]) => tag);
  assert.ok(inputs.length >= 5, "formulář má číselná políčka");
  const seen = new Set();
  inputs.forEach((tag) => {
    // Cena elektřiny: jedno políčko (id) pro tři nastavení podle měny
    const keys = attribute(tag, "id") === "energyPrice" ? Object.values(AlzaCore.energyPriceKeys) : [attribute(tag, "name")];
    keys.forEach((key) => {
      seen.add(key);
      assert.ok(ranges[key], `${key} má rozsah v SETTING_RANGES`);
      assert.equal(ranges[key].min, Number(attribute(tag, "min")), `${key} min`);
      assert.equal(ranges[key].max, Number(attribute(tag, "max")), `${key} max`);
      assert.equal(Boolean(ranges[key].integer), attribute(tag, "step") === "1", `${key}: celé číslo = step 1`);
    });
  });
  assert.deepEqual([...seen].sort(), Object.keys(ranges).sort(), "každý rozsah má políčko");
  Object.entries(AlzaCore.defaultSettings)
    .filter(([, value]) => typeof value === "number")
    .forEach(([key, value]) => {
      assert.ok(ranges[key], `číselné nastavení ${key} má rozsah`);
      assert.equal(data.sanitizeSettings({ [key]: value })[key], value, `výchozí ${key} je v rozsahu`);
    });
});

// === Formulář nastavení ↔ AlzaCore.defaultSettings ===

test("formulář nastavení: každé pole je nastavení, načítá se i ukládá – a každé nastavení má pole", () => {
  const { AlzaCore } = loadCore();
  const names = [...settingsForm.matchAll(/<(?:input|select)\b[^>]*\sname="([^"]+)"/g)].map(([, name]) => name);
  assert.ok(names.length >= 20, "formulář má pole");
  assert.equal(new Set(names).size, names.length, "žádné pole dvakrát");
  const body = (name) => script.match(new RegExp(`async function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}\\n`))[1];
  const load = body("loadSettings");
  const save = body("saveSettings");
  names.forEach((name) => {
    assert.ok(Object.hasOwn(AlzaCore.defaultSettings, name), `pole ${name} není v AlzaCore.defaultSettings`);
    assert.match(load, new RegExp(`\\bform\\.${name}\\.(?:checked|value) = settings\\.${name}\\b|\\bform\\.${name}\\.value = [^;]*settings\\.${name}\\b`), `loadSettings nenačítá ${name}`);
    assert.match(save, new RegExp(`\\bform\\.${name}\\b`), `saveSettings neukládá ${name}`);
  });
  // Cena elektřiny nemá name v HTML – políčko #energyPrice dostane název nastavení podle měny hlavní Alzy
  assert.match(settingsForm, /<input\b[^>]*id="energyPrice"/);
  assert.match(load, /updateEnergyField\(settings\)/);
  assert.match(save, /settings\[energyPriceInput\.name\] = energyPrice/);
  const fields = new Set([...names, ...Object.values(AlzaCore.energyPriceKeys)]);
  Object.keys(AlzaCore.defaultSettings).forEach((key) => assert.ok(fields.has(key), `nastavení ${key} nemá pole ve formuláři`));
});

// === Záložky ===

const tabButtons = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map(([tag]) => tag);
const tabPanels = [...html.matchAll(/<section\b[^>]*role="tabpanel"[^>]*>/g)].map(([tag]) => tag);
const scriptList = (name) => [...script.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))[1].matchAll(/"([^"]+)"/g)].map(([, item]) => item);

test("záložky: každé tlačítko má svůj panel a naopak (aria-controls ↔ aria-labelledby)", () => {
  assert.equal(tabButtons.length, 9, "4 záložky nastavení + 5 záložek dat");
  assert.equal(tabPanels.length, tabButtons.length, "stejně panelů jako záložek");
  const panelsById = new Map(tabPanels.map((tag) => [attribute(tag, "id"), tag]));
  const buttonsById = new Map(tabButtons.map((tag) => [attribute(tag, "id"), tag]));
  tabButtons.forEach((tag) => {
    const name = attribute(tag, "data-settings-tab") ?? attribute(tag, "data-tab");
    const panelId = attribute(tag, "data-settings-tab") ? `settings-${name}` : `tab-${name}`;
    assert.ok(name, `${tag} – data-settings-tab / data-tab`);
    assert.equal(attribute(tag, "aria-controls"), panelId, `${name}: aria-controls`);
    assert.equal(attribute(tag, "id"), `${panelId}-button`, `${name}: id tlačítka`);
    assert.equal(attribute(tag, "type"), "button", `${name}: type="button" (jinak odešle formulář)`);
    const panel = panelsById.get(panelId);
    assert.ok(panel, `panel #${panelId} existuje`);
    assert.equal(attribute(panel, "aria-labelledby"), attribute(tag, "id"), `#${panelId}: aria-labelledby`);
  });
  tabPanels.forEach((tag) => assert.ok(buttonsById.has(attribute(tag, "aria-labelledby")), `panel #${attribute(tag, "id")} má záložku`));
  // Právě jeden panel z každé skupiny je vidět už v HTML (první), ostatní mají hidden
  ["settings-", "tab-"].forEach((prefix) => {
    const group = tabPanels.filter((tag) => attribute(tag, "id").startsWith(prefix));
    assert.deepEqual(group.map((tag) => /\shidden[\s>]/.test(tag)), group.map((_, index) => index > 0), `${prefix}*`);
  });
});

test("záložky: seznamy v options.js odpovídají záložkám v HTML", () => {
  const names = (attributeName) => tabButtons.map((tag) => attribute(tag, attributeName)).filter(Boolean);
  assert.deepEqual(scriptList("SETTINGS_TABS"), names("data-settings-tab"));
  assert.deepEqual(scriptList("TABS"), names("data-tab"));
  // Přímý odkaz #s-<záložka nastavení> se nesmí srazit se záložkou dat (#lists…) ani s kotvou #cleanup z popupu
  const prefix = script.match(/const SETTINGS_HASH_PREFIX = "([^"]+)"/)[1];
  [...scriptList("TABS"), "cleanup"].forEach((tab) => assert.ok(!tab.startsWith(prefix), `#${tab} vs. #${prefix}…`));
});

test("záložky: řada záložek má název a obsahuje jen záložky (stav „Uloženo“ je mimo ni)", () => {
  const lists = [...html.matchAll(/<(\w+)\b([^>]*role="tablist"[^>]*)>([\s\S]*?)<\/\1>/g)];
  assert.equal(lists.length, 2);
  let buttons = 0;
  lists.forEach(([, , attributes, content]) => {
    assert.match(attributes, /\sdata-i18n-label="\w+"/, "název řady záložek (aria-label z překladu)");
    assert.doesNotMatch(content, /role="status"/, "role=status do tablist nepatří");
    const children = [...content.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
    children.forEach((tag) => assert.match(tag, /role="tab"/));
    buttons += children.length;
  });
  assert.equal(buttons, tabButtons.length, "každá záložka je v řadě záložek");
  assert.equal([...html.matchAll(/data-saved\b[^>]*role="status"|role="status"[^>]*data-saved\b/g)].length, 1, "stav uložení na stránce zůstal");
});

test("stránka nastavení: žádné id není dvakrát", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
  // Kotvy záložek (#lists, #s-general…) nesmí být id prvku – prohlížeč by po načtení odskočil
  const anchors = [...scriptList("TABS"), "cleanup", ...scriptList("SETTINGS_TABS").map((tab) => `s-${tab}`)];
  anchors.forEach((anchor) => assert.ok(!ids.includes(anchor), `id="${anchor}" je kotva záložky`));
});

test("společný styl: atribut hidden skryje i prvek s vlastním display", () => {
  assert.match(read("src/shared/page.css"), /(^|\})\s*(\/\*[\s\S]*?\*\/\s*)?\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.match(html, /<link rel="stylesheet" href="\.\.\/shared\/page\.css"/);
  // Ovládání Mých nákupů je řada tlačítek (display: flex) schovávaná atributem hidden
  assert.match(html, /<div class="buttons" id="ownedControls">/);
  assert.match(read("src/options/options-owned.js"), /getElementById\("ownedControls"\)\.hidden = /);
});

// === Hlášení chyby a diagnostika ===

test("hlášení chyby: začerní i názvy z Mých nákupů a čte je z úložiště", () => {
  const { AlzaCore, data } = loadOptionsData();
  const keys = AlzaCore.storageKeys;
  const sensitive = data.getSensitiveTexts({
    [keys.owned]: {
      alza_cz_1: { url: "https://www.alza.cz/x-d1.htm", domain: "alza_cz", name: "Masážní pistole Z", brand: "Značka", buys: [{ t: 1, n: 1, o: "123" }] },
      alza_cz_2: { name: null },
      broken: "x",
    },
    [keys.purchases]: { alza_cz_3: { name: "Robotický vysavač X" } },
  });
  assert.deepEqual(plain(sensitive).sort(), ["Masážní pistole Z", "Robotický vysavač X"]);
  assert.equal(data.redactForReport("Chyba u Masážní pistole Z při načtení", sensitive), "Chyba u … při načtení");
  [keys.codes, keys.purchases, keys.cashbackReminders, keys.owned].forEach((key) => assert.ok(data.SENSITIVE_KEYS.includes(key), key));
  assert.match(script, /chrome\.storage\.local\.get\(\[ERROR_LOG_KEY, \.\.\.OptionsData\.SENSITIVE_KEYS\]\)/, "hlášení chyby načítá všechny citlivé klíče");
});

test("diagnostika: nové nákupy jen počtem, produkt hlídaný jen kvůli nákupu beze jména a adresy", () => {
  const { data } = loadOptionsData();
  const secretUrl = "https://www.alza.cz/tajny-darek-d111.htm";
  const input = {
    watchLog: [
      {
        start: 1,
        end: 2,
        total: 3,
        items: [
          { name: "Tajný dárek", url: secretUrl, lines: ["Tajný dárek: koupili jste za 916 Kč, teď stojí 800 Kč"], problem: null, purchaseOnly: true },
          { name: "Hlídaný kabel", url: "https://www.alza.cz/kabel-d222.htm", lines: ["zlevnění o 10 %"], problem: null },
          {
            name: "Tajná pračka",
            url: "https://www.alza.sk/pracka-d333.htm",
            lines: [],
            problem: "Stránku https://www.alza.sk/pracka-d333.htm (Tajná pračka) se nepodařilo načíst",
            purchaseOnly: true,
          },
        ],
        lists: [
          { name: "Moje objednávky", url: "https://www.alza.cz/my-account/orders.htm", orders: true, added: ["Tajný dárek"], addedCount: 1, removed: [], removedCount: 0 },
          { name: "Vánoce", url: "https://www.alza.cz/muj-ucet/nakupni-seznam.htm?id=5", added: ["Hlídaný kabel"], addedCount: 1, removed: [], removedCount: 0 },
          { name: "Moje objednávky", url: "https://www.alza.sk/my-account/orders.htm", problem: "HTTP 403", orders: true },
        ],
      },
      { start: 3, end: 4, total: 0 },
      "rozbitý záznam",
    ],
    watchState: {
      running: false,
      lastRunEnd: 2,
      changes: [
        { name: "Tajný dárek", url: secretUrl, lines: ["Tajný dárek zlevnil"] },
        { name: "Hlídaný kabel", url: "https://www.alza.cz/kabel-d222.htm", lines: ["zlevnění"] },
      ],
      // Stejný produkt s jinak zapsanou adresou – pozná se podle čísla produktu
      recent: [{ key: "alza_cz_111", at: 2, name: "Tajný dárek", url: "https://www.alza.cz/jiny-zapis-d111.htm?kampan=1", image: "https://image.alza.cz/tajny.jpg", lines: [] }],
      unseen: ["alza_cz_111", "alza_cz_222"],
      problems: [],
    },
    errors: [
      { t: 5, source: "www.alza.cz/my-account/order-details-123456789.htm", version: "1", message: "Chyba na https://www.alza.cz/my-account/order-details-123456789.htm" },
      "rozbitý záznam",
      { t: 6, source: "background", version: "1", message: "Kód SLEVA20 u Tajná sušička selhal na https://www.alza.cz/kabel-d222.htm" },
    ],
    // Slevové kódy a názvy koupeného zboží (getSensitiveTexts) – z textu chyb pryč
    sensitive: ["SLEVA20", "Tajná sušička"],
  };
  const original = JSON.stringify(input);
  const result = plain(data.redactDiagnostics(input));
  assert.equal(JSON.stringify(input), original, "vstup zůstal beze změny");

  const text = JSON.stringify(result);
  ["Tajný", "Tajná", "d111", "d333", "tajny.jpg", "123456789", "SLEVA20"].forEach((secret) => assert.ok(!text.includes(secret), `v diagnostice zůstalo „${secret}“`));
  assert.ok(text.includes("Hlídaný kabel") && text.includes("kabel-d222"), "hlídané produkty zůstávají");

  const [run, empty] = result.watchLog;
  assert.equal(result.watchLog.length, 2, "rozbitý záznam běhu se zahodí");
  assert.deepEqual(empty, { start: 3, end: 4, total: 0 });
  assert.deepEqual(run.items[0], { name: "(koupené zboží)", url: "(skryto)", lines: ["…: koupili jste za 916 Kč, teď stojí 800 Kč"], problem: null, purchaseOnly: true });
  assert.equal(run.items[2].problem, "Stránku … (…) se nepodařilo načíst");
  assert.deepEqual(run.lists[0], { name: "Moje objednávky", url: "https://www.alza.cz/my-account/orders.htm", orders: true, addedCount: 1, removedCount: 0 });
  assert.deepEqual(run.lists[1].added, ["Hlídaný kabel"], "obsah hlídaných seznamů zůstává");
  assert.equal(run.lists[2].problem, "HTTP 403");

  assert.deepEqual(result.watchState.changes[0], { name: "(koupené zboží)", url: "(skryto)", lines: ["… zlevnil"] });
  assert.deepEqual(result.watchState.recent[0], { key: "(skryto)", at: 2, name: "(koupené zboží)", url: "(skryto)", image: null, lines: [] });
  assert.deepEqual(result.watchState.unseen, ["(skryto)", "alza_cz_222"]);
  assert.equal(result.watchState.lastRunEnd, 2);
  assert.equal(result.errors[0].source, "www.alza.cz/my-account/order-details-….htm");
  assert.equal(result.errors[1], "rozbitý záznam");
  assert.equal(result.errors[2].message, "Kód … u … selhal na https://www.alza.cz/kabel-d222.htm", "adresa v chybě zůstává (podle ní se chyba hledá)");

  // Prázdné úložiště
  assert.deepEqual(plain(data.redactDiagnostics({})), { watchLog: [], watchState: null, errors: [] });
  assert.match(script, /OptionsData\.redactDiagnostics\(/, "soubor diagnostiky prochází začerněním");
});

// === Moje nákupy: odpověď služby na pozadí ===

test("Moje nákupy: nepřihlášen jen tehdy, když to řekla Alza – vypnuto, bez odpovědi a chyba mají vlastní stav", () => {
  const { data } = loadOptionsData();
  const state = (result) => plain(data.readOwnedSync(result));
  const synced = { status: "synced", added: 2, details: 1, pending: 0, done: true, total: 5 };
  const noLogin = { status: "noLogin", added: 0, details: 0, pending: 0, done: false, total: null };
  const skipped = { status: "skipped", added: 0, details: 0, pending: 0, done: true, total: 5 };

  // Ukončená služba na pozadí neodpoví vůbec
  [undefined, null, "", []].forEach((reply) => assert.deepEqual(state(reply), { state: "noReply" }));
  assert.deepEqual(state({ status: "off", domains: {} }), { state: "off" });
  assert.deepEqual(state({ status: "error", error: "výpadek", domains: {} }), { state: "error", domain: null, error: "výpadek" });
  assert.deepEqual(state({ status: "done", domains: { alza_cz: noLogin, alza_sk: noLogin, alza_hu: noLogin } }), { state: "noLogin" });
  // Chyba domény není „nepřihlášen“
  assert.deepEqual(state({ status: "done", domains: { alza_cz: { status: "error", error: "HTTP 403" }, alza_sk: noLogin } }), {
    state: "error",
    domain: "alza_cz",
    error: "HTTP 403",
  });
  // Odpověď bez domén
  assert.deepEqual(state({ status: "done" }), { state: "retry" });
  // Samé „nic k načtení“ = vše načteno; přeskočená Alza vedle nepřihlášené není „nepřihlášen“
  assert.deepEqual(state({ status: "done", domains: { alza_cz: skipped } }), { state: "synced", synced: [], failure: null, blocked: null });
  assert.deepEqual(state({ status: "done", domains: { alza_cz: skipped, alza_sk: noLogin } }), { state: "synced", synced: [], failure: null, blocked: null });
  assert.deepEqual(state({ status: "done", domains: { alza_cz: skipped, alza_sk: { status: "error", error: "HTTP 500" } } }), {
    state: "synced",
    synced: [],
    failure: { domain: "alza_sk", error: "HTTP 500" },
    blocked: null,
  });
  assert.deepEqual(state({ status: "done", domains: { alza_cz: synced, alza_sk: noLogin } }), { state: "synced", synced: [synced], failure: null, blocked: null });
  assert.deepEqual(state({ status: "done", domains: { alza_cz: synced, alza_hu: { status: "error", error: "HTTP 500" } } }), {
    state: "synced",
    synced: [synced],
    failure: { domain: "alza_hu", error: "HTTP 500" },
    blocked: null,
  });
  // Alza načítání odmítla (jistič) – stránka nepokračuje dalším kolem
  const blocked = { ...synced, blocked: true };
  assert.deepEqual(state({ status: "done", domains: { alza_cz: synced, alza_sk: blocked } }), { state: "synced", synced: [synced, blocked], failure: null, blocked: "alza_sk" });
  // Volba vypnutá / nákupy smazané během načítání
  assert.deepEqual(state({ status: "done", domains: { alza_cz: synced, alza_sk: { status: "off", added: 1 } } }), { state: "off" });
  const owned = read("src/options/options-owned.js");
  assert.match(owned, /if \(reply\.blocked\) \{\s*setText\(ownedInfo, "ownedSyncBlocked", added\);\s*return;/, "po odmítnutí se další kolo nespustí");
});
