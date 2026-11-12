// Překlady stránky nastavení (src/options/options-texts.js): všechny jazyky mají stejné klíče a parametry
// jako čeština, každý klíč z options.html (data-i18n*) a options.js (t("…"), label: "…") ve slovníku je
// a české texty v HTML (zobrazené do spuštění skriptu) jsou stejné jako ve slovníku.
// Na konci záloha a smazání všech dat (každý klíč storageKeys je zařazený), import připomínek cashbacku a
// začernění veřejného hlášení chyby (src/options/options-backup.js).
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
// Skripty stránky, které berou texty přes t("…") – options.js a záložka Moje nákupy (options-owned.js)
const script = ["src/options/options.js", "src/options/options-owned.js"].map(read).join("\n");

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

// Klíče z atributů data-i18n, data-i18n-title, data-i18n-tip, data-i18n-placeholder, data-i18n-label
const htmlKeys = () => [...html.matchAll(/\sdata-i18n(?:-title|-tip|-placeholder|-label)?="([^"]+)"/g)].map(([, key]) => key);
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
  // Název řady záložek (aria-label) – čeština do spuštění skriptu, pak překlad z data-i18n-label
  const labels = [...html.matchAll(/aria-label="([^"]*)"[^>]*data-i18n-label="([^"]+)"/g)];
  assert.equal(labels.length, [...html.matchAll(/\sdata-i18n-label="/g)].length, "každý data-i18n-label má český aria-label");
  labels.forEach(([, text, key]) => assert.equal(text, TEXTS.cz[key], `aria-label ${key}`));
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

// === Záloha, smazání všech dat a hlášení chyby (src/options/options-backup.js – OptionsData) ===
const { loadCore } = require("./load-core");

function loadOptionsData() {
  const { AlzaCore, context } = loadCore({ files: ["src/options/options-backup.js"] });
  return { AlzaCore, data: context.OptionsData };
}

test("nastavení: options-backup.js se načítá za core.js a před options.js", () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(([, src]) => src);
  const index = (src) => scripts.indexOf(src);
  assert.ok(index("options-backup.js") > index("../shared/core.js"), "za core.js");
  assert.ok(index("options-backup.js") < index("options.js"), "před options.js");
});

test("záloha: každý klíč storageKeys je v záloze, nebo výslovně vyňatý – a smaže se, nebo výslovně zůstane", () => {
  const { AlzaCore, data } = loadOptionsData();
  const all = Object.values(AlzaCore.storageKeys);
  const backedUp = new Set(data.BACKUP_KEYS);
  const excluded = new Set(Object.keys(data.NOT_BACKED_UP));
  all.forEach((key) => {
    assert.ok(backedUp.has(key) !== excluded.has(key), `${key}: buď v BACKUP_KEYS, nebo v NOT_BACKED_UP`);
    assert.equal(data.BACKUP_KEY_PATTERN.test(key), backedUp.has(key), `${key}: BACKUP_KEY_PATTERN`);
    assert.ok(data.WIPE_KEYS.includes(key) !== data.KEPT_ON_WIPE.includes(key), `${key}: buď se smaže, nebo zůstane`);
  });
  [...backedUp, ...excluded, ...data.KEPT_ON_WIPE].forEach((key) => assert.ok(all.includes(key), `${key} není v storageKeys`));
  // Smazání nechá jen nastavení, log chyb, záznam jednorázových oprav a viděné novinky
  const kept = [AlzaCore.storageKeys.settings, AlzaCore.storageKeys.errorLog, AlzaCore.storageKeys.cleanups, AlzaCore.storageKeys.news];
  assert.deepEqual([...data.KEPT_ON_WIPE].sort(), kept.sort());
  ["purchases", "purchasesSync", "codes", "cashbacks", "cashbackReminders", "cashbackTerms", "cleanup"].forEach((name) =>
    assert.ok(data.WIPE_KEYS.includes(AlzaCore.storageKeys[name]), `smaže se ${name}`)
  );
  // Produkty jsou v záloze podle předpon
  ["alzaHistory_alza_cz_1", "alzaPrice_alza_sk_2", "alzaPrices_alza_hu"].forEach((key) => assert.ok(data.BACKUP_KEY_PATTERN.test(key), key));
  assert.ok(!data.BACKUP_KEY_PATTERN.test("alzaHistory_evil_1"));
});

test("záloha: smazání všech dat – produkty ze zálohy a všechny přehledy kromě nastavení a logu chyb", () => {
  const { AlzaCore, data } = loadOptionsData();
  const keys = AlzaCore.storageKeys;
  const wipe = data.getWipeKeys({ alzaHistory_alza_cz_1: [], alzaPrice_alza_cz_1: {}, [keys.settings]: {}, [keys.watchLists]: {} });
  ["alzaHistory_alza_cz_1", "alzaPrice_alza_cz_1", keys.watchLists, keys.purchases, keys.codes, keys.cashbackReminders, keys.watchLog].forEach((key) =>
    assert.ok(wipe.includes(key), key)
  );
  [keys.settings, keys.errorLog, keys.cleanups].forEach((key) => assert.ok(!wipe.includes(key), key));
  assert.equal(new Set(wipe).size, wipe.length, "bez duplicit");
});

test("záloha: import připomínek cashbacku – jen Alza, známá pole ve správném typu, klíč z adresy", () => {
  const { data } = loadOptionsData();
  const now = Date.UTC(2026, 10, 9);
  const day = 24 * 60 * 60 * 1000;
  const url = "https://www.alza.cz/vysavac-d7654321.htm";
  const clean = data.sanitizeCashbackReminders(
    {
      __proto__x: {
        url,
        domain: "alza_cz",
        name: "Vysavač",
        image: "https://evil.example/pixel.png",
        terms: "/ziskejte-penize-zpet?x=1",
        title: "Peníze zpět",
        refund: 500,
        boughtAt: now - 3 * day,
        registerFrom: now + 10 * day,
        registerUntil: now + 9999 * day,
        termsRead: "yes",
        termsTries: 99,
        done: true,
        extra: "<script>",
      },
      foreign: { url: "https://evil.example/x-d1.htm", domain: "alza_cz", boughtAt: now - day },
      wrongDomain: { url, domain: "alza_sk", boughtAt: now - day },
      future: { url: "https://www.alza.cz/x-d2.htm", domain: "alza_cz", boughtAt: now + 30 * day },
      offAlzaTerms: { url: "https://www.alza.cz/x-d3.htm", domain: "alza_cz", boughtAt: now - day, terms: "https://evil.example/terms", image: "https://image.alza.cz/a.jpg" },
      broken: "x",
    },
    now
  );
  assert.deepEqual(Object.keys(clean).sort(), ["alza_cz_3", "alza_cz_7654321"]);
  const reminder = clean.alza_cz_7654321;
  assert.equal(reminder.image, null);
  assert.equal(reminder.terms, "https://www.alza.cz/ziskejte-penize-zpet");
  assert.equal(reminder.registerFrom, now + 10 * day);
  assert.equal(reminder.registerUntil, null, "lhůta nesmyslně daleko");
  assert.equal(reminder.termsRead, false, "jen skutečné true");
  assert.equal(reminder.done, true);
  assert.equal(reminder.termsTries, 3);
  assert.equal(reminder.extra, undefined);
  assert.equal(clean.alza_cz_3.terms, null);
  assert.equal(clean.alza_cz_3.image, "https://image.alza.cz/a.jpg");
});

test("hlášení chyby: adresy jen jako doména (i bez https://), citlivé texty pryč", () => {
  const { data } = loadOptionsData();
  const redact = data.redactForReport;
  assert.equal(redact("www.alza.cz/apple-iphone-17-pro-d7654321.htm"), "www.alza.cz");
  assert.equal(redact("alza.sk/kosik?x=1"), "alza.sk");
  assert.equal(redact("chyba na https://www.alza.hu/termek-d1.htm?dq=2 při načtení"), "chyba na www.alza.hu při načtení");
  assert.equal(redact("moz-extension://1234abcd-0000-1111-2222-333344445555/src/popup/popup.js"), "moz-extension://…/src/popup/popup.js");
  assert.equal(redact("safari-web-extension://1234ABCD-0000-1111-2222-333344445555/src/background.js"), "safari-web-extension://…/src/background.js");
  assert.equal(redact("www.alza.cz"), "www.alza.cz");
  assert.equal(redact("background"), "background");
  const sensitive = data.getSensitiveTexts({
    alzaCodes: { alza_cz_1: { code: "SLEVA20" } },
    alzaPurchases: { alza_cz_2: { name: "Robotický vysavač X" } },
    alzaCashbackReminders: { alza_cz_3: { name: "Pračka Y", title: "Peníze zpět" } },
  });
  assert.equal(redact("Kód SLEVA20 u Robotický vysavač X a Pračka Y selhal", sensitive), "Kód … u … a … selhal");
});

test("hlášení chyby: popis cesty k diagnostice odpovídá záložce a tlačítku na stránce nastavení", () => {
  // Diagnostika je v záložce „Obecné“ – text hlášení se nesmí rozejít s názvy na stránce
  LANGUAGES.forEach((lang) => {
    const path = [TEXTS[lang].general, TEXTS[lang].diagnostics, TEXTS[lang].exportDiagnostics];
    const body = TEXTS[lang].reportBugBody;
    path.forEach((label) => assert.ok(body.includes(label), `${lang}: reportBugBody neobsahuje „${label}“`));
    assert.ok(body.indexOf(`${path[0]} → ${path[1]}`) >= 0, `${lang}: ${path[0]} → ${path[1]}`);
  });
});
