// Testy čisté logiky AlzaCore (src/shared/core.js): node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");

const { AlzaCore } = loadCore();
const DAY = AlzaCore.dayMs;
const NOW = Date.UTC(2026, 10, 6, 12);
// Objekty z vm kontextu mají jiné prototypy – porovnávat přes JSON
const plain = (value) => JSON.parse(JSON.stringify(value));

// Historie z úseků [začátek ve dnech před NOW, cena]; poslední kontrola = NOW
function history(segments, type = "original") {
  return segments.map(([daysAgo, price], index) => {
    const t = NOW - daysAgo * DAY;
    const next = segments[index + 1];
    const s = next ? NOW - next[0] * DAY - 1000 : NOW;
    return { t, s, p: price === null ? {} : { [type]: price }, a: "in" };
  });
}

test("getDailyRunTimes: dnes, nebo zítra ve zvolený čas a poslední čas před ním", () => {
  const at = (day, hours, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();
  assert.deepEqual(plain(AlzaCore.getDailyRunTimes("08:00", at(6, 7, 59))), { next: at(6, 8), previous: at(5, 8) });
  assert.deepEqual(plain(AlzaCore.getDailyRunTimes("08:00", at(6, 8))), { next: at(7, 8), previous: at(6, 8) });
  assert.deepEqual(plain(AlzaCore.getDailyRunTimes("nesmysl", at(6, 9))), { next: at(7, 8), previous: at(6, 8) });
});

test("getCheckPeriodMinutes: neznámá frekvence = každou hodinu, jednou denně bez periody", () => {
  assert.equal(AlzaCore.getCheckPeriodMinutes({ checkSchedule: "6h" }), 360);
  assert.equal(AlzaCore.getCheckPeriodMinutes({ checkSchedule: "daily" }), null);
  assert.equal(AlzaCore.getCheckPeriodMinutes({ checkSchedule: "xx" }), 60);
  assert.equal(AlzaCore.getCheckPeriodMinutes({}), 60);
});

test("fillTemplate nahradí parametry jen jednou a nevykládá $&", () => {
  assert.equal(AlzaCore.fillTemplate("{0} a {1}", ["{1}", "$&"]), "{1} a $&");
  assert.equal(AlzaCore.fillTemplate("{0} {2}", ["x"]), "x {2}");
});

test("translate: neznámý jazyk a klíč spadnou na češtinu a klíč", () => {
  assert.equal(AlzaCore.translate("xx", "inStock"), "Skladem");
  assert.equal(AlzaCore.translate("sk", "nonexistentKey"), "nonexistentKey");
});

test("isAlzaUrl / isKnownDomain", () => {
  assert.equal(AlzaCore.isAlzaUrl("https://www.alza.cz/x-d1.htm"), true);
  assert.equal(AlzaCore.isAlzaUrl("http://www.alza.cz/x-d1.htm"), false);
  assert.equal(AlzaCore.isAlzaUrl("https://www.alza.cz.evil.com/"), false);
  assert.equal(AlzaCore.isAlzaUrl("javascript:alert(1)"), false);
  assert.equal(AlzaCore.isKnownDomain("alza_sk"), true);
  assert.equal(AlzaCore.isKnownDomain("constructor"), false);
  assert.equal(AlzaCore.isKnownDomain(undefined), false);
});

test("getProductId / getProductKey z různých tvarů adresy", () => {
  assert.equal(AlzaCore.getProductId("https://www.alza.cz/iphone-d123456.htm?o=1"), "123456");
  assert.equal(AlzaCore.getProductId("https://www.alza.cz/kabely?dq=987"), "987");
  assert.equal(AlzaCore.getProductKey("alza_cz", "https://www.alza.cz/a-d5.htm"), "alza_cz_5");
  assert.equal(AlzaCore.getHistoryKey("alza_sk", "https://www.alza.sk/a-d5.htm"), "alzaHistory_alza_sk_5");
});

test("parsePrice, toNumber, parsePriceDifference", () => {
  assert.equal(AlzaCore.parsePrice("29 490,-"), 29490);
  assert.equal(AlzaCore.parsePrice("1 299,90 €"), 1299.9);
  assert.equal(AlzaCore.toNumber("9 549 Kč"), 9549);
  assert.ok(Number.isNaN(AlzaCore.toNumber(null)));
  assert.equal(AlzaCore.parsePriceDifference("+ 105,-"), 105);
  assert.equal(AlzaCore.parsePriceDifference("- 72,-"), -72);
});

test("formatPrice a formatPercent", () => {
  assert.equal(AlzaCore.formatPrice(1299, "alza_cz").replace(/\s/g, " "), "1 299 Kč");
  assert.equal(AlzaCore.formatPrice(12.5, "alza_sk").replace(/\s/g, " "), "12,50 €");
  assert.equal(AlzaCore.formatPercent(0.25, "alza_cz"), "0,3");
  assert.equal(AlzaCore.formatPercent(12.4, "alza_cz"), "12");
});

test("isQuietTime přes půlnoc i v rámci dne", () => {
  const at = (h, m = 0) => new Date(2026, 0, 1, h, m);
  const night = { quietHours: true, quietFrom: "22:00", quietTo: "07:00" };
  assert.equal(AlzaCore.isQuietTime(night, at(23)), true);
  assert.equal(AlzaCore.isQuietTime(night, at(6, 59)), true);
  assert.equal(AlzaCore.isQuietTime(night, at(7)), false);
  assert.equal(AlzaCore.isQuietTime({ ...night, quietFrom: "13:00", quietTo: "14:00" }, at(13, 30)), true);
  assert.equal(AlzaCore.isQuietTime({ ...night, quietHours: false }, at(23)), false);
});

test("getPlausibleLowest zahodí cenu pod polovinou nejbližší vyšší", () => {
  assert.equal(AlzaCore.getPlausibleLowest([776, 29490, 29990]), 29490);
  assert.equal(AlzaCore.getPlausibleLowest([73, 120, 199]), 73);
  assert.equal(AlzaCore.getPlausibleLowest([]), null);
});

test("getPriceEntries ignoruje meta klíče a NEO, řadí vzestupně", () => {
  const entries = AlzaCore.getPriceEntries({ original: 500, special: { price: 400, icon: "x" }, neo: 50, lastUpdated: 1, minPrice: { value: 1 } });
  assert.deepEqual(plain(entries), [
    { price: 400, type: "special", icon: "x" },
    { price: 500, type: "original", icon: null },
  ]);
});

test("getPayNowPrice bez cashbacku a výkupu", () => {
  assert.equal(AlzaCore.getPayNowPrice({ original: 1000, cashback: 800, scrappage: 700 }), 1000);
  assert.equal(AlzaCore.getPayNowPrice({ cashback: 800 }), null);
});

test("mergePriceRecord: min/max, prodejní maximum a šipka změny", () => {
  const record = AlzaCore.mergePriceRecord({}, { original: 1000, special: 900 }, "list1", 1000);
  assert.equal(record.minPrice.value, 900);
  assert.equal(record.maxPrice.value, 1000);
  assert.equal(record.maxLowestPrice.value, 900);
  assert.equal(record.oldLowestPrice, 900);
  assert.equal(record.newLowestPrice, undefined);
  assert.equal(record.lastUpdated, 1000);
  assert.equal(record.listId, "list1");

  AlzaCore.mergePriceRecord(record, { original: 1000, special: 800 }, null, 2000);
  assert.equal(record.minPrice.value, 800);
  assert.equal(record.newLowestPrice, 800);
  assert.equal(record.listId, "list1"); // listId se nepřepíše null

  AlzaCore.mergePriceRecord(record, { original: 1000 }, null, 3000);
  assert.equal(record.special, undefined); // zmizelá akce se smaže
  assert.equal(record.oldLowestPrice, 800);
  assert.equal(record.newLowestPrice, 1000);
  assert.equal(record.maxLowestPrice.value, 1000);
});

test("mergePriceRecord: nesmyslně nízká cena se nepromítne do minima", () => {
  const record = AlzaCore.mergePriceRecord({}, { original: 29490, neoLike: 776 }, null, 1);
  assert.equal(record.minPrice.value, 29490);
});

test("appendHistory: stejný stav posune kontrolu, změna založí záznam, název", () => {
  const entries = [];
  AlzaCore.appendHistory(entries, { original: 100 }, "in", undefined, { now: 1, name: "A" });
  AlzaCore.appendHistory(entries, { original: 100 }, "in", undefined, { now: 2, name: "A" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].s, 2);
  AlzaCore.appendHistory(entries, { original: 90 }, "in", undefined, { now: 3, name: "A" });
  assert.equal(entries.length, 2);
  assert.equal(entries[1].n, undefined); // název se nezměnil
  AlzaCore.appendHistory(entries, { original: 90 }, "in", undefined, { now: 4, name: "B" });
  assert.equal(entries.length, 3);
  assert.equal(entries[2].n, "B");
  assert.equal(AlzaCore.getLatestName(entries), "B");
});

test("appendHistory: první záznam navazuje na uložené ceny seznamu", () => {
  const entries = [];
  AlzaCore.appendHistory(entries, { original: 90 }, "in", { original: 100, lastUpdated: 5 }, { now: 10 });
  assert.equal(entries.length, 2);
  assert.deepEqual(plain(entries[0].p), { original: 100 });
  assert.equal(entries[0].t, 5);
});

test("ořez historie zachová poslední platný název", () => {
  const entries = [];
  for (let i = 0; i < AlzaCore.historyMaxEntries + 5; i++) {
    AlzaCore.appendHistory(entries, { original: 100 + (i % 2) }, "in", undefined, { now: i + 1, name: i === 0 ? "Jediný název" : null });
  }
  assert.equal(entries.length, AlzaCore.historyMaxEntries);
  assert.equal(AlzaCore.getLatestName(entries), "Jediný název");

  const listing = [];
  for (let i = 0; i < AlzaCore.historyMaxEntries + 5; i++) {
    AlzaCore.appendListingObservation(listing, { original: 100 + (i % 2) }, "in", { now: i + 1, name: "Výpis" });
  }
  assert.equal(listing.length, AlzaCore.historyMaxEntries);
  assert.equal(AlzaCore.getLatestName(listing), "Výpis");
});

test("appendListingObservation porovná jen ceny, které výpis ukazuje", () => {
  const entries = [{ t: 1, s: 1, p: { original: 100, cashback: 80 }, a: "in" }];
  // Výpis neukazuje cashback – shoda hlavní ceny jen posune kontrolu
  assert.equal(AlzaCore.appendListingObservation(entries, { original: 100 }, "in", { now: 5 }), true);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].s, 5);
  AlzaCore.appendListingObservation(entries, { original: 90 }, null, { now: 6 });
  assert.equal(entries.length, 2);
  assert.equal(entries[1].a, "in"); // neznámá dostupnost převezme poslední
  assert.equal(AlzaCore.appendListingObservation(entries, {}, "in", { now: 7 }), false);
});

test("normalizeHistory překlasifikuje text dostupnosti a sloučí shodné záznamy", () => {
  const entries = [
    { t: 1, s: 1, p: { original: 100 }, a: "Na cestě 1 ks" },
    { t: 2, s: 2, p: { original: 100 }, a: "expected" },
  ];
  const result = AlzaCore.normalizeHistory(entries, "cz");
  assert.equal(result.length, 1);
  assert.equal(result[0].a, "expected");
  assert.equal(result[0].s, 2);
});

test("classifyAvailability a getAvailabilityLabel", () => {
  assert.equal(AlzaCore.classifyAvailability("Skladem > 5 ks", "cz"), "in");
  assert.equal(AlzaCore.classifyAvailability("Skladom", "sk"), "in");
  assert.equal(AlzaCore.classifyAvailability("Raktáron", "hu"), "in");
  assert.equal(AlzaCore.classifyAvailability("Prodej skončil", "cz"), "ended");
  assert.equal(AlzaCore.classifyAvailability(null, "cz"), null);
  assert.equal(AlzaCore.getAvailabilityLabel("order", "en"), "On order");
});

test("getPriceVerdict: obvyklá cena, nejnižší, akce", () => {
  // 100 dní za 1000, 10 dní akce za 800, 30 dní 1000, teď 800
  const entries = history([[140, 1000], [40, 800], [30, 1000], [0, 800]]);
  const verdict = AlzaCore.getPriceVerdict(entries, 800, NOW);
  assert.equal(verdict.typical, 1000);
  assert.equal(verdict.level, "lowest");
  assert.equal(verdict.sales.count, 2);
  assert.equal(AlzaCore.getPriceVerdict(entries, 1100, NOW).level, "high");
  assert.equal(AlzaCore.getPriceVerdict(entries, 1000, NOW).level, "usual");
  assert.equal(AlzaCore.getPriceVerdict(history([[5, 1000]]), 1000, NOW), null); // málo historie
});

test("getSaleCycle: pravidelné akce → vyplatí se počkat", () => {
  // Akce každých 30 dní na 5 dní za 800, jinak 1000; poslední akce skončila před 20 dny
  const segments = [[170, 1000]];
  for (let start = 150; start >= 30; start -= 30) segments.push([start, 800], [start - 5, 1000]);
  const cycle = AlzaCore.getSaleCycle(history(segments), 1000, NOW);
  assert.ok(cycle, "rytmus se má najít");
  assert.equal(cycle.regular, true);
  assert.ok(Math.abs(cycle.interval - 30) < 0.01);
  assert.ok(Math.abs(cycle.duration - 5) < 0.1);
  assert.equal(cycle.onSale, false);
  assert.equal(cycle.wait, true);
});

test("getDiscountWarning: sleva vyšší než nejnižší cena za 30 dní", () => {
  const entries = history([[25, 900], [10, 1000]]);
  const warning = AlzaCore.getDiscountWarning(entries, { original: 1200, special: 1000 }, NOW);
  assert.equal(warning.value, 900);
  assert.equal(AlzaCore.getDiscountWarning(entries, { original: 1200, special: 880 }, NOW), null);
});

test("getStrikethroughWarning: přeškrtnutá cena, za kterou se nikdy neprodávalo", () => {
  const entries = history([[60, 1000], [0, 900]]);
  const warning = AlzaCore.getStrikethroughWarning(entries, { original: 1500, special: 900 }, NOW);
  assert.equal(warning.never, true);
  assert.equal(AlzaCore.getStrikethroughWarning(entries, { original: 1000, special: 900 }, NOW), null);
});

test("getSuspiciousPrices: gap a jump", () => {
  const gap = AlzaCore.getSuspiciousPrices([], { original: 29490, special: 776 }, NOW);
  assert.equal(gap[0].reason, "gap");
  const entries = history([[30, 1000], [0, 400]]);
  const jump = AlzaCore.getSuspiciousPrices(entries, { original: 400 }, NOW);
  assert.equal(jump[0]?.reason, "jump");
});

test("evaluateTarget ohlásí cíl jen při překročení dolů", () => {
  assert.deepEqual(plain(AlzaCore.evaluateTarget({ price: 100, below: false }, 90)), { below: true, reached: true });
  assert.deepEqual(plain(AlzaCore.evaluateTarget({ price: 100, below: true }, 90)), { below: true, reached: false });
  assert.deepEqual(plain(AlzaCore.evaluateTarget({ price: 100, below: true }, 110)), { below: false, reached: false });
});

test("getQuantityTiers a getQuantityUnitPrice", () => {
  const tiers = [[1, 4, 10], [5, 100000, 8]];
  assert.deepEqual(plain(AlzaCore.getQuantityTiers({ quantityTiers: tiers })), tiers);
  assert.equal(AlzaCore.getQuantityTiers({ quantityTiers: [[1, 4, 10]] }), null);
  assert.equal(AlzaCore.getQuantityTiers({ quantityTiers: [[1, 4, "x"], [5, 9, 8]] }), null);
  assert.equal(AlzaCore.getQuantityUnitPrice(tiers, 9, 6), 8);
  assert.equal(AlzaCore.getQuantityUnitPrice(tiers, 7, 6), 7); // nejnižší nabízená cena je nižší
});

test("parseUnitPrice, getPackCount, parseVariantSize", () => {
  const unit = AlzaCore.parseUnitPrice("3,50 Kč/ks");
  assert.equal(unit.value, 3.5);
  assert.equal(unit.decimals, 2);
  assert.equal(unit.unit, "ks");
  assert.equal(AlzaCore.parseUnitPrice("nic"), null);
  assert.equal(AlzaCore.getPackCount(["360 ks v balení"], unit, 1260, 1260), 360);
  assert.equal(AlzaCore.getPackCount(["vel. 4 152 ks"], AlzaCore.parseUnitPrice("2,00 Kč/ks"), 304, 304), 152);
  assert.equal(AlzaCore.getPackCount(["10 ks"], unit, 1260, 1260), null);
  assert.deepEqual(plain(AlzaCore.parseVariantSize("500 g")), { amount: 0.5, unit: "kg" });
  assert.deepEqual(plain(AlzaCore.parseVariantSize("Sparkle 120 ks")), { amount: 120, unit: "ks" });
  assert.deepEqual(plain(AlzaCore.parseVariantSize("2× 60 ks")), { amount: 120, unit: "ks" });
  assert.deepEqual(plain(AlzaCore.parseVariantSize("50 cm")), { amount: 0.5, unit: "m" });
  assert.equal(AlzaCore.parseVariantSize("černá"), null);
});

test("getCheaperConditions proti vlastní nejnižší ceně", () => {
  const conditions = { current: "new", prices: { new: 1000, unpacked: 900, used: 950 } };
  assert.deepEqual(plain(AlzaCore.getCheaperConditions(conditions).map(({ condition }) => condition)), ["unpacked", "used"]);
  assert.deepEqual(plain(AlzaCore.getCheaperConditions(conditions, 920).map(({ condition }) => condition)), ["unpacked"]);
});

test("upgradePriceDropText převede starý tvar poklesu", () => {
  const text = AlzaCore.upgradePriceDropText("Benefit: 228 Kč → 226 Kč (-1 %)", "https://www.alza.cz/x-d1.htm");
  assert.match(text, /^Benefit: 228 Kč → 226 Kč \(-2 Kč, -0,9 %\)$/);
  assert.equal(AlzaCore.upgradePriceDropText("jiný text", "https://www.alza.cz/x-d1.htm"), "jiný text");
});

test("findStaleProducts: nehlídané a staré, hlídané nikdy", () => {
  const old = NOW - 100 * DAY;
  const all = {
    alzaHistory_alza_cz_1: [{ t: old, s: old, p: { original: 1 }, a: "in" }],
    alzaHistory_alza_cz_2: [{ t: old, s: old, p: { original: 1 }, a: "in" }],
    alzaHistory_alza_cz_3: [{ t: NOW, s: NOW, p: { original: 1 }, a: "in" }],
    alzaHistory_alza_cz_4: [{ t: old, s: old, p: { original: 1 }, a: "in" }],
    alzaTargets: { alza_cz_2: { price: 1 } },
    alzaBrowsed: { alza_cz_4: { seenAt: old } }, // z procházení – lhůta rok
  };
  assert.deepEqual(plain(AlzaCore.findStaleProducts(all, NOW).map(({ key }) => key)), ["alza_cz_1"]);
});

test("getLoginState a getVatState podle znaků v dokumentu", () => {
  const doc = (matches) => ({
    querySelector: (selector) => matches[selector] ?? null,
    querySelectorAll: () => [],
  });
  assert.equal(AlzaCore.getLoginState(doc({ "[data-api-url*='/v1/anonymous/']": {} })), false);
  assert.equal(AlzaCore.getLoginState(doc({ ".userIsLogged, [data-api-url*='/v1/users/']": {} })), true);
  assert.equal(AlzaCore.getLoginState(doc({})), null);
});
