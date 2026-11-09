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
    { price: 400, type: "special", icon: "x", code: null },
    { price: 500, type: "original", icon: null, code: null },
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

test("getChangeTone a kaskáda barvy čísla na ikoně (zlevnění > zdražení > ukončení)", () => {
  const drop = "Benefit: 4 949 Kč → 4 948 Kč (-1 Kč, -0 %)";
  const rise = "Benefit: 405 Kč → 406 Kč (+1 Kč, +0,2 %)";
  const ended = "Nedostupné → Prodej skončil";
  assert.equal(AlzaCore.getChangeTone(drop), "down");
  assert.equal(AlzaCore.getChangeTone(rise), "up");
  assert.equal(AlzaCore.getChangeTone(ended), "off");
  assert.equal(AlzaCore.getChangeTone("Nedostupné → Skladem"), "down");
  assert.equal(AlzaCore.getChangeTone("Nově Akční cena: 1 000 Kč"), "down");
  assert.equal(AlzaCore.getChangeTone("⚠️ podezřelá cena"), "warning");

  const recent = [
    { key: "a", lines: [rise] },
    { key: "b", lines: [drop] },
    { key: "c", lines: [ended] },
  ];
  assert.equal(AlzaCore.getBadgeTone(recent, ["a", "b", "c"]), "down");
  assert.equal(AlzaCore.getBadgeTone(recent, ["a", "c"]), "up");
  assert.equal(AlzaCore.getBadgeTone(recent, ["c"]), "off");
  // Viděné produkty barvu neurčují
  assert.equal(AlzaCore.getBadgeTone(recent, ["c", "x"]), "off");
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

test("findPromoPriceElement: „Koupit s kódem“ se najde u všech typů slevového kódu (i discountcoupon)", () => {
  // Detail OPPO Find X10: <div class="promo-action-prices__row" data-type="discountcoupon"> … 26 490,-
  for (const type of ["discountcode", "discountcoupon", "discountcouponpaywall"]) {
    const price = { textContent: "26 490,-" };
    const row = { querySelector: (selector) => (selector === ".promo-action-prices__price" ? price : null) };
    const doc = { querySelector: (selector) => (selector.split(",").includes(`.promo-action-prices__row[data-type="${type}"]`) ? row : null) };
    const { element, parent } = AlzaCore.findPromoPriceElement(doc, AlzaCore.discountPromoTypes);
    assert.equal(parent, row, type);
    assert.equal(AlzaCore.extractPromoPrice(element, parent, null).price, 26490, type);
  }
  assert.equal(AlzaCore.listingCouponTypes.discountcoupon, "discount");
});

test("parseOrderPurchases: koupené zboží z detailu objednávky, zrušené ne", () => {
  const detail = { parts: [{ created: "2026-11-05T19:27:53.69Z", items: [
    { commodityId: 13583950, commodityName: "OPPO Find X10", commodityUrl: "/oppo-find-x10-d13583950.htm", pricePerItem: "31 490 Kč/ks", count: 2, status: "Vyzvednuto" },
    { commodityId: 5513971, commodityName: "Filament", commodityUrl: "https://www.alza.cz/filament-d5513971.htm?x=1", pricePerItem: "428 Kč/ks", count: 1 },
    { commodityId: 9, commodityName: "Cizí", commodityUrl: "https://evil.example/x-d9.htm", pricePerItem: "10 Kč/ks", count: 1 },
    { commodityId: 7565262, commodityName: "Služba Doprava zboží", commodityUrl: "", pricePerItem: "69 Kč/ks", count: 1 },
    { commodityId: 7360243, commodityName: "Voucher Sleva na dopravné", commodityUrl: "", pricePerItem: "-69 Kč/ks", count: 1 },
    { commodityId: 1, pricePerItem: "", count: 1 },
    { commodityId: 2, pricePerItem: "10 Kč/ks", status: "Zrušeno" },
  ] }] };
  const items = plain(AlzaCore.parseOrderPurchases(detail, "alza_cz"));
  assert.deepEqual(items.map(({ key, url, price, count }) => [key, url, price, count]), [
    ["alza_cz_13583950", "https://www.alza.cz/oppo-find-x10-d13583950.htm", 31490, 2],
    ["alza_cz_5513971", "https://www.alza.cz/filament-d5513971.htm", 428, 1],
  ]);
  assert.equal(items[0].returnUntil - items[0].boughtAt, 14 * DAY);
  assert.equal(AlzaCore.isCancelledOrder("Zrušena"), true);
  assert.equal(AlzaCore.isCancelledOrder("Vyřízena"), false);
});

test("getPurchaseDrop: zlevnění pod nákupní cenu ve lhůtě, každé nové minimum jen jednou", () => {
  const purchase = { price: 31490, returnUntil: NOW + DAY };
  assert.deepEqual(plain(AlzaCore.getPurchaseDrop(purchase, { b2b: 29990, original: 31990 }, NOW)), { lowest: 29990, saving: 1500 });
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { b2b: 31480 }, NOW), null); // pod hranicí 0,5 %
  assert.equal(AlzaCore.getPurchaseDrop({ ...purchase, notifiedPrice: 29990 }, { b2b: 29990 }, NOW), null);
  assert.equal(AlzaCore.getPurchaseDrop({ ...purchase, notifiedPrice: 29990 }, { b2b: 28990 }, NOW).lowest, 28990);
  assert.equal(AlzaCore.getPurchaseDrop({ ...purchase, returnUntil: NOW - 1 }, { b2b: 20000 }, NOW), null); // po lhůtě
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 31990, cashback: 25000 }, NOW), null); // cashback není hned
});

test("updateCodeRegistry: kód ze záznamu do trezoru, bez kódu pryč, since drží u stejného kódu", () => {
  const registry = {};
  assert.equal(AlzaCore.updateCodeRegistry(registry, "alza_cz_1", { discount: { price: 26490, code: "OPPO1" } }, "u", "alza_cz", 100), true);
  assert.deepEqual(plain(registry.alza_cz_1), { code: "OPPO1", price: 26490, url: "u", domain: "alza_cz", since: 100, seenAt: 100 });
  AlzaCore.updateCodeRegistry(registry, "alza_cz_1", { discount: { price: 26000, code: "OPPO1" } }, "u", "alza_cz", 200);
  assert.equal(registry.alza_cz_1.since, 100);
  assert.equal(registry.alza_cz_1.seenAt, 200);
  AlzaCore.updateCodeRegistry(registry, "alza_cz_1", { discount: { price: 26000, code: "NEW2" } }, "u", "alza_cz", 300);
  assert.equal(registry.alza_cz_1.since, 300);
  assert.equal(AlzaCore.updateCodeRegistry(registry, "alza_cz_1", { discount: 25000 }, "u", "alza_cz", 400), true);
  assert.equal(registry.alza_cz_1, undefined);
  assert.equal(AlzaCore.updateCodeRegistry(registry, "alza_cz_2", { original: 1 }, "u", "alza_cz", 400), false);
});

test("getNextQuantityTier: blízký výhodnější stupeň množstevní slevy", () => {
  const tiers = [[1, 1, 509], [2, 2, 489], [3, 4, 469], [5, 100000, 449]];
  assert.deepEqual(plain(AlzaCore.getNextQuantityTier(tiers, 509, 1)), { from: 2, add: 1, unit: 489, current: 509, saving: 40 });
  assert.deepEqual(plain(AlzaCore.getNextQuantityTier(tiers, 509, 3)), { from: 5, add: 2, unit: 449, current: 469, saving: 100 });
  assert.equal(AlzaCore.getNextQuantityTier(tiers, 509, 5), null); // nejvyšší stupeň
  assert.equal(AlzaCore.getNextQuantityTier([[1, 1, 509], [10, 100000, 400]], 509, 1), null); // daleko
  // Kód / AlzaPlus+ je levnější než stupeň – přidávat kusy se nevyplatí
  assert.equal(AlzaCore.getNextQuantityTier(tiers, 450, 1), null);
  assert.equal(AlzaCore.getNextQuantityTier(null, 509, 1), null);
});

test("getPromoCode: kód z odkazu detailOrder, jinak z textu řádku; getPriceEntries ho předá", () => {
  const row = (href, text) => ({ textContent: text, querySelector: () => (href ? { getAttribute: () => href } : null) });
  assert.equal(AlzaCore.getPromoCode(row("javascript:detailOrder(null, null, null, null, 'OPPOX10256GB');", "Koupit s kódem OPPOX10256GB")), "OPPOX10256GB");
  assert.equal(AlzaCore.getPromoCode(row(null, "Koupit s kódem 2026ALZAEXTRA5 Slevový kód vám dává…")), "2026ALZAEXTRA5");
  assert.equal(AlzaCore.getPromoCode(row(null, "Kúpiť s kódom SKKOD10 …")), "SKKOD10");
  assert.equal(AlzaCore.getPromoCode(row("javascript:detailOrder(null, null, null, null, '<b>x</b>');", "bez kódu")), null);
  assert.equal(AlzaCore.getPromoCode(null), null);
  const entries = plain(AlzaCore.getPriceEntries({ discount: { price: 26490, icon: null, code: "OPPOX10256GB" }, b2b: 31490 }));
  assert.deepEqual(entries.map(({ type, code }) => [type, code]), [["discount", "OPPOX10256GB"], ["b2b", null]]);
});

test("getListingDiscount: sleva z nejnižší ceny k zaplacení proti obvyklé, jinak přeškrtnuté ceně", () => {
  // Bez historie proti přeškrtnuté ceně, kód je nejnižší cena k zaplacení; procenta dolů (19,6 → 19)
  assert.deepEqual(plain(AlzaCore.getListingDiscount({ original: 1000, blackfriday: 900, discount: 804 }, [], NOW)), {
    percent: 19, price: 804, reference: 1000, source: "strikethrough", coupon: true,
  });
  // Cashback ani výkup se nezaplatí hned – do slevy se nepočítají
  assert.equal(AlzaCore.getListingDiscount({ original: 1000, cashback: 500 }, [], NOW).percent, 0);
  // Bez slevy, bez ceny
  assert.deepEqual(plain(AlzaCore.getListingDiscount({ original: 500 }, [], NOW)), { percent: 0, price: 500, reference: null, source: null, coupon: false });
  assert.equal(AlzaCore.getListingDiscount({}, [], NOW), null);
  // S historií (aspoň 14 dní) proti obvyklé ceně – vymyšlená přeškrtnutá cena slevu nenafoukne
  const entries = history([[60, 800], [1, 700]], "original");
  const withHistory = AlzaCore.getListingDiscount({ original: 1000, blackfriday: 700 }, entries, NOW);
  assert.equal(withHistory.source, "typical");
  assert.equal(withHistory.reference, 800);
  assert.equal(withHistory.percent, 12);
  // Krátká historie – zpět na přeškrtnutou cenu
  assert.equal(AlzaCore.getListingDiscount({ original: 1000, blackfriday: 700 }, history([[3, 800]]), NOW).source, "strikethrough");
});

test("getComparatorLinks: srovnávače podle domény, název zakódovaný do adresy", () => {
  const cz = plain(AlzaCore.getComparatorLinks("alza_cz", "  AlzaEco All in 1 12v1\n XXL (200 ks) "));
  assert.deepEqual(cz.map(({ id }) => id), ["heureka", "zbozi"]);
  assert.equal(cz[1].url, "https://www.zbozi.cz/hledej/?q=AlzaEco%20All%20in%201%2012v1%20XXL%20(200%20ks)");
  assert.equal(AlzaCore.getComparatorLinks("alza_sk", "a&b=c")[0].url, "https://www.heureka.sk/?h%5Bfraze%5D=a%26b%3Dc");
  assert.deepEqual(plain(AlzaCore.getComparatorLinks("alza_hu", "x").map(({ id }) => id)), ["arukereso"]);
  assert.deepEqual(plain(AlzaCore.getComparatorLinks("alza_cz", "  ")), []);
  assert.deepEqual(plain(AlzaCore.getComparatorLinks("alza_cz", null)), []);
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

test("resolveSaveProblem: zboží bez DPH (knihy) se uloží podle ověření DPH z jiné stránky nebo z historie", async () => {
  const url = "https://www.alza.cz/hracky/kouzelne-cteni-zpivanky-vanocni-koledy-2-d7863643.htm";
  const prices = { original: 249 };
  const now = Date.now();
  // Bez ověření a bez historie zůstane problém
  const empty = loadCore().AlzaCore;
  assert.equal(await empty.resolveSaveProblem("notifyProblemVatUnknown", true, prices, "alza_cz", url), "notifyProblemVatUnknown");
  // Jiný problém nebo stránka se znakem DPH se nedořešuje
  assert.equal(await empty.resolveSaveProblem("notifyProblemNotLogged", true, prices, "alza_cz", url), "notifyProblemNotLogged");
  assert.equal(await empty.resolveSaveProblem("notifyProblemVatUnknown", false, prices, "alza_cz", url), "notifyProblemVatUnknown");
  // Ověření DPH z jiné stránky za poslední hodinu
  const checked = loadCore({ storage: { alzaVatCheck: { alza_cz: { withVat: true, at: now - 60000 } } } }).AlzaCore;
  assert.equal(await checked.resolveSaveProblem("notifyProblemVatUnknown", true, prices, "alza_cz", url), null);
  const withoutVat = loadCore({ storage: { alzaVatCheck: { alza_cz: { withVat: false, at: now - 60000 } } } }).AlzaCore;
  assert.equal(await withoutVat.resolveSaveProblem("notifyProblemVatUnknown", true, prices, "alza_cz", url), "notifyProblemWithoutVat");
  // Stará ověření neplatí
  const stale = loadCore({ storage: { alzaVatCheck: { alza_cz: { withVat: true, at: now - 3 * 60 * 60 * 1000 } } } }).AlzaCore;
  assert.equal(await stale.resolveSaveProblem("notifyProblemVatUnknown", true, prices, "alza_cz", url), "notifyProblemVatUnknown");
});

test("hasListingQuantityDiscount: dlaždice s ikonou „Kup víc, zaplať míň“", () => {
  const item = (html) => ({ querySelector: (selector) => (selector === AlzaCore.listingQuantityDiscount && html.includes("QuantityDiscount") ? {} : null) });
  assert.equal(AlzaCore.hasListingQuantityDiscount(item('<div data-name="QuantityDiscount"></div>')), true);
  assert.equal(AlzaCore.hasListingQuantityDiscount(item("<div></div>")), false);
  assert.equal(AlzaCore.hasListingQuantityDiscount(null), false);
});

test("removeQuantityTierEntries: smaže ceny „od …“ z výpisu (nejvyšší stupeň množstevní slevy) a sloučí stejné sousedy", () => {
  const tiers = [[1, 1, 89], [2, 2, 83], [3, 100000, 76]];
  const entries = [
    { t: 1, s: 2, p: { original: 89 }, a: "in" },
    { t: 3, s: 4, p: { original: 76 }, a: "in" },
    { t: 5, s: 6, p: { original: 89 }, a: "in" },
    { t: 7, s: 8, p: { original: 83 }, a: "in" },
  ];
  assert.equal(AlzaCore.removeQuantityTierEntries(entries, tiers), 1);
  assert.deepEqual(entries.map(({ t, s, p }) => [t, s, p.original]), [[1, 6, 89], [7, 8, 83]]);
  // Bez množstevní slevy nebo bez shody nic
  assert.equal(AlzaCore.removeQuantityTierEntries(entries, null), 0);
  assert.equal(AlzaCore.removeQuantityTierEntries(entries, tiers), 0);
});

// === Připomínka cashbacku ===
const endOfDay = (year, month, day) => new Date(year, month - 1, day, 23, 59, 59).getTime();

test("parseCashbackTerms: lhůta registrace z textu stránek akcí (Canon, Panasonic, OM System, Fujifilm, Sony)", () => {
  const canon =
    "Stačí nakoupit u vybraného partnera a zaregistrovat svůj nákup – a pokud k produktu napíšete recenzi, získáte navíc další cashback. Termín akce Nákup v období: 12. 10. 2026 – 31. 12. 2026 Registrace nejpozději do: 31. 01. 2027 Canon Kalkulačka. Správně vyplňte a odešlete online registrační formulář (včetně platného sériového čísla) nejpozději do 31. 1. 2027. Po ověření žádosti vám společnost Canon zašle peníze přímo na váš bankovní účet (do 28 dnů od schválení).";
  assert.deepEqual(plain(AlzaCore.parseCashbackTerms(canon, null, NOW)), { registerFrom: null, registerUntil: endOfDay(2027, 1, 31) });

  const panasonic =
    "Platnost nákupu: 20. 08. – 13. 11. 2026 Registrace: 19. 09. 2026 – 15. 01. 2027 Pro vybrané modely. Zakupte vybranou techniku v období od 20. 8. do 13. 11. 2026. Počkejte minimálně 30 dní od data nákupu. Zaregistrujte svůj nákup v období od 19. 9. 2026 do 15. 1. 2027.";
  assert.deepEqual(plain(AlzaCore.parseCashbackTerms(panasonic, null, NOW)), { registerFrom: NOW + 30 * DAY, registerUntil: endOfDay(2027, 1, 15) });

  const om = "Nákup v období: 08. 10. 2026 – 01. 11. 2026 Žádosti o cashback do: 15. 11. 2026 Jak získat cashback?";
  assert.equal(AlzaCore.parseCashbackTerms(om, null, NOW).registerUntil, endOfDay(2026, 11, 15));

  const fuji = "Kdy registrovat? Žádost o cashback lze podat nejdříve 4 týdny od data nákupu. Kde registrovat? Registrace probíhá online.";
  assert.deepEqual(plain(AlzaCore.parseCashbackTerms(fuji, null, NOW)), { registerFrom: NOW + 28 * DAY, registerUntil: null });

  const sony =
    "Kupte jeden z vybraných modelů v období od 1. 10. 2026 do 31. 1. 2027. Zaregistrujte svůj nákup a podejte žádost. Všechny formuláře žádostí předložené v rámci akce musí být obdrženy nejpozději do půlnoci dne 28. 2. 2027.";
  assert.equal(AlzaCore.parseCashbackTerms(sony, null, NOW).registerUntil, endOfDay(2027, 2, 28));

  // Lhůta od nákupu; text bez lhůty
  assert.equal(AlzaCore.parseCashbackTerms("Zaregistrujte nákup nejpozději do 30 dnů od data nákupu.", null, NOW).registerUntil, NOW + 30 * DAY);
  assert.deepEqual(plain(AlzaCore.parseCashbackTerms("Akce byla ukončena.", null, NOW)), { registerFrom: null, registerUntil: null });
});

test("parseCashbackTerms: na stránce s víc akcemi jen text od názvu akce", () => {
  const text = "Letní akce Registrace nejpozději do 15. 11. 2026. Zimní Cashback Canon Registrace nejpozději do: 31. 01. 2027";
  assert.equal(AlzaCore.parseCashbackTerms(text, null, NOW).registerUntil, endOfDay(2026, 11, 15));
  assert.equal(AlzaCore.parseCashbackTerms(text, "Zimní Cashback Canon", NOW).registerUntil, endOfDay(2027, 1, 31));
});

test("updateCashbackRegistry: cashback s podmínkami, vrácená částka, záznam zůstane i po konci akce", () => {
  const registry = { alza_cz_9: { seenAt: NOW - 61 * DAY } };
  const record = { original: 48990, cashback: { price: 44490, terms: "/cashback-akce-canon?x=1", title: "Zimní Cashback" } };
  assert.equal(AlzaCore.updateCashbackRegistry(registry, "alza_cz_1", record, "alza_cz", NOW), true);
  assert.equal(registry.alza_cz_9, undefined); // starý záznam smazán
  assert.deepEqual(plain(registry.alza_cz_1), {
    terms: "https://www.alza.cz/cashback-akce-canon",
    title: "Zimní Cashback",
    price: 44490,
    refund: 4500,
    domain: "alza_cz",
    since: NOW,
    seenAt: NOW,
  });
  // Bez cashbacku nic nemaže, odkaz mimo Alzu se nepřevezme
  assert.equal(AlzaCore.updateCashbackRegistry(registry, "alza_cz_1", { original: 48990 }, "alza_cz", NOW + DAY), false);
  AlzaCore.updateCashbackRegistry(registry, "alza_cz_2", { original: 100, cashback: { price: 80, terms: "https://evil.example/x" } }, "alza_cz", NOW);
  assert.equal(registry.alza_cz_2.terms, null);
});

test("getPurchaseCashback: cashback platil kolem data nákupu", () => {
  const purchase = { boughtAt: NOW };
  const entry = { price: 100, since: NOW - 20 * DAY, seenAt: NOW - 2 * DAY };
  assert.equal(AlzaCore.getPurchaseCashback(purchase, entry), entry);
  assert.equal(AlzaCore.getPurchaseCashback(purchase, { ...entry, seenAt: NOW - 8 * DAY }), null); // naposledy viděný dávno před nákupem
  assert.equal(AlzaCore.getPurchaseCashback(purchase, { ...entry, since: NOW + 3 * DAY, seenAt: NOW + 3 * DAY }), null); // akce až po nákupu
  assert.equal(AlzaCore.getPurchaseCashback(purchase, null), null);
});

test("getCashbackReminderStep: otevřená registrace, blížící se konec, prošlá lhůta, hotovo", () => {
  const reminder = { boughtAt: NOW, registerFrom: null, registerUntil: NOW + 60 * DAY };
  assert.equal(AlzaCore.getCashbackReminderStep(reminder, NOW), "open");
  assert.equal(AlzaCore.getCashbackReminderStep({ ...reminder, notifiedOpen: true }, NOW), null);
  assert.equal(AlzaCore.getCashbackReminderStep({ ...reminder, notifiedOpen: true }, NOW + 54 * DAY), "soon");
  assert.equal(AlzaCore.getCashbackReminderStep({ ...reminder, notifiedOpen: true, notifiedSoon: true }, NOW + 54 * DAY), null);
  assert.equal(AlzaCore.getCashbackReminderStep({ ...reminder, registerFrom: NOW + 30 * DAY }, NOW + DAY), null); // ještě nejde registrovat
  assert.equal(AlzaCore.getCashbackReminderStep({ ...reminder, done: true }, NOW), null);
  // Podmínky akce se ještě nenačetly – počkat; po vyčerpání pokusů upozornit i bez lhůty
  const pending = { boughtAt: NOW, terms: "https://www.alza.cz/akce", termsRead: false, termsTries: 1 };
  assert.equal(AlzaCore.getCashbackReminderStep(pending, NOW), null);
  assert.equal(AlzaCore.getCashbackReminderStep({ ...pending, termsTries: AlzaCore.cashbackTermsTries }, NOW), "open");
  assert.equal(AlzaCore.getCashbackReminderStep(reminder, NOW + 61 * DAY), "expired");
  assert.equal(AlzaCore.getCashbackReminderStep({ boughtAt: NOW }, NOW + 121 * DAY), "expired"); // bez známé lhůty
});

test("readCashbackTerms + getCashbackDates: konec nákupu, registrace dnes i pro nákup, skončená akce", () => {
  const canon =
    "Termín akce Nákup v období: 12. 10. 2026 – 31. 12. 2026 Registrace nejpozději do: 31. 01. 2027. Zakupte vybraný produkt Canon u vybraného partnera v období od 12. 10. do 31. 12. 2026. Správně vyplňte a odešlete online registrační formulář nejpozději do 31. 1. 2027.";
  const terms = plain(AlzaCore.readCashbackTerms(canon, null, NOW));
  assert.deepEqual(terms.purchaseEnds, [endOfDay(2026, 12, 31)]);
  const today = AlzaCore.getCashbackDates(terms, NOW);
  assert.equal(today.purchaseUntil, endOfDay(2026, 12, 31));
  assert.equal(today.purchaseEnded, null);
  assert.equal(today.registerUntil, endOfDay(2027, 1, 31));
  // Nákup po konci akce
  const late = AlzaCore.getCashbackDates(terms, Date.UTC(2027, 0, 5, 12));
  assert.equal(late.purchaseEnded, endOfDay(2026, 12, 31));

  // Platnost celé akce = období nákupu; registrace do 30 dní od nákupu (HP)
  const hp =
    "Získejte zpět až 1 200 Kč s promoakcí HP Cashback. Akce je platná od 1. 5. 2026 do 31. 1. 2027 na vybrané produkty. Pořiďte si některou z tiskáren v promoakci (seznam vypsán níže). Zaregistrujte svůj nákup do 30 dní na www.hp.com/cz/cashback . Tiskárna musí být zakoupena v termínu promoakce a registrována do 30 dní od nákupu.";
  const hpTerms = AlzaCore.readCashbackTerms(hp, null, NOW);
  assert.deepEqual(plain(hpTerms.purchaseEnds), [endOfDay(2027, 1, 31)]);
  assert.equal(hpTerms.registerDays, 30);

  // „Zaregistrujte svůj nákup v období od … do …“ je období registrace, ne nákupu
  const panasonic =
    "Platnost nákupu: 20. 08. – 13. 11. 2026 Registrace: 19. 09. 2026 – 15. 01. 2027. Počkejte minimálně 30 dní od data nákupu. Zaregistrujte svůj nákup v období od 19. 9. 2026 do 15. 1. 2027.";
  const pana = AlzaCore.readCashbackTerms(panasonic, null, NOW);
  assert.deepEqual(plain(pana.purchaseEnds), [endOfDay(2026, 11, 13)]);
  assert.equal(pana.waitDays, 30);
});

test("readCashbackTerms: měsíce slovy, „nejdříve 15. den“, popisek řádku; odkaz bez www", () => {
  const aeg =
    "Stačí si v období od 2. listopadu 2026 do 3. ledna 2027 zakoupit některý ze zapojených modelů, napsat na něj recenzi a následně svůj nákup zaregistrovat. Následně navštivte registrační stránku www.aeg.cz/specialni-nabidka. Registraci je možné provést nejdříve 15. den od data nákupu, nejpozději však do 3. 2. 2027.";
  const terms = plain(AlzaCore.readCashbackTerms(aeg, null, NOW));
  assert.deepEqual(terms.purchaseEnds, [endOfDay(2027, 1, 3)]);
  assert.equal(terms.waitDays, 15);
  assert.equal(AlzaCore.getCashbackDates(terms, NOW).registerUntil, endOfDay(2027, 2, 3));

  // Popisek řádku cashbacku doplní, co stránka akce nemá
  const fromTitle = AlzaCore.readCashbackTerms("Získejte zpět část peněz při nákupu vybraných produktů. Akce platí do 3. 1. 2027 nebo do vyprodání zásob.", null, NOW);
  const merged = plain(AlzaCore.mergeCashbackTerms({ purchaseEnds: [], registerEnds: [], registerDays: 30, waitDays: 0 }, fromTitle));
  assert.deepEqual(merged.purchaseEnds, [endOfDay(2027, 1, 3)]);
  assert.equal(merged.registerDays, 30);
  assert.equal(AlzaCore.hasCashbackTerms({ purchaseEnds: [], registerEnds: [], registerDays: null, waitDays: 0 }), false);

  assert.equal(
    AlzaCore.resolveCashbackTerms("https://alza.cz/ziskejte-penize-zpet-za-nakup-domacich-spotrebicu-aeg?x=1", "alza_cz"),
    "https://www.alza.cz/ziskejte-penize-zpet-za-nakup-domacich-spotrebicu-aeg"
  );
  assert.equal(AlzaCore.resolveCashbackTerms("https://www.aeg.cz/cashback", "alza_cz"), null);
});

test("formatTextDate: datum podle jazyka textu, ne podle domény", () => {
  const time = new Date(2026, 10, 18).getTime();
  assert.equal(AlzaCore.formatTextDate(time, "en"), "18/11");
  assert.equal(AlzaCore.formatTextDate(time, "cz").replace(/\s/g, " "), "18. 11.");
  assert.equal(AlzaCore.formatTextDate(time, "en", true), "18/11/2026");
});
