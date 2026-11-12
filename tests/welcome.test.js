// Průvodce nastavením (src/welcome/): překlady WELCOME_TEXTS mají ve všech jazycích stejné klíče a parametry
// jako čeština, každý klíč z welcome.html (data-w) a welcome.js (t("…")) ve slovníku je, nepoužitý žádný není,
// texty voleb převzaté ze stránky nastavení (data-o) v OPTIONS_TEXTS existují a políčka jsou skutečná nastavení.
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadCore } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
const LANGUAGES = ["cz", "sk", "hu", "en"];
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const context = vm.createContext({});
vm.runInContext(read("src/welcome/welcome-texts.js"), context);
vm.runInContext(read("src/options/options-texts.js"), context);
const TEXTS = vm.runInContext("WELCOME_TEXTS", context);
const OPTIONS = vm.runInContext("OPTIONS_TEXTS", context);
const html = read("src/welcome/welcome.html");
const script = read("src/welcome/welcome.js");

const placeholders = (text) => [...new Set(text.match(/\{\d+\}/g) || [])].sort();

test("průvodce: všechny jazyky mají stejné klíče a parametry jako čeština", () => {
  const reference = Object.keys(TEXTS.cz).sort();
  assert.deepEqual(Object.keys(TEXTS).sort(), [...LANGUAGES].sort());
  LANGUAGES.forEach((lang) => {
    assert.deepEqual(Object.keys(TEXTS[lang]).sort(), reference, `jazyk ${lang}`);
    Object.entries(TEXTS.cz).forEach(([key, czech]) => {
      assert.ok(TEXTS[lang][key].trim().length > 0, `${lang}.${key} je prázdný`);
      assert.deepEqual(placeholders(TEXTS[lang][key]), placeholders(czech), `${lang}.${key} – parametry`);
    });
  });
});

test("průvodce: klíče z welcome.html a welcome.js jsou ve slovníku a žádný není navíc", () => {
  const htmlKeys = [...html.matchAll(/\sdata-w="([^"]+)"/g)].map(([, key]) => key);
  const scriptKeys = [...script.matchAll(/\bt\(\s*"([^"]+)"/g)].map(([, key]) => key);
  assert.ok(htmlKeys.length > 20 && scriptKeys.length > 20);
  [...htmlKeys, ...scriptKeys].forEach((key) => assert.ok(Object.hasOwn(TEXTS.cz, key), `neznámý klíč ${key}`));
  // Použitý = v data-w nebo jako řetězec ve welcome.js (i v podmínce: t(x ? "a" : "b"))
  const unused = Object.keys(TEXTS.cz).filter((key) => !htmlKeys.includes(key) && !script.includes(`"${key}"`));
  assert.deepEqual(unused, []);
});

test("průvodce: texty voleb ze stránky nastavení (data-o) existují", () => {
  const keys = [...html.matchAll(/\sdata-o="([^"]+)"/g)].map(([, key]) => key);
  assert.ok(keys.length > 15);
  keys.forEach((key) => LANGUAGES.forEach((lang) => assert.ok(OPTIONS[lang][key], `OPTIONS_TEXTS.${lang}.${key}`)));
});

test("průvodce: každé políčko voleb je nastavení se stejným názvem", () => {
  const { AlzaCore } = loadCore();
  const names = [...html.matchAll(/<(?:input|select)\b[^>]*\sname="([^"]+)"/g)].map(([, name]) => name);
  assert.ok(names.length >= 10);
  names.forEach((name) => assert.ok(Object.hasOwn(AlzaCore.defaultSettings, name), `nastavení ${name}`));
});

// Volby nastavení, které v průvodci nejsou – podrobnosti výpočtu ceny provozu zůstávají jen v nastavení. Nová volba
// musí být v průvodci, nebo tady (s důvodem) – průvodce se tak s nastavením nerozejde
const NOT_IN_WIZARD = {
  energyYears: "podrobnost výpočtu ceny provozu – jen v nastavení",
  energyCyclesPerWeek: "podrobnost výpočtu ceny provozu – jen v nastavení",
  energyHoursPerDay: "podrobnost výpočtu ceny provozu – jen v nastavení",
};

test("průvodce: každá volba nastavení je v průvodci, nebo na seznamu výjimek", () => {
  const { AlzaCore } = loadCore();
  const names = new Set([...html.matchAll(/<(?:input|select)\b[^>]*\sname="([^"]+)"/g)].map(([, name]) => name));
  if (html.includes("data-energy-price")) Object.values(AlzaCore.energyPriceKeys).forEach((key) => names.add(key)); // Název podle měny
  if (html.includes('id="language"')) names.add("uiLanguage"); // Výběr jazyka v záhlaví
  if (html.includes("data-domain=")) names.add("primaryDomain"); // Výběr hlavní Alzy v kroku 1
  const missing = Object.keys(AlzaCore.defaultSettings).filter((key) => !names.has(key) && !Object.hasOwn(NOT_IN_WIZARD, key));
  assert.deepEqual(missing, []);
  Object.keys(NOT_IN_WIZARD).forEach((key) => assert.ok(Object.hasOwn(AlzaCore.defaultSettings, key), `výjimka ${key} není nastavení`));
});

test("novinky: vydání jsou seřazená, nové volby jsou nastavení s volbou v průvodci", () => {
  const { AlzaCore } = loadCore();
  assert.ok(AlzaCore.releases.length > 0);
  AlzaCore.releases.forEach(({ version, settings }, index) => {
    assert.match(version, /^\d{4}\.\d{1,2}\.\d{1,2}$/, `verze ${version}`);
    if (index > 0) assert.ok(AlzaCore.compareVersions(AlzaCore.releases[index - 1].version, version) > 0, `${version} není starší než předchozí`);
    settings.forEach((key) => {
      assert.ok(Object.hasOwn(AlzaCore.defaultSettings, key), `${version}: ${key} není nastavení`);
      assert.ok(html.includes(`data-setting="${key}"`), `${version}: ${key} nemá v průvodci volbu data-setting`);
    });
  });
});

test("novinky: odrážky má každé vydání ve všech jazycích ve stejném počtu", () => {
  const { AlzaCore } = loadCore();
  const NEWS = vm.runInContext("RELEASE_NEWS", context);
  assert.deepEqual(Object.keys(NEWS).sort(), [...AlzaCore.releases.map(({ version }) => version)].sort());
  Object.entries(NEWS).forEach(([version, texts]) => {
    assert.deepEqual(Object.keys(texts).sort(), [...LANGUAGES].sort(), version);
    LANGUAGES.forEach((lang) => {
      assert.equal(texts[lang].length, texts.cz.length, `${version} ${lang} – počet odrážek`);
      texts[lang].forEach((text) => assert.ok(typeof text === "string" && text.trim().length > 0, `${version} ${lang} – prázdná odrážka`));
    });
  });
});

test("novinky: porovnání verzí a neviděná vydání", () => {
  const { AlzaCore } = loadCore();
  assert.ok(AlzaCore.compareVersions("2026.11.12", "2026.11.9") > 0);
  assert.ok(AlzaCore.compareVersions("2026.11.12", "2026.11.12.1") < 0);
  assert.equal(AlzaCore.compareVersions("2026.11.12", "2026.11.12.0"), 0);
  assert.ok(AlzaCore.compareVersions("2027.1.1", "2026.12.31.9") > 0);
  const original = AlzaCore.releases;
  AlzaCore.releases = [
    { version: "2026.12.1", settings: [] },
    { version: "2026.11.12", settings: ["ownedItems"] },
    { version: "2026.11.9", settings: [] },
  ];
  try {
    const versions = (since, current) => [...AlzaCore.getReleaseNews(since, current)].map(({ version }) => version);
    assert.deepEqual(versions("2026.11.9", "2026.11.12"), ["2026.11.12"]); // Aktualizace z obchodu
    assert.deepEqual(versions("2026.11.9", "2026.11.12.2"), ["2026.11.12"]); // Vývojová verze téhož dne
    assert.deepEqual(versions("2026.11.12.1", "2026.11.12.2"), []); // Obnovení při vývoji – nic nového
    assert.deepEqual(versions("2026.11.7", "2026.12.1"), ["2026.12.1", "2026.11.12", "2026.11.9"]); // Přeskočené verze
    assert.deepEqual(versions("2026.12.1", "2026.12.1"), []);
    assert.deepEqual(versions(undefined, "2026.12.1"), []); // Neznámo odkud – nic
  } finally {
    AlzaCore.releases = original;
  }
});
