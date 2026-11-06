// Sestaví balíčky do obchodů z jednoho kódu: ..\alza-price-insight_<verze>_chrome.zip (Chrome Web Store)
// a ..\alza-price-insight_<verze>_firefox.zip (addons.mozilla.org). Každý obsahuje jen to, co jeho
// prohlížeč používá – bez src/ druhého prohlížeče a s manifestem bez jeho klíčů.
//
//   node tools/package.js            balí čistý pracovní strom (= poslední commit)
//   node tools/package.js --dirty    i s neuloženými změnami – jen na zkoušku, nenahrávat
//
// Potřebuje Node 22+ (zlib.crc32), žádné další balíčky.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const INCLUDE = ["manifest.json", "_locales", "css", "img", "src"];

const TARGETS = {
  chrome: {
    exclude: ["src/firefox/"],
    manifest(manifest) {
      delete manifest.browser_specific_settings;
      delete manifest.background.scripts;
    },
  },
  firefox: {
    exclude: ["src/chrome/"],
    manifest(manifest) {
      delete manifest.minimum_chrome_version;
      delete manifest.background.service_worker;
      manifest.permissions = manifest.permissions.filter((permission) => permission !== "offscreen");
    },
  },
};

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function fail(message) {
  console.error(`Chyba: ${message}`);
  process.exit(1);
}

// === Kontrola balíčku ===

// Soubory, na které odkazuje manifest a HTML stránky balíčku – všechny musí v balíčku být
function referencedFiles(manifest, files) {
  const refs = new Set();
  const background = manifest.background || {};
  if (background.service_worker) refs.add(background.service_worker);
  (background.scripts || []).forEach((file) => refs.add(file));
  (manifest.content_scripts || []).forEach((script) => [...(script.js || []), ...(script.css || [])].forEach((file) => refs.add(file)));
  Object.values(manifest.icons || {}).forEach((file) => refs.add(file));
  if (manifest.action?.default_popup) refs.add(manifest.action.default_popup);
  if (manifest.options_ui?.page) refs.add(manifest.options_ui.page);
  if (manifest.default_locale) refs.add(`_locales/${manifest.default_locale}/messages.json`);

  for (const [name, content] of files) {
    if (!name.endsWith(".html")) continue;
    for (const match of content.toString("utf8").matchAll(/(?:src|href)="([^"#:]+)"/g)) {
      refs.add(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1])));
    }
  }
  return refs;
}

// === ZIP (deflate, názvy v UTF-8, lomítka – AMO zpětná lomítka odmítá) ===

function zip(files) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// === Sestavení ===

const dirty = process.argv.includes("--dirty");
const changes = git("status", "--porcelain", "--", ...INCLUDE).trim();
if (changes && !dirty) fail(`neuložené změny – nejdřív commit (nebo --dirty na zkoušku):\n${changes}`);

// Jen soubory v gitu (bez ignorovaných a pomocných), ve stavu pracovního stromu
const sources = git("ls-files", "--cached", "--others", "--exclude-standard", "--", ...INCLUDE)
  .split("\n")
  .filter((name) => name && fs.existsSync(path.join(ROOT, name)));
const baseManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const version = baseManifest.version;
if (!/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(version)) console.warn(`Pozor: verze ${version} není ve tvaru RRRR.M.D pro obchod.`);

// Syntaktická chyba v kterémkoli skriptu by rozbila celé rozšíření – zkontrolovat před zabalením
sources
  .filter((name) => name.endsWith(".js"))
  .forEach((name) => {
    try {
      execFileSync(process.execPath, ["--check", path.join(ROOT, name)], { stdio: "pipe" });
    } catch (error) {
      fail(`syntaktická chyba v ${name}\n${error.stderr}`);
    }
  });

for (const [target, rules] of Object.entries(TARGETS)) {
  const manifest = structuredClone(baseManifest);
  rules.manifest(manifest);

  const files = new Map([["manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")]]);
  sources
    .filter((name) => name !== "manifest.json" && !rules.exclude.some((prefix) => name.startsWith(prefix)))
    .sort()
    .forEach((name) => files.set(name, fs.readFileSync(path.join(ROOT, name))));

  const missing = [...referencedFiles(manifest, files)].filter((name) => !files.has(name));
  if (missing.length) fail(`${target}: v balíčku chybí ${missing.join(", ")}`);

  const output = path.resolve(ROOT, "..", `alza-price-insight_${version}_${target}.zip`);
  fs.writeFileSync(output, zip(files));
  console.log(`${target}: ${output} (${files.size} souborů)${dirty ? " – ZKUŠEBNÍ, s neuloženými změnami" : ""}`);
}
