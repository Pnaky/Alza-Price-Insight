// Opravy z auditu před vydáním (2026-11-07): okrajové případy, které dřív spadly nebo vracely nesmysl
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");

const { AlzaCore } = loadCore();
const DAY = AlzaCore.dayMs;
const NOW = Date.UTC(2026, 10, 7, 12);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("formatPercent: malý pokles není „0 %“", () => {
  assert.equal(AlzaCore.formatPercent(0.02, "alza_cz"), "0,02");
  assert.equal(AlzaCore.formatPercent(0.5, "alza_cz"), "0,5");
  assert.equal(AlzaCore.formatPercent(12.4, "alza_cz"), "12");
  assert.match(AlzaCore.formatPriceDrop("cz", "Cena", 4949, 4948, "alza_cz"), /-0,02 %/);
});

test("časy HH:MM: neplatné se nepoužijí (denní kontrola, tiché hodiny)", () => {
  assert.ok(AlzaCore.timePattern.test("07:30"));
  assert.ok(AlzaCore.timePattern.test("23:59"));
  ["25:00", "99:99", "7:30", "12:60", ""].forEach((time) => assert.ok(!AlzaCore.timePattern.test(time), time));
  const fallback = AlzaCore.getDailyRunTimes(AlzaCore.defaultSettings.checkTime, NOW);
  assert.deepEqual(plain(AlzaCore.getDailyRunTimes("25:00", NOW)), plain(fallback));
  const at = new Date(2026, 10, 7, 3, 0);
  assert.equal(AlzaCore.isQuietTime({ quietHours: true, quietFrom: "99:99", quietTo: "07:00" }, at), false);
  assert.equal(AlzaCore.isQuietTime({ quietHours: true, quietFrom: "22:00", quietTo: "07:00" }, at), true);
});

test("ceny bez DPH: tolerance podle měny (běžná změna ceny v € není „bez DPH“)", () => {
  const rate = 1 + AlzaCore.domains.alza_sk.vatRate / 100;
  const entries = (price) => [{ t: NOW - DAY, s: NOW - 1000, p: { original: price }, a: "in" }];
  // Zlevnění 13,99 € → 11,00 € (11 × DPH ≈ 13,5) – dřív vyšlo „bez DPH“
  assert.equal(AlzaCore.getVatFromKnownPrices([{ prices: { original: 11 }, entries: entries(13.99) }], "alza_sk", NOW), null);
  // Skutečná cena bez DPH
  const net = 10;
  const gross = Math.round(net * rate * 100) / 100;
  assert.equal(AlzaCore.getVatFromKnownPrices([{ prices: { original: net }, entries: entries(gross) }], "alza_sk", NOW), false);
  assert.equal(AlzaCore.getVatFromKnownPrices([{ prices: { original: gross }, entries: entries(gross) }], "alza_sk", NOW), true);
});

test("getChangeTone a getBadgeTone: poškozená data nespadnou, všechny jazyky", () => {
  assert.equal(AlzaCore.getChangeTone(undefined), null);
  assert.equal(AlzaCore.getChangeTone(42), null);
  assert.equal(AlzaCore.getBadgeTone([null, { key: "a" }, { key: "b", lines: [null] }], ["a", "b"]), "down");
  assert.equal(AlzaCore.getBadgeTone(null, ["a"]), "down");
  for (const lang of ["sk", "hu", "en"]) {
    const drop = AlzaCore.formatPriceDrop(lang, "X", 200, 100, "alza_cz");
    const rise = AlzaCore.formatPriceRise(lang, "X", 100, 200, "alza_cz");
    assert.equal(AlzaCore.getChangeTone(drop), "down", drop);
    assert.equal(AlzaCore.getChangeTone(rise), "up", rise);
    const inStock = `${AlzaCore.getAvailabilityLabel("out", lang)} → ${AlzaCore.getAvailabilityLabel("in", lang)}`;
    assert.equal(AlzaCore.getChangeTone(inStock), "down", inStock);
  }
});

test("historie s poškozeným záznamem nespadne", () => {
  const entries = [null, { t: 1, s: 2, a: "in" }, { t: 3, s: 4, p: { original: 10 }, a: "in" }];
  const normalized = AlzaCore.normalizeHistory(entries, "cz");
  assert.equal(normalized.length, 2);
  assert.deepEqual(plain(normalized[0].p), {});
  assert.equal(AlzaCore.mergeHistories([null, { t: 1, s: 1, p: {} }], [undefined]).length, 1);
  assert.equal(AlzaCore.classifyAvailability(42, "cz"), null);
  assert.ok(AlzaCore.formatPrice(undefined, "alza_cz").startsWith("0"));
});

test("cena z detailu: prázdný nebo nečíselný text není cena", () => {
  assert.equal(AlzaCore.parsePositivePrice("Zdarma"), null);
  assert.equal(AlzaCore.parsePositivePrice("0,-"), null);
  assert.equal(AlzaCore.parsePositivePrice("1 299,90 €"), 1299.9);
});

test("stažení mimo Alzu se neopakuje (příznak offsite, ne český text)", () => {
  assert.equal(AlzaCore.isRetryableFetchError({ status: 0, offsite: true, error: "cokoli" }), false);
  assert.equal(AlzaCore.isRetryableFetchError({ status: 0, error: "timeout" }), true);
  assert.equal(AlzaCore.isRetryableFetchError({ status: 404 }), false);
  assert.equal(AlzaCore.isRetryableFetchError({ status: 503 }), true);
});

test("počet kusů i s úzkou mezerou jako oddělovačem tisíců", () => {
  const unitPrice = { value: 0.5, decimals: 2 };
  assert.equal(AlzaCore.getPackCount(["Balení 1 000 ks"], unitPrice, 500, 500), 1000);
});

// === Úložiště ===

function setupStore(storage = {}) {
  const { chrome, context } = loadCore({ storage, files: ["src/shared/store.js"] });
  context.AlzaStore.isWriter = true;
  const reads = [];
  const get = chrome.storage.local.get.bind(chrome.storage.local);
  chrome.storage.local.get = (keys) => {
    reads.push(keys);
    return get(keys);
  };
  return { AlzaStore: context.AlzaStore, data: chrome.storage.local.data, reads };
}

test("migrace bez starých dat nečte celé úložiště", async () => {
  const { AlzaStore, reads } = setupStore({ alzaHistory_alza_cz_1: [{ t: 1, s: 1, p: { original: 1 }, a: "in" }] });
  assert.equal(await AlzaStore.exclusive(() => AlzaStore.migrate()), 0);
  assert.ok(reads.length > 0 && reads.every((keys) => keys !== null), "žádné get(null)");
});

test("import: stejný produkt ve starém i novém formátu se sloučí (minimum zůstane)", async () => {
  const url = "https://www.alza.cz/produkt-d1.htm";
  const { AlzaStore, data } = setupStore();
  await AlzaStore.run({
    type: "importData",
    items: {
      alzaPrices_alza_cz: { [url]: { original: 100, lastUpdated: 20, minPrice: { value: 50, timestamp: 1 } } },
      alzaPrice_alza_cz_1: { original: 90, lastUpdated: 10, url, minPrice: { value: 90, timestamp: 2 } },
    },
  });
  assert.equal(data.alzaPrice_alza_cz_1.minPrice.value, 50);
});

test("patchMap: položka „__proto__“ se tiše neztratí ani nezmění prototyp", async () => {
  const { AlzaStore, data } = setupStore();
  const set = JSON.parse('{"__proto__": {"price": 1}, "alza_cz_1": {"price": 2}}');
  await AlzaStore.run({ type: "patchMap", key: "alzaTargets", set });
  assert.deepEqual(Object.keys(data.alzaTargets), ["alza_cz_1"]);
  assert.equal(data.alzaTargets.price, undefined);
});
