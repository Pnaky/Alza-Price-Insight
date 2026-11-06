// Testy jediného zapisovatele do storage (src/shared/store.js): node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");

const plain = (value) => JSON.parse(JSON.stringify(value));
const URL_A = "https://www.alza.cz/produkt-a-d101.htm";
const URL_A2 = "https://www.alza.cz/produkt-a-d101.htm?o=2"; // stejný produkt, jiná adresa
const URL_B = "https://www.alza.cz/produkt-b-d202.htm";

function setup(storage = {}) {
  const { AlzaCore, chrome, context } = loadCore({ storage, files: ["src/shared/store.js"] });
  context.AlzaStore.isWriter = true;
  return { AlzaCore, AlzaStore: context.AlzaStore, data: chrome.storage.local.data };
}

test("migrace: alzaPrices_<doména> → záznam za produkt, duplicitní adresy sloučené", async () => {
  const { AlzaStore, data } = setup({
    alzaPrices_alza_cz: {
      [URL_A]: { original: 100, lastUpdated: 10, minPrice: { value: 80, timestamp: 1 }, maxPrice: { value: 120, timestamp: 1 } },
      [URL_A2]: { original: 90, lastUpdated: 20, minPrice: { value: 85, timestamp: 2 }, maxPrice: { value: 130, timestamp: 2 } },
      [URL_B]: { original: 50, lastUpdated: 5 },
      "https://evil.example/x-d1.htm": { original: 1 },
    },
    alzaPrices_alza_sk: { "https://www.alza.sk/x-d7.htm": { original: 9, lastUpdated: 1 } },
    alzaHistory_alza_cz_101: [{ t: 1, s: 1, p: { original: 100 }, a: "in" }],
  });
  assert.equal(await AlzaStore.exclusive(() => AlzaStore.migrate()), 3);
  assert.equal(data.alzaPrices_alza_cz, undefined);
  assert.equal(data.alzaPrices_alza_sk, undefined);
  const a = data.alzaPrice_alza_cz_101;
  assert.equal(a.original, 90); // novější záznam
  assert.equal(a.lastUpdated, 20);
  assert.equal(a.minPrice.value, 80); // minimum z obou
  assert.equal(a.maxPrice.value, 130);
  assert.equal(a.url, URL_A2);
  assert.equal(data.alzaPrice_alza_cz_202.url, URL_B);
  assert.equal(data.alzaPrice_alza_sk_7.original, 9);
  assert.ok(data.alzaHistory_alza_cz_101, "historie zůstává");
  assert.equal(await AlzaStore.exclusive(() => AlzaStore.migrate()), 0); // podruhé nic
});

test("mergePrices vrací záznam před sloučením a ukládá po produktech", async () => {
  const { AlzaStore, data } = setup();
  const first = await AlzaStore.run({ type: "mergePrices", domain: "alza_cz", records: { [URL_A]: { original: 100 } }, listId: "L", now: 1 });
  assert.equal(first[URL_A].before, null);
  assert.equal(data.alzaPrice_alza_cz_101.oldLowestPrice, 100);
  const second = await AlzaStore.run({ type: "mergePrices", domain: "alza_cz", records: { [URL_A2]: { original: 90 } }, now: 2 });
  assert.equal(second[URL_A2].before.original, 100);
  assert.equal(data.alzaPrice_alza_cz_101.newLowestPrice, 90);
  assert.equal(data.alzaPrice_alza_cz_101.url, URL_A); // první známá adresa zůstává
  assert.equal(data.alzaPrice_alza_cz_101.listId, "L");
});

test("souběžné operace se nepřepíšou (fronta)", async () => {
  const { AlzaStore, data } = setup({ alzaTargets: {} });
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => AlzaStore.run({ type: "patchMap", key: "alzaTargets", set: { [`alza_cz_${i}`]: { price: i } } }))
  );
  assert.equal(Object.keys(data.alzaTargets).length, 20);
});

test("patchMap: set s keep, update jen existující, merge, remove", async () => {
  const { AlzaStore, data } = setup({ alzaWatchLists: { a: { name: "A", since: 5 } } });
  await AlzaStore.run({ type: "patchMap", key: "alzaWatchLists", set: { a: { name: "A2", since: 99 } }, keep: ["since"] });
  assert.deepEqual(plain(data.alzaWatchLists.a), { name: "A2", since: 5 });
  await AlzaStore.run({ type: "patchMap", key: "alzaWatchLists", update: { b: { name: "B" } } });
  assert.equal(data.alzaWatchLists.b, undefined);
  await AlzaStore.run({ type: "patchMap", key: "alzaWatchLists", merge: { a: { count: 3 } } });
  assert.equal(data.alzaWatchLists.a.count, 3);
  const map = await AlzaStore.run({ type: "patchMap", key: "alzaWatchLists", remove: ["a"] });
  assert.deepEqual(plain(map), {});
});

test("appendHistory naváže první záznam na předchozí záznam ceny", async () => {
  const { AlzaStore, data } = setup();
  const entries = await AlzaStore.run({
    type: "appendHistory",
    domain: "alza_cz",
    lang: "cz",
    url: URL_A,
    prices: { original: 90 },
    availability: "in",
    previousRecord: { original: 100, lastUpdated: 5 },
    now: 10,
  });
  assert.equal(entries.length, 2);
  assert.equal(data.alzaHistory_alza_cz_101.length, 2);
});

test("recordBrowsing zapíše historii jen s cenami a přehled procházených", async () => {
  const { AlzaStore, data } = setup({ alzaBrowsed: { alza_cz_202: { url: URL_B, name: "Starý", seenAt: 1 } } });
  await AlzaStore.run({
    type: "recordBrowsing",
    domain: "alza_cz",
    lang: "cz",
    now: 50,
    products: [
      { url: URL_A, name: "A", image: null, prices: { original: 10 }, availability: "in" },
      { url: URL_B, name: null, image: null, prices: null, availability: null },
    ],
  });
  assert.equal(data.alzaHistory_alza_cz_101.length, 1);
  assert.equal(data.alzaHistory_alza_cz_202, undefined);
  assert.equal(data.alzaBrowsed.alza_cz_202.name, "Starý");
  assert.equal(data.alzaBrowsed.alza_cz_202.seenAt, 50);
  assert.equal(data.alzaBrowsed.alza_cz_101.name, "A");
});

test("importData: starý formát cen, sloučení historie a objektů", async () => {
  const { AlzaStore, data } = setup({
    alzaHistory_alza_cz_101: [{ t: 1, s: 1, p: { original: 100 }, a: "in" }],
    alzaTargets: { alza_cz_1: { price: 1 } },
  });
  await AlzaStore.run({
    type: "importData",
    items: {
      alzaPrices_alza_cz: { [URL_B]: { original: 50, lastUpdated: 3 } },
      alzaHistory_alza_cz_101: [{ t: 2, s: 2, p: { original: 90 }, a: "in" }],
      alzaTargets: { alza_cz_2: { price: 2 } },
    },
  });
  assert.equal(data.alzaPrice_alza_cz_202.original, 50);
  assert.equal(data.alzaPrices_alza_cz, undefined);
  assert.equal(data.alzaHistory_alza_cz_101.length, 2);
  assert.deepEqual(Object.keys(data.alzaTargets).sort(), ["alza_cz_1", "alza_cz_2"]);
});

test("removeProducts smaže historii, záznam ceny i přehled procházených", async () => {
  const { AlzaStore, data } = setup({
    alzaHistory_alza_cz_101: [],
    alzaPrice_alza_cz_101: { original: 1 },
    alzaBrowsed: { alza_cz_101: {}, alza_cz_202: {} },
    alzaTargets: { alza_cz_101: { price: 1 } },
  });
  await AlzaStore.run({ type: "removeProducts", productKeys: ["alza_cz_101"] });
  assert.equal(data.alzaHistory_alza_cz_101, undefined);
  assert.equal(data.alzaPrice_alza_cz_101, undefined);
  assert.deepEqual(Object.keys(data.alzaBrowsed), ["alza_cz_202"]);
  assert.ok(data.alzaTargets.alza_cz_101, "cílová cena zůstává");
});

test("recordVatCheck zapíše stejný výsledek nejvýš jednou za vatCheckRefreshMs", async () => {
  const { AlzaCore, AlzaStore, data } = setup();
  await AlzaStore.run({ type: "recordVatCheck", domain: "alza_cz", withVat: true, now: 1000 });
  await AlzaStore.run({ type: "recordVatCheck", domain: "alza_cz", withVat: true, now: 2000 });
  assert.equal(data.alzaVatCheck.alza_cz.at, 1000);
  await AlzaStore.run({ type: "recordVatCheck", domain: "alza_cz", withVat: true, now: 1000 + AlzaCore.vatCheckRefreshMs });
  assert.equal(data.alzaVatCheck.alza_cz.at, 1000 + AlzaCore.vatCheckRefreshMs);
});

test("mimo službu na pozadí jde operace zprávou; chyba se vrátí volajícímu", async () => {
  const writer = setup({ alzaTargets: {} });
  const { context, chrome } = loadCore({ files: ["src/shared/store.js"] });
  // Zpráva → handleMessage zapisovatele (jako chrome.runtime.onMessage ve službě na pozadí)
  chrome.runtime.sendMessage = (message) =>
    new Promise((resolve) => {
      if (!writer.AlzaStore.handleMessage(message, resolve)) resolve(undefined);
    });
  await context.AlzaStore.run({ type: "patchMap", key: "alzaTargets", set: { x: { price: 1 } } });
  assert.equal(writer.data.alzaTargets.x.price, 1);
  await assert.rejects(() => context.AlzaStore.run({ type: "nonexistent" }), /Neznámá operace/);
});

test("findStaleProducts vidí záznamy cen po produktech", () => {
  const { AlzaCore } = setup();
  const now = Date.UTC(2026, 10, 6);
  const old = now - 100 * AlzaCore.dayMs;
  const stale = AlzaCore.findStaleProducts({ alzaPrice_alza_cz_5: { original: 1, lastUpdated: old }, alzaPrice_alza_cz_6: { original: 1, lastUpdated: now } }, now);
  assert.deepEqual(plain(stale), [{ key: "alza_cz_5", historyKey: null, priceKey: "alzaPrice_alza_cz_5", browsed: false, checkedAt: old }]);
});
