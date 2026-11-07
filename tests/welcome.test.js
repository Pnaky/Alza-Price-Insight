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
