// Načte src/shared/core.js do izolovaného kontextu s náhradou chrome.* (úložiště v paměti) – pro testy
// v Node bez prohlížeče: node --test tests/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

function createChromeMock(initial = {}) {
  const data = structuredClone(initial);
  const listeners = [];
  const pick = (keys) => {
    if (keys === null || keys === undefined) return structuredClone(data);
    const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
    return Object.fromEntries(list.filter((key) => Object.hasOwn(data, key)).map((key) => [key, structuredClone(data[key])]));
  };
  const notify = (changes) => Object.keys(changes).length && listeners.forEach((listener) => listener(changes, "local"));
  const local = {
    data,
    async get(keys) {
      return pick(keys);
    },
    async set(items) {
      const changes = {};
      Object.entries(structuredClone(items)).forEach(([key, value]) => {
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = value;
      });
      notify(changes);
    },
    async remove(keys) {
      const changes = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        if (!Object.hasOwn(data, key)) return;
        changes[key] = { oldValue: data[key] };
        delete data[key];
      });
      notify(changes);
    },
  };
  return {
    storage: { local, onChanged: { addListener: (listener) => listeners.push(listener) } },
    runtime: { getManifest: () => ({ version: "test" }), getURL: (file) => `chrome-extension://test/${file}`, sendMessage: async () => undefined },
    i18n: { getUILanguage: () => "cs-CZ", getMessage: () => "" },
  };
}

// Vrací { AlzaCore, chrome, context }. files = další skripty načtené po core.js (sdílejí globální prostor)
function loadCore({ storage = {}, files = [] } = {}) {
  const chrome = createChromeMock(storage);
  const context = vm.createContext({ chrome, console, setTimeout, clearTimeout, URL, structuredClone });
  context.globalThis = context;
  for (const file of ["src/shared/core.js", ...files]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  }
  return { AlzaCore: context.AlzaCore, chrome, context };
}

module.exports = { loadCore, createChromeMock };
