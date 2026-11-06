// Překlady stránky nastavení (src/options/options-texts.js): všechny jazyky mají stejné klíče a parametry
// jako čeština, každý klíč z options.html (data-i18n*) a options.js (t("…"), label: "…") ve slovníku je
// a české texty v HTML (zobrazené do spuštění skriptu) jsou stejné jako ve slovníku.
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const LANGUAGES = ["cz", "sk", "hu", "en"];
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const context = vm.createContext({});
vm.runInContext(read("src/options/options-texts.js"), context);
const TEXTS = vm.runInContext("OPTIONS_TEXTS", context);
const html = read("src/options/options.html");
const script = read("src/options/options.js");

const placeholders = (text) => [...new Set(text.match(/\{\d+\}/g) || [])].sort();
const normalize = (text) => text.replace(/\s+/g, " ").trim();
const decode = (text) => text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

test("nastavení: všechny jazyky mají stejné klíče jako čeština", () => {
  const reference = Object.keys(TEXTS.cz).sort();
  assert.deepEqual(Object.keys(TEXTS).sort(), [...LANGUAGES].sort());
  LANGUAGES.forEach((lang) => assert.deepEqual(Object.keys(TEXTS[lang]).sort(), reference, `jazyk ${lang}`));
});

test("nastavení: každý text je neprázdný a má stejné parametry {0}… jako čeština", () => {
  LANGUAGES.forEach((lang) =>
    Object.entries(TEXTS.cz).forEach(([key, czech]) => {
      const text = TEXTS[lang][key];
      assert.equal(typeof text, "string", `${lang}.${key}`);
      assert.ok(text.trim().length > 0, `${lang}.${key} je prázdný`);
      assert.deepEqual(placeholders(text), placeholders(czech), `${lang}.${key} – parametry`);
    })
  );
});

// Klíče z atributů data-i18n, data-i18n-title, data-i18n-tip, data-i18n-placeholder
const htmlKeys = () => [...html.matchAll(/\sdata-i18n(?:-title|-tip|-placeholder)?="([^"]+)"/g)].map(([, key]) => key);
// Klíče z t("…") a z popisků sloupců tabulek (label: "…")
const scriptKeys = () => [...script.matchAll(/\bt\(\s*"([^"]+)"|\blabel:\s*"([^"]+)"/g)].map(([, key, label]) => key || label);

test("nastavení: každý klíč z options.html je ve slovníku", () => {
  const keys = htmlKeys();
  assert.ok(keys.length > 40, "options.html používá data-i18n");
  keys.forEach((key) => assert.ok(Object.hasOwn(TEXTS.cz, key), `options.html: neznámý klíč ${key}`));
});

test("nastavení: každý klíč z options.js je ve slovníku", () => {
  const keys = scriptKeys();
  assert.ok(keys.length > 40, "options.js používá t()");
  keys.forEach((key) => assert.ok(Object.hasOwn(TEXTS.cz, key), `options.js: neznámý klíč ${key}`));
});

test("nastavení: ve slovníku nejsou nepoužité klíče", () => {
  // Použitý = v atributu HTML nebo jako řetězec v options.js (i v podmínce: t(x ? "a" : "b"))
  const used = new Set([...htmlKeys(), ...[...script.matchAll(/"([A-Za-z]\w*)"/g)].map(([, key]) => key)]);
  Object.keys(TEXTS.cz).forEach((key) => assert.ok(used.has(key), `nepoužitý klíč ${key}`));
});

test("nastavení: prvky s data-i18n obsahují jen text a čeština v HTML odpovídá slovníku", () => {
  const elements = [...html.matchAll(/<(\w+)\b([^>]*?)\sdata-i18n="([^"]+)"([^>]*)>([\s\S]*?)<\/\1\s*>/g)];
  assert.ok(elements.length > 40);
  elements.forEach(([, tag, , key, , content]) => {
    // textContent z překladu by vnořené prvky (bublina „?“, počet v záložce) smazal
    assert.ok(!content.includes("<"), `<${tag} data-i18n="${key}"> obsahuje vnořené prvky`);
    if (content.trim() && Object.hasOwn(TEXTS.cz, key)) assert.equal(normalize(decode(content)), normalize(TEXTS.cz[key]), `<${tag} data-i18n="${key}">`);
  });
  [...html.matchAll(/placeholder="([^"]*)"[^>]*data-i18n-placeholder="([^"]+)"/g)].forEach(([, text, key]) =>
    assert.equal(text, TEXTS.cz[key], `placeholder ${key}`)
  );
});

test("nastavení: bubliny „?“ berou text jen ze slovníku", () => {
  const tips = [...html.matchAll(/<span class="info"[^>]*>/g)].map(([tag]) => tag);
  assert.ok(tips.length >= 6);
  tips.forEach((tag) => {
    assert.match(tag, /data-i18n-tip="\w+"/, tag);
    assert.doesNotMatch(tag, /\sdata-tip=|aria-label=/, `${tag} – pevný text by přepsal překlad jen do spuštění skriptu`);
  });
});

test("nastavení: potvrzovací slovo smazání je velkými písmeny (porovnává se s toUpperCase)", () => {
  LANGUAGES.forEach((lang) => assert.equal(TEXTS[lang].wipeWord, TEXTS[lang].wipeWord.toUpperCase(), lang));
});
