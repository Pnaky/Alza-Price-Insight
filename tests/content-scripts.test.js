// Soubory content scriptu AlzaPriceTracker (content.js + src/content/*.js) se načítají na třech místech:
// manifest (stránky Alzy), stránka nastavení (dialog historie) a service worker / stránka na pozadí (sdílené
// skripty). Pořadí musí sedět, jinak část chybí nebo se spustí dřív, než existuje objekt
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const contentScripts = manifest.content_scripts[0].js;
const isTrackerFile = (file) => file === "src/content.js" || file.startsWith("src/content/");

test("všechny soubory src/content/ jsou v manifestu, start.js poslední", () => {
  const parts = fs.readdirSync(path.join(ROOT, "src/content")).map((file) => `src/content/${file}`);
  const listed = contentScripts.filter(isTrackerFile);
  assert.deepEqual([...parts].sort(), listed.filter((file) => file !== "src/content.js").sort());
  assert.equal(listed[0], "src/content/texts.js");
  assert.equal(listed[1], "src/content.js");
  assert.equal(listed.at(-1), "src/content/start.js");
  assert.ok(contentScripts.indexOf("src/shared/store.js") < contentScripts.indexOf("src/content.js"));
});

test("stránka nastavení načítá content script ve stejném pořadí jako manifest", () => {
  const html = fs.readFileSync(path.join(ROOT, "src/options/options.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(([, src]) => path.posix.join("src/options", src));
  assert.deepEqual(scripts.filter(isTrackerFile), contentScripts.filter(isTrackerFile));
});

test("skripty na pozadí: Chrome (importScripts) a Firefox (background.scripts) ve stejném pořadí", () => {
  const worker = fs.readFileSync(path.join(ROOT, "src/chrome/service-worker.js"), "utf8");
  const imported = [...worker.match(/importScripts\(([^)]*)\)/)[1].matchAll(/"([^"]+)"/g)].map(([, src]) => path.posix.join("src/chrome", src));
  const firefox = manifest.background.scripts;
  const shared = (list) => list.filter((file) => !/product-pages\.js$|product-page\.js$/.test(file));
  assert.deepEqual(shared(imported), shared(firefox));
});

// Při rozdělení content.js se ztratila metoda blockSaving – volání this.x() bez definice spadne až za běhu
test("každá volaná metoda this.x() content scriptu je někde definovaná", () => {
  const source = contentScripts.filter(isTrackerFile).map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");
  const defined = new Set([...source.matchAll(/^ {2}(?:async\s+)?(\w+)\s*(?:\([^)]*\)\s*\{|:)/gm)].map(([, name]) => name));
  const missing = [...new Set([...source.matchAll(/\bthis\.(\w+)\(/g)].map(([, name]) => name))].filter((name) => !defined.has(name));
  assert.deepEqual(missing, []);
});
