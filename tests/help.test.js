// Nápověda ve čtyřech jazycích (src/help/help*.html) – ručně psané překlady se nesmí rozejít: stejné sekce,
// stejná kostra (nadpisy, odstavce, odrážky, tabulky, otázky) a názvy voleb nastavení přesně tak, jak je
// ukazuje stránka nastavení v daném jazyce (OPTIONS_TEXTS). Čeština (help.html) je zdroj.
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const HELP_FILES = { cz: "help.html", sk: "help-sk.html", hu: "help-hu.html", en: "help-en.html" };
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const pages = Object.fromEntries(Object.entries(HELP_FILES).map(([lang, file]) => [lang, read(`src/help/${file}`)]));

// Slovník stránky nastavení (const v options-texts.js – výraz se vyhodnotí ve stejném kontextu)
function loadOptionsTexts() {
  const context = vm.createContext({});
  vm.runInContext(read("src/options/options-texts.js"), context);
  return vm.runInContext("OPTIONS_TEXTS", context);
}

// Sekce <section id="…"> v pořadí stránky
function sections(html) {
  return [...html.matchAll(/<section id="([^"]+)">([\s\S]*?)<\/section>/g)].map(([, id, body]) => ({ id, body }));
}

// Kostra sekce: pořadí strukturních značek (text se překládá, struktura zůstává)
const STRUCTURE_TAGS = ["h2", "h3", "p", "ul", "ol", "li", "table", "tr", "th", "td", "details", "summary", "em", "a"];
function skeleton(body) {
  const pattern = new RegExp(`<(${STRUCTURE_TAGS.join("|")})(?=[\\s>])([^>]*)>`, "g");
  return [...body.matchAll(pattern)].map(([, tag, attributes]) => {
    const className = attributes.match(/class="([^"]+)"/)?.[1];
    const href = tag === "a" ? attributes.match(/href="([^"]+)"/)?.[1] : null;
    return [tag, className && `.${className}`, href && `[${href}]`].filter(Boolean).join("");
  });
}

// Značky uvnitř textu – odznaky šipek, štítek ceny za kus
const inlineMarks = (body) => [...body.matchAll(/<span class="([^"]+)"/g)].map(([, className]) => className);

test("nápověda: stejné sekce ve stejném pořadí", () => {
  const reference = sections(pages.cz).map(({ id }) => id);
  assert.ok(reference.length >= 10, "help.html má sekce");
  Object.entries(pages).forEach(([lang, html]) => assert.deepEqual(sections(html).map(({ id }) => id), reference, HELP_FILES[lang]));
});

test("nápověda: obsah (nav) odkazuje na všechny sekce ve stejném pořadí", () => {
  Object.entries(pages).forEach(([lang, html]) => {
    const nav = html.match(/<nav>([\s\S]*?)<\/nav>/)?.[1] || "";
    const links = [...nav.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id);
    assert.deepEqual(links, sections(html).map(({ id }) => id), HELP_FILES[lang]);
  });
});

test("nápověda: všechna id v souboru jsou stejná a ve stejném pořadí", () => {
  const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
  const reference = ids(pages.cz);
  Object.entries(pages).forEach(([lang, html]) => assert.deepEqual(ids(html), reference, HELP_FILES[lang]));
});

test("nápověda: každá sekce má stejnou kostru (nadpisy, odstavce, odrážky, řádky tabulek, otázky)", () => {
  const reference = sections(pages.cz);
  Object.entries(pages).forEach(([lang, html]) => {
    sections(html).forEach(({ id, body }, index) => {
      assert.deepEqual(skeleton(body), skeleton(reference[index].body), `${HELP_FILES[lang]} #${id}`);
      assert.deepEqual(inlineMarks(body), inlineMarks(reference[index].body), `${HELP_FILES[lang]} #${id} – odznaky`);
    });
  });
});

test("nápověda: přepínač jazyků odkazuje na ostatní tři a zvýrazní vlastní", () => {
  const labels = { cz: "CZ", sk: "SK", hu: "HU", en: "EN" };
  Object.entries(pages).forEach(([lang, html]) => {
    const switcher = html.match(/<div class="languages">([\s\S]*?)<\/div>/)?.[1] || "";
    assert.match(switcher, new RegExp(`<strong>${labels[lang]}</strong>`), HELP_FILES[lang]);
    Object.entries(HELP_FILES)
      .filter(([other]) => other !== lang)
      .forEach(([, file]) => assert.ok(switcher.includes(`href="${file}"`), `${HELP_FILES[lang]} → ${file}`));
  });
});

// Volby a tlačítka nastavení, na které nápověda odkazuje – musí odpovídat popiskům na stránce nastavení
// v jazyce nápovědy (bez úvodního emoji a „…“), ať uživatel hledá to, co opravdu vidí
const REFERENCED_LABELS = [
  "testNotifications",
  "categories",
  "unitPrice",
  "saveBrowsing",
  "exportJson",
  "importJson",
  "exportCsv",
  "pruneData",
  "wipeSummary",
  "wipeWord",
  "diagnostics",
  "tabData",
];
const bareLabel = (text) => text.replace(/^[^\p{L}]+|…$/gu, "").trim();

test("nápověda: názvy voleb nastavení jsou v jazyce nápovědy a odpovídají stránce nastavení", () => {
  const texts = loadOptionsTexts();
  Object.entries(pages).forEach(([lang, html]) => {
    REFERENCED_LABELS.forEach((key) => {
      const label = bareLabel(texts[lang][key]);
      assert.ok(html.includes(label), `${HELP_FILES[lang]}: chybí „${label}“ (${key})`);
      // Český popisek v cizojazyčné nápovědě = zastaralý odkaz na nepřeloženou stránku nastavení
      const czech = bareLabel(texts.cz[key]);
      if (lang !== "cz" && czech !== label) assert.ok(!html.includes(czech), `${HELP_FILES[lang]}: český popisek „${czech}“ (${key})`);
    });
  });
});

test("nápověda: ukládání z procházení je popsané ve všech jazycích", () => {
  const texts = loadOptionsTexts();
  Object.entries(pages).forEach(([lang, html]) => {
    const settings = sections(html).find(({ id }) => id === "nastaveni").body;
    assert.ok(settings.includes(`<strong>${texts[lang].saveBrowsing}</strong>`), `${HELP_FILES[lang]}: volba ${texts[lang].saveBrowsing} v Nastavení a data`);
  });
});
