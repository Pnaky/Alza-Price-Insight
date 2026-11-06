// Úplnost překladů: každý slovník textů má ve všech jazycích stejné klíče jako čeština (chybějící klíč by
// tiše spadl na češtinu). Slovníky se vyříznou ze zdrojáků (content scripty nejde v Node spustit celé)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadCore } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
const { AlzaCore } = loadCore();
const LANGUAGES = ["cz", "sk", "hu", "en"];

// Objektový literál za `marker` (podle párování závorek) vyhodnocený s AlzaCore v dosahu (…AlzaCore.texts.cz)
function extractObject(file, marker) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const start = source.indexOf("{", source.indexOf(marker));
  assert.ok(start > 0, `${marker} v ${file}`);
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      return new Function("AlzaCore", `return (${source.slice(start, i + 1)});`)(AlzaCore);
    }
  }
  throw new Error(`Neukončený objekt ${marker} v ${file}`);
}

function assertParity(name, dictionary) {
  const reference = Object.keys(dictionary.cz).sort();
  LANGUAGES.forEach((lang) => {
    assert.ok(dictionary[lang], `${name}: chybí jazyk ${lang}`);
    const keys = Object.keys(dictionary[lang]);
    const missing = reference.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !reference.includes(key));
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, `${name} – ${lang}`);
  });
}

test("AlzaCore.texts", () => assertParity("core.js", AlzaCore.texts));
test("content/texts.js", () => assertParity("content/texts.js", extractObject("src/content/texts.js", "const AlzaPriceTrackerTexts")));
test("category.js translations", () => assertParity("category.js", extractObject("src/category.js", "translations: {")));
test("popup.js POPUP_TEXTS", () => assertParity("popup.js", extractObject("src/popup/popup.js", "const POPUP_TEXTS")));
