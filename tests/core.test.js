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
  assert.deepEqual(plain(AlzaCore.getPurchaseDrop(purchase, { b2b: 29990, original: 31990 }, NOW)), { lowest: 29990, saving: 1500, reference: 31490 });
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

test("parseCommodityList: obsah seznamu z API – nové a odebrané položky, uložená adresa zůstane", () => {
  const item = (id, name) => ({ id, name, navigationUrl: `https://www.alza.cz/produkt-d${id}.htm`, img: `https://image.alza.cz/${id}.jpg` });
  const json = (items, extra = {}) => ({ err: 0, data: [{ id: 35851306, name: " Elektro ", itemCount: items.length, items, ...extra }] });
  const list = {
    domain: "alza_cz",
    listId: "35851306",
    products: {
      "https://www.alza.cz/stary-nazev-d1.htm?o=2": { name: "Jedna", image: null },
      "https://www.alza.cz/pryc-d3.htm": { name: "Tři", image: null },
    },
  };
  const result = plain(AlzaCore.parseCommodityList(json([item(1, "Jedna nová"), item(2, "Dvě")]), list));
  assert.equal(result.name, "Elektro");
  assert.deepEqual(Object.keys(result.products), ["https://www.alza.cz/stary-nazev-d1.htm?o=2", "https://www.alza.cz/produkt-d2.htm"]);
  assert.deepEqual(result.products["https://www.alza.cz/produkt-d2.htm"], { name: "Dvě", image: "https://image.alza.cz/2.jpg" });
  assert.deepEqual(result.added, ["Dvě"]);
  assert.deepEqual(result.removed, ["Tři"]);
  // Prázdný seznam s itemCount 0 = opravdu prázdný
  assert.deepEqual(plain(AlzaCore.parseCommodityList(json([]), list)).removed, ["Jedna", "Tři"]);
});

test("parseCommodityList: neúplná nebo cizí odpověď → null (zůstane uložený obsah)", () => {
  const list = { domain: "alza_cz", listId: "5", products: {} };
  const items = [{ id: 1, name: "A", navigationUrl: "https://www.alza.cz/a-d1.htm" }];
  assert.equal(AlzaCore.parseCommodityList({ err: 1, data: [] }, list), null);
  assert.equal(AlzaCore.parseCommodityList({ err: 0, data: [{ id: 6, itemCount: 1, items }] }, list), null);
  assert.equal(AlzaCore.parseCommodityList({ err: 0, data: [{ id: 5, itemCount: 2, items }] }, list), null);
  assert.equal(AlzaCore.parseCommodityList({ err: 0, data: [{ id: 5, itemCount: 1, items: null }] }, list), null);
  assert.equal(AlzaCore.parseCommodityList("<html>", list), null);
  assert.equal(AlzaCore.parseCommodityList({ err: 0, data: [{ id: 5, itemCount: 1, items }] }, { ...list, domain: "neznama" }), null);
  // Položka mimo doménu seznamu se přeskočí, nic se nepřidá
  const foreign = [{ id: 1, name: "A", navigationUrl: "https://www.alza.sk/a-d1.htm" }];
  assert.deepEqual(plain(AlzaCore.parseCommodityList({ err: 0, data: [{ id: 5, itemCount: 1, items: foreign }] }, list)).products, {});
});

test("isOriginalSuperseded: běžná cena platí dál, když je levněji jen s cashbackem nebo výkupem", () => {
  assert.equal(AlzaCore.isOriginalSuperseded({ scrappage: 28990, original: 31490 }), false);
  assert.equal(AlzaCore.isOriginalSuperseded({ cashback: 900, scrappage: 800, original: 1000 }), false);
  assert.equal(AlzaCore.isOriginalSuperseded({ cashback: 900, aplus: 950, original: 1000 }), true);
  assert.equal(AlzaCore.isOriginalSuperseded({ discount: 26490, aplus: 31490, original: 31990 }), true);
  assert.equal(AlzaCore.isOriginalSuperseded({ original: 1000 }), false);
  assert.equal(AlzaCore.isOriginalSuperseded({ benefit: 900 }), false);
});

test("getListingParameter: kapacita z popisku dlaždice – úložiště, RAM, powerbanky, nabíjecí stanice", () => {
  const parameter = (name, description) => plain(AlzaCore.getListingParameter(name, description));
  // Disky v TB, i slovensky (dlouhá pomlčka) a maďarsky ("GB-os tárolókapacitás")
  assert.deepEqual(parameter("Samsung 990 PRO 4TB", "SSD disk 4000 GB - M.2 (PCIe 4.0 4x NVMe), TLC"), { quantity: 4, unit: "TB", amount: 4000, amountUnit: "GB" });
  assert.deepEqual(parameter("WD Elements", "Externý disk 500 GB – HDD úložisko, formát 2.5\""), { quantity: 0.5, unit: "TB", amount: 500, amountUnit: "GB" });
  assert.deepEqual(parameter("Samsung 990 EVO Plus 2TB", "SSD meghajtó 2000 GB-os tárolókapacitás - M.2 (PCIe 4.0 4x NVMe)"), { quantity: 2, unit: "TB", amount: 2000, amountUnit: "GB" });
  assert.equal(parameter("Kingston XS2000", "Külső merevlemez 2000 GB - SSD tárhely").unit, "TB");
  // Flash disky a karty v GB
  assert.deepEqual(parameter("Kingston Exodia 256GB", "Flash disk 256 GB - USB 3.2 Gen 1 (USB 3.0), konektor USB-A"), { quantity: 256, unit: "GB", amount: 256, amountUnit: "GB" });
  assert.equal(parameter("Verbatim", "USB kľúč 16 GB – USB 2.0").unit, "GB");
  assert.equal(parameter("SanDisk", "Pendrive 512 GB - USB 3.2 Gen 1 (USB 3.0)").quantity, 512);
  assert.equal(parameter("Kingston", "Paměťová karta 128 GB - micro SDXC a micro SD, rychlost čtení až 200 MB/s").quantity, 128);
  // RAM: moduly × kapacita
  assert.deepEqual(parameter("Kingston FURY 32GB KIT DDR5", "Operační paměť - 2 × 16GB v balení, typ DDR5, frekvence 6000 MHz"), { quantity: 32, unit: "GB", amount: 32, amountUnit: "GB" });
  assert.equal(parameter("Kingston", "Operačná pamäť – 2× 16 GB v balení").quantity, 32);
  assert.equal(parameter("Kingston", "Operační paměť - 1x16GB, typ DDR4").quantity, 16);
  assert.equal(parameter("Kingston", "RAM memória - 2 × 16GB a csomagban").quantity, 32);
  // Powerbanky za 1000 mAh; bez kapacity v popisku nic
  assert.deepEqual(parameter("Swissten", "Powerbanka bezdrátová 20000 mAh - MagSafe, celkový výkon 20 W"), { quantity: 20, unit: "1000 mAh", amount: 20000, amountUnit: "mAh" });
  assert.equal(parameter("Hama", "Power bank 10000 mAh - 45 W teljes teljesítmény").quantity, 10);
  assert.equal(parameter("AlzaPower Parade 10000mAh", "Powerbanka - s podporou rychlonabíjení, 2× USB-C a 1× USB-A"), null);
  // Nabíjecí stanice ve Wh – "4" z "LiFePo4" není kapacita, mezera = oddělovač tisíců
  assert.deepEqual(parameter("Anker SOLIX C300X", "Nabíjecí stanice - baterie LiFePo4 o kapacitě 288 Wh, nabíjecí výkon ze sítě 330 W"), { quantity: 288, unit: "Wh", amount: 288, amountUnit: "Wh" });
  assert.equal(parameter("Anker", "Nabíjacia stanica – batéria LiFePO4 288 Wh, výkon 300 W").quantity, 288);
  assert.equal(parameter("Anker", "Prídavná batéria – 2 048 Wh, LiFePO4").quantity, 2048);
  assert.equal(parameter("Anker", "Hordozható töltőállomás - LiFePO4 akkumulátor 1024 Wh kapacitás, 1800 W").quantity, 1024);
  // Pevné disky: kapacita jen v názvu
  assert.deepEqual(parameter("WD Red Plus 4TB", "Pevný disk - 3.5\", SATA III, cache 256 MB, 5400 ot/min"), { quantity: 4, unit: "TB", amount: 4, amountUnit: "TB" });
  assert.equal(parameter("Seagate Exos X18 16TB 512e", "Merevlemez - 3.5\", SATA III").quantity, 16);
  assert.equal(parameter("WD Blue 500GB", "Pevný disk – 2.5\", SATA III").quantity, 0.5);
  assert.equal(parameter("WD Red Plus", "Pevný disk - 3.5\", SATA III"), null);
});

test("getListingParameter: kde kapacita cenu neurčuje, nic nevrací", () => {
  const parameter = (name, description) => AlzaCore.getListingParameter(name, description);
  assert.equal(parameter("iPhone 17 256GB černá", "Mobilní telefon - 6,3\" OLED 2622 × 1206, 120Hz, procesor Apple A19, vnitřní paměť 256 GB"), null);
  assert.equal(parameter("PlayStation 5", "Herní konzole k televizi - SSD 1024 GB, Blu-ray mechanika"), null);
  assert.equal(parameter("Lenovo ThinkPad", "Notebook - Intel Core 5 210H, 16\" IPS, RAM 16GB DDR5, SSD 512GB, baterie 57 Wh"), null);
  assert.equal(parameter("HP 90W", "Napájecí adaptér 90 W - vstupní napětí 100 – 240 V"), null);
  assert.equal(parameter("Elektrokolo", "Elektrokolo - horské, baterie 500 Wh, motor 250 W"), null);
  assert.equal(parameter("Synology DS225+", "NAS - pro domácnosti, 2 pozice, RAM 2 GB"), null);
  assert.equal(parameter("Něco", ""), null);
  assert.equal(parameter(null, null), null);
});

test("formatParameterPrice: od stovky bez desetinných míst, měna a jednotka podle domény", () => {
  const clean = (text) => text.replace(/\s/g, " ");
  assert.equal(clean(AlzaCore.formatParameterPrice(3997.5, "TB", "alza_cz")), "3 998 Kč/TB");
  assert.equal(clean(AlzaCore.formatParameterPrice(3.117, "GB", "alza_cz")), "3,12 Kč/GB");
  assert.equal(clean(AlzaCore.formatParameterPrice(74.9, "TB", "alza_sk")), "74,90 €/TB");
  assert.equal(clean(AlzaCore.formatParameterPrice(29.95, "1000 mAh", "alza_cz")), "29,95 Kč/1000 mAh");
});

test("getListingEnergy: roční spotřeba lednic a mrazáků, spotřeba na 100 cyklů u praček a sušiček", () => {
  const energy = (description) => plain(AlzaCore.getListingEnergy(description));
  assert.deepEqual(energy("Lednice - kombinovaná, energetická třída C, chlazený prostor 180 l, hlučnost 39 dB, roční spotřeba 140 kWh/rok, mrazicí výkon 4 kg"), { kwh: 140, per: "year" });
  assert.deepEqual(energy("Pultový mrazák - energetická třída E, roční spotřeba 295 kWh, objem 500 l"), { kwh: 295, per: "year" });
  assert.deepEqual(energy("Mraznička - energetická trieda A, ročná spotreba 181,5 kWh, objem 200 l"), { kwh: 181.5, per: "year" });
  assert.deepEqual(energy("Parní pračka - s předním plněním, energetická třída A, kapacita pračky 8 kg, váž. spotřeba energie 33 kWh/100 cyklů, váž. spotřeba vody na cyklus 41 l"), { kwh: 33, per: "cycles" });
  assert.deepEqual(energy("Sušička prádla - kondenzační, hlučnost 66 dB spotřeba energie 102 kWh/100 cyklů 3DScan"), { kwh: 102, per: "cycles" });
  assert.deepEqual(energy("Sušička bielizne - spotreba energie 176 kWh (na 100 cyklov), displej"), { kwh: 176, per: "cycles" });
  // Stejný údaj dvakrát je v pořádku; dva různé (set, pračka se sušičkou) jsou nejednoznačné
  assert.deepEqual(energy("Sušička - spotřeba energie 102 kWh/100 cyklů, 102 kWh/100 cyklů"), { kwh: 102, per: "cycles" });
  assert.equal(energy("Set pračka a sušička - Pračka: spotřeba energie 49 kWh/100 cyklů, Sušička: spotřeba energie 176 kWh/100 cyklů"), null);
  assert.equal(energy("Pračka se sušičkou - vážená spotřeba energie 49 a 300 kWh / 100 cyklů"), null);
  assert.equal(energy("Set pračka a sušička - Pračka: s předním plněním, spotřeba energie 49 kWh/100 cyklů, Sušička: kondenzační"), null);
  assert.equal(energy("Szett - mosógép 49 kWh/100 ciklus"), null);
  assert.equal(energy("Kombinace - roční spotřeba 140 kWh/rok, spotřeba energie 49 kWh/100 cyklů"), null);
  // Bez údaje, mimo rozsah, jiné jednotky
  assert.equal(energy("Televize - OLED, 139cm, 4K Ultra HD, energetická třída F"), null);
  assert.equal(energy("Lednice - roční spotřeba 2 kWh/rok"), null);
  assert.equal(energy("Powerbanka 20000 mAh - 74 Wh"), null);
  assert.equal(energy(null), null);
});

test("getDocumentEnergy: detail produktu – popisek, jinak parametry (televize v SDR režimu, lednice, pračka)", () => {
  // Zjednodušená stránka: popisek pod názvem (.nameextc) a řádky parametrů (.typeName + .value v témže .row)
  const page = (description, rows = []) => ({
    querySelector: (selector) => (selector === ".nameextc" ? { textContent: description } : null),
    querySelectorAll: (selector) =>
      selector === ".typeName"
        ? rows.map(([label, value]) => ({ textContent: label, closest: () => ({ querySelector: () => ({ textContent: value }) }) }))
        : [],
  });
  const energy = (description, rows) => plain(AlzaCore.getDocumentEnergy(page(description, rows)));
  assert.deepEqual(energy("Lednice - kombinovaná, roční spotřeba 140 kWh/rok", [["Roční spotřeba energie lednice", "999 kWh/annum"]]), { kwh: 140, per: "year" }); // popisek má přednost
  assert.deepEqual(
    energy("Televize - OLED, 139cm, 4K Ultra HD", [
      ["Energetická třída v SDR režimu", "F"],
      ["Spotřeba v SDR režimu", "75 kWh/1000h"],
      ["Spotřeba v HDR režimu", "122 kWh/1000h"],
      ["Stand-by spotřeba (pohotovostní)", "0,5 W"],
    ]),
    { kwh: 75, per: "hours" }
  );
  // Stejný parametr je na stránce dvakrát (hlavní parametry + úplný seznam)
  assert.deepEqual(energy("Mrazák - šuplíkový", [["Roční spotřeba energie", "181,5 kWh/annum"], ["Roční spotřeba energie", "181,5 kWh/annum"]]), { kwh: 181.5, per: "year" });
  assert.deepEqual(energy("Pračka - s předním plněním", [["Spotřeba energie (praní)", "33 kWh/100 c."]]), { kwh: 33, per: "cycles" });
  // Myčka: Alza vede spotřebu jednoho cyklu jako „kWh/100 c.“ → 75 kWh/100 cyklů
  assert.deepEqual(energy("Vestavná myčka - energetická třída C", [["Spotřeba energie (program ECO)", "0,75 kWh/100 c."]]), { kwh: 75, per: "cycles" });
  // Dva různé údaje, set a stránka bez spotřeby
  assert.equal(energy("Pračka se sušičkou", [["Spotřeba energie (praní)", "49 kWh/100 c."], ["Spotřeba energie (praní a sušení)", "300 kWh/100 c."]]), null);
  assert.equal(energy("Set pračka a sušička - Pračka: s předním plněním", [["Spotřeba energie (praní)", "49 kWh/100 c."]]), null);
  assert.equal(energy("Mobilní telefon - 6,1\"", [["Kapacita baterie", "4000 mAh"]]), null);
});

test("getEnergySettings: hodnoty z nastavení, neplatné nahradí výchozí; televize podle hodin denně", () => {
  const settings = AlzaCore.getEnergySettings({ energyCost: true, energyPriceCZK: 7, energyYears: 99, energyCyclesPerWeek: 5, energyHoursPerDay: 0 }, "alza_cz");
  assert.deepEqual(plain(settings), { enabled: true, price: 7, years: 10, cyclesPerWeek: 5, hoursPerDay: 4 });
  // 75 kWh/1000 h × 4 h denně × 365 dní = 109,5 kWh ročně
  const tv = AlzaCore.getEnergyCost({ kwh: 75, per: "hours" }, { price: 6, years: 10, cyclesPerWeek: 4, hoursPerDay: 4 });
  assert.equal(tv.yearlyKwh, 109.5);
  assert.equal(tv.cost, 6570);
});

test("getEnergyPrice + getEnergyCost: cena elektřiny podle měny domény, provoz za zvolený počet let", () => {
  const settings = { ...AlzaCore.defaultSettings, energyPriceCZK: 7.5, energyPriceEUR: 0 };
  assert.equal(AlzaCore.getEnergyPrice(settings, "alza_cz"), 7.5);
  assert.equal(AlzaCore.getEnergyPrice(settings, "alza_sk"), AlzaCore.defaultSettings.energyPriceEUR); // neplatná → výchozí
  assert.equal(AlzaCore.getEnergyPrice(settings, "alza_hu"), AlzaCore.defaultSettings.energyPriceHUF);
  assert.deepEqual(plain(AlzaCore.getEnergyCost({ kwh: 140, per: "year" }, { price: 6, years: 10, cyclesPerWeek: 4 })), { yearlyKwh: 140, yearly: 840, cost: 8400 });
  // 33 kWh/100 cyklů × 4 cykly týdně × 52 týdnů = 68,64 kWh ročně
  const washer = AlzaCore.getEnergyCost({ kwh: 33, per: "cycles" }, { price: 6, years: 10, cyclesPerWeek: 4 });
  assert.equal(Math.round(washer.yearlyKwh * 100) / 100, 68.64);
  assert.equal(Math.round(washer.cost), 4118);
});

// === Moje nákupy ===
const archiveItem = (id, extra = {}) => ({
  commodityId: id,
  commodityUrl: `https://www.alza.cz/zbozi-d${id}.htm`,
  commodityName: `Zboží ${id}`,
  imageUrl: `https://image.alza.cz/products/AB${id}/AB${id}.jpg?width=160&height=160`,
  status: "Vyzvednuto",
  count: 1,
  purchasedPiecesCount: 1,
  brand: "Značka",
  categorySegment1: "Audio-Video",
  categorySegment2: "Sluchátka",
  categorySegment3: null,
  ...extra,
});
const archiveOrder = (id, created, items, extra = {}) => ({ orderId: String(id), created, state: "Vyřízena", totalPrice: "7 709 Kč", items, ...extra });

test("parseArchivePage: zboží s adresou, značkou a kategorií; služby a zrušené položky pryč", () => {
  const page = AlzaCore.parseArchivePage(
    {
      paging: { size: 1114 },
      value: [
        archiveOrder(1000000001, "2026-08-17T16:18:13.49Z", [
          archiveItem(111, { count: 3, purchasedPiecesCount: 7 }), // purchasedPiecesCount = součet za všechny objednávky
          { commodityName: "Doprava", status: "Vyzvednuto", count: 1 }, // služba bez adresy
          archiveItem(222, { status: "Zrušeno" }),
          archiveItem(333, { commodityUrl: "https://evil.example/zbozi-d333.htm" }),
        ]),
        archiveOrder(1000000002, "2026-08-01T10:00:00Z", [archiveItem(444)], { state: "Zrušena" }),
        archiveOrder("x", "2026-08-01T10:00:00Z", [archiveItem(555)]), // špatné číslo objednávky
      ],
    },
    "alza_cz"
  );
  assert.equal(page.total, 1114);
  assert.equal(page.count, 3);
  assert.equal(page.orders.length, 2);
  assert.deepEqual(plain(page.orders[0]), {
    id: "1000000001",
    t: Date.parse("2026-08-17T16:18:13.49Z"),
    total: 7709,
    cancelled: false,
    items: [{ key: "alza_cz_111", url: "https://www.alza.cz/zbozi-d111.htm", name: "Zboží 111", image: "https://image.alza.cz/products/AB111/AB111.jpg?width=160&height=160", brand: "Značka", cat: ["Audio-Video", "Sluchátka"], n: 3 }],
  });
  assert.equal(page.orders[1].cancelled, true);
  assert.equal(AlzaCore.parseArchivePage({ value: "x" }, "alza_cz"), null);
  assert.equal(AlzaCore.parseArchivePage(null, "alza_cz"), null);
});

test("mergeOwnedOrders: nákupy podle objednávek, opakované načtení nic nepřidá, zrušená objednávka nákup odebere", () => {
  const owned = {};
  const orders = {};
  const parse = (value) => AlzaCore.parseArchivePage({ value }, "alza_cz").orders;
  const first = parse([archiveOrder(2, "2026-05-01T10:00:00Z", [archiveItem(111), archiveItem(222)]), archiveOrder(1, "2025-01-01T10:00:00Z", [archiveItem(111, { commodityName: "Starý název" })])]);
  assert.equal(AlzaCore.mergeOwnedOrders(owned, orders, first, "alza_cz"), 3);
  assert.equal(AlzaCore.mergeOwnedOrders(owned, orders, first, "alza_cz"), 0);
  assert.deepEqual(plain(owned.alza_cz_111.buys), [
    { t: Date.parse("2025-01-01T10:00:00Z"), n: 1, o: "1" },
    { t: Date.parse("2026-05-01T10:00:00Z"), n: 1, o: "2" },
  ]);
  assert.equal(owned.alza_cz_111.name, "Zboží 111"); // název z nejnovějšího nákupu
  assert.equal(owned.alza_cz_111.domain, "alza_cz");
  assert.deepEqual(plain(orders), { 1: [Date.parse("2025-01-01T10:00:00Z"), 7709], 2: [Date.parse("2026-05-01T10:00:00Z"), 7709] });
  // Objednávka 2 zrušena dodatečně: zboží 222 zmizí, zboží 111 zůstane se starším nákupem
  AlzaCore.mergeOwnedOrders(owned, orders, parse([archiveOrder(2, "2026-05-01T10:00:00Z", [archiveItem(111)], { state: "Zrušena" })]), "alza_cz");
  assert.equal(owned.alza_cz_222, undefined);
  assert.equal(owned.alza_cz_111.buys.length, 1);
  assert.deepEqual(Object.keys(orders), ["1"]);
});

test("parseOwnedDetails + applyOwnedDetails: cena kusu, reklamace a vrácení z detailu objednávky", () => {
  const detailItem = (id, price, extra = {}) => ({ ...archiveItem(id), pricePerItem: `${price} Kč/ks`, price: `${price} Kč`, onClaimItemGuideClick: { enabled: true }, warrantyClaimMessageBanners: [], ...extra });
  const detail = {
    created: "2026-05-01T10:00:00Z",
    parts: [
      {
        created: "2026-05-01T10:00:00Z",
        items: [
          detailItem(111, "5 990"),
          detailItem(222, "1 290", { onClaimItemGuideClick: { enabled: false }, warrantyClaimMessageBanners: [{ warrantyClaimIconUri: "https://cdn.alza.cz/Foto/ImgGalery/Icons/warrantyClaims/ReturnGoods.svg" }] }),
          detailItem(333, "99", { warrantyClaimMessageBanners: [{ warrantyClaimIconUri: "https://cdn.alza.cz/Foto/ImgGalery/Icons/warrantyClaims/WarrantyClaim.svg" }] }),
        ],
      },
    ],
  };
  const details = AlzaCore.parseOwnedDetails(detail, "alza_cz");
  assert.deepEqual(plain(details), {
    alza_cz_111: { p: 5990, claim: true, ret: false, rma: false, n: 1 },
    alza_cz_222: { p: 1290, claim: false, ret: true, rma: false, n: 1 },
    alza_cz_333: { p: 99, claim: true, ret: false, rma: false, n: 1 }, // kus z výměny po reklamaci – reklamovat jde dál
  });
  const owned = {
    alza_cz_111: { domain: "alza_cz", buys: [{ t: 1, n: 1, o: "7" }, { t: 2, n: 1, o: "8" }] },
    alza_cz_999: { domain: "alza_cz", buys: [{ t: 1, n: 1, o: "7" }] }, // v detailu chybí – jen čas načtení
    alza_sk_111: { domain: "alza_sk", buys: [{ t: 1, n: 1, o: "7" }] },
  };
  AlzaCore.applyOwnedDetails(owned, "7", details, "alza_cz", 500);
  assert.deepEqual(plain(owned.alza_cz_111.buys), [{ t: 1, n: 1, o: "7", claim: true, ret: false, p: 5990, at: 500, dv: 2 }, { t: 2, n: 1, o: "8" }]);
  assert.deepEqual(plain(owned.alza_cz_999.buys), [{ t: 1, n: 1, o: "7", at: 500, dv: 2 }]);
  assert.deepEqual(plain(owned.alza_sk_111.buys), [{ t: 1, n: 1, o: "7" }]);
});

test("parseOwnedDetails: dobropis vrácené zboží neopakuje, reklamace bez další možnosti reklamovat", () => {
  const banner = (icon) => [{ warrantyClaimIconUri: `https://cdn.alza.cz/Foto/ImgGalery/Icons/warrantyClaims/${icon}.svg` }];
  const item = (id, price, claim, banners = []) => ({ ...archiveItem(id), pricePerItem: `${price} Kč/ks`, price: `${price} Kč`, onClaimItemGuideClick: { enabled: claim }, warrantyClaimMessageBanners: banners });
  const discount = { commodityId: null, commodityUrl: null, commodityName: "Sleva 15% k položce", count: 1, pricePerItem: "-54 Kč/ks", price: "-54 Kč", onClaimItemGuideClick: { enabled: false }, warrantyClaimMessageBanners: [] };
  // Faktura: vrácené pouzdro (se slevou 15 %) a ponechané; dobropis opakuje vrácené pouzdro i jeho slevu
  const detail = {
    created: "2026-10-17T18:00:00Z",
    parts: [
      { created: "2026-10-17T18:00:00Z", partName: "Faktura 1", items: [item(111, 358, false, banner("ReturnGoods")), item(222, 382, true), discount] },
      { created: "2026-10-17T18:00:00Z", partName: "Dobropis 2", items: [item(111, 358, false), discount] },
    ],
  };
  assert.deepEqual(plain(AlzaCore.getOrderGoodsParts(detail, "alza_cz").map((part) => part.partName)), ["Faktura 1"]);
  assert.deepEqual(plain(AlzaCore.parseOwnedDetails(detail, "alza_cz")), {
    alza_cz_111: { p: 304, claim: false, ret: true, rma: false, n: 1 },
    alza_cz_222: { p: 382, claim: true, ret: false, rma: false, n: 1 },
  });
  // Dobropis před fakturou, dva řádky téhož zboží (jeden vrácený) a reklamované zboží
  const mixed = {
    created: "2026-10-17T18:00:00Z",
    parts: [
      { created: "2026-10-17T18:00:00Z", items: [item(111, 100, false)] },
      { created: "2026-10-17T18:00:00Z", items: [item(111, 100, false, banner("ReturnGoods")), item(111, 100, true), item(333, 500, false, banner("WarrantyClaim")), item(444, 90, false)] },
    ],
  };
  assert.deepEqual(plain(AlzaCore.parseOwnedDetails(mixed, "alza_cz")), {
    alza_cz_111: { p: 100, claim: true, ret: false, rma: false, n: 2 },
    alza_cz_333: { p: 500, claim: false, ret: false, rma: true, n: 1 },
    alza_cz_444: { p: 90, claim: false, ret: false, rma: false, n: 1 }, // licence apod. – reklamovat nejde
  });
  // Reklamace vyřízená dobropisem (náhradní kus přišel jinou objednávkou): ikona vrácení, ale číslo případu není vratka
  const series = (icon, name) => [{ warrantyClaimIconUri: `https://cdn.alza.cz/Foto/ImgGalery/Icons/warrantyClaims/${icon}.svg`, message: { actions: { warrantyClaimDetail: { name } } } }];
  const replaced = {
    created: "2026-08-31T10:00:00Z",
    parts: [
      { created: "2026-08-31T10:00:00Z", items: [item(666, 99988, false, series("ReturnGoods", "ASKU262000001")), item(777, 500, false, series("ReturnGoods", "AVRA262000002")), item(888, 300, false, series("WarrantyClaim", "ASRE262000003"))] },
      { created: "2026-08-31T10:00:00Z", items: [item(666, 99988, false), item(888, 300, false)] },
    ],
  };
  assert.deepEqual(plain(AlzaCore.parseOwnedDetails(replaced, "alza_cz")), {
    alza_cz_666: { p: 99988, claim: false, ret: true, rma: true, n: 1 },
    alza_cz_777: { p: 500, claim: false, ret: true, rma: false, n: 1 }, // vratka
    alza_cz_888: { p: 300, claim: false, ret: true, rma: true, n: 1 }, // reklamace s dobropisem – peníze zpět
  });
  // Zaplacená objednávka vrácená bez převzetí: faktura i účetní dobropis bez banneru, reklamovat nejde nikde
  const refunded = { created: "2026-10-09T10:00:00Z", parts: [{ created: "2026-10-09T10:00:00Z", items: [item(555, 91, false, [])] }, { created: "2026-10-09T10:00:00Z", items: [item(555, 91, false, [])] }] };
  assert.deepEqual(plain(AlzaCore.parseOwnedDetails(refunded, "alza_cz")), { alza_cz_555: { p: 91, claim: false, ret: true, rma: false, n: 1, guess: true } });
  const owned = { alza_cz_333: { domain: "alza_cz", buys: [{ t: 1, n: 4, o: "7" }] } }; // počet z archivu přepíše počet z detailu
  AlzaCore.applyOwnedDetails(owned, "7", AlzaCore.parseOwnedDetails(mixed, "alza_cz"), "alza_cz", 500);
  assert.deepEqual(plain(owned.alza_cz_333.buys), [{ t: 1, n: 1, o: "7", claim: false, ret: false, p: 500, rma: true, at: 500, dv: 2 }]);
  // Další načtení už reklamaci nehlásí (vyřízeno výměnou, zboží jde zase reklamovat)
  AlzaCore.applyOwnedDetails(owned, "7", { alza_cz_333: { p: 500, claim: true, ret: false, rma: false, n: 1 } }, "alza_cz", 600);
  assert.deepEqual(plain(owned.alza_cz_333.buys), [{ t: 1, n: 1, o: "7", claim: true, ret: false, p: 500, at: 600, dv: 2 }]);
});

test("addMonths + getWarrantyState: v záruce, končí, po záruce, delší záruka, vráceno, nelze reklamovat", () => {
  const at = (year, month, day) => new Date(year, month - 1, day, 12).getTime();
  assert.equal(AlzaCore.addMonths(at(2024, 11, 16), 24), at(2026, 11, 16));
  assert.equal(AlzaCore.addMonths(at(2024, 8, 31), 6), at(2025, 2, 28)); // únor nemá 31.
  assert.equal(AlzaCore.addMonths(at(2026, 1, 15), -25), at(2023, 12, 15));
  const now = at(2026, 11, 11);
  const state = (buy) => AlzaCore.getWarrantyState(buy, now).state;
  assert.equal(state({ t: at(2025, 6, 1) }), "active");
  assert.deepEqual(plain(AlzaCore.getWarrantyState({ t: at(2024, 11, 16) }, now)), { state: "ending", until: at(2026, 11, 16), daysLeft: 5 });
  assert.equal(state({ t: at(2024, 11, 5) }), "expired");
  assert.equal(state({ t: at(2024, 11, 5), claim: true, at: at(2026, 11, 10) }), "extended"); // ověřeno po konci běžné záruky
  assert.equal(state({ t: at(2024, 11, 5), claim: true, at: at(2026, 1, 1) }), "expired"); // ověřeno ještě v záruce – nic neříká
  assert.equal(state({ t: at(2025, 6, 1), ret: true, claim: false, at: now }), "returned");
  assert.equal(state({ t: at(2025, 6, 1), rma: true, claim: false, at: now }), "claimed");
  assert.equal(state({ t: at(2025, 6, 1), rma: true, ret: true, claim: false, at: now }), "claimed"); // reklamace vyřízená vrácením
  assert.equal(state({ t: at(2025, 6, 1), claim: false, at: now }), "none");
});

test("getOwnedDetailQueue: detaily jen nedávných objednávek, nejdřív končící záruky; po konci záruky jedno ověření", () => {
  const at = (year, month, day) => new Date(year, month - 1, day, 12).getTime();
  const now = at(2026, 11, 11);
  const owned = {
    a: { domain: "alza_cz", buys: [{ t: at(2026, 10, 1), n: 1, o: "nova" }] },
    b: { domain: "alza_cz", buys: [{ t: at(2024, 12, 1), n: 1, o: "konci" }, { t: at(2026, 9, 1), n: 1, o: "starsi" }] },
    c: { domain: "alza_cz", buys: [{ t: at(2020, 1, 1), n: 1, o: "davna" }] },
    d: { domain: "alza_cz", buys: [{ t: at(2026, 10, 5), n: 1, o: "hotova", at: now, dv: 2 }] },
    e: { domain: "alza_cz", buys: [{ t: at(2024, 11, 1), n: 1, o: "poZaruce", at: at(2026, 1, 1), claim: true }] },
    f: { domain: "alza_cz", buys: [{ t: at(2024, 10, 20), n: 1, o: "overena", at: at(2026, 11, 1), claim: false, dv: 2 }] },
    g: { domain: "alza_sk", buys: [{ t: at(2026, 10, 1), n: 1, o: "jinaDomena" }] },
    // Detail načtený starší verzí čtení se načte znovu, aktuální verzí už ne
    h: { domain: "alza_cz", buys: [{ t: at(2026, 8, 1), n: 1, o: "staraVerze", at: now, claim: true }, { t: at(2026, 7, 1), n: 1, o: "novaVerze", at: now, claim: false, dv: 2 }] },
  };
  assert.deepEqual(plain(AlzaCore.getOwnedDetailQueue(owned, "alza_cz", now)), ["konci", "poZaruce", "nova", "starsi", "staraVerze"]);
});

test("getWarrantyReminders: jen dražší zboží s načteným detailem, které jde reklamovat, a jen jednou", () => {
  const at = (year, month, day) => new Date(year, month - 1, day, 12).getTime();
  const now = at(2026, 11, 11);
  const ending = at(2024, 11, 20);
  const owned = {
    drahe: { domain: "alza_cz", name: "Sluchátka", buys: [{ t: ending, n: 1, o: "1", p: 5990, claim: true, at: now }] },
    levne: { domain: "alza_cz", buys: [{ t: ending, n: 1, o: "2", p: 57, claim: true, at: now }] },
    bezDetailu: { domain: "alza_cz", buys: [{ t: ending, n: 1, o: "3" }] },
    ohlasene: { domain: "alza_cz", buys: [{ t: ending, n: 1, o: "4", p: 9990, claim: true, at: now, notified: true }] },
    vracene: { domain: "alza_cz", buys: [{ t: ending, n: 1, o: "5", p: 9990, claim: false, ret: true, at: now }] },
    vZaruce: { domain: "alza_cz", buys: [{ t: at(2025, 6, 1), n: 1, o: "6", p: 9990, claim: true, at: now }] },
    eura: { domain: "alza_sk", buys: [{ t: at(2024, 11, 14), n: 1, o: "7", p: 45, claim: true, at: now }] },
  };
  const reminders = AlzaCore.getWarrantyReminders(owned, now);
  assert.deepEqual(plain(reminders.map(({ key }) => key)), ["eura", "drahe"]); // nejdřív dřívější konec
  assert.equal(reminders[1].daysLeft, 9);
});
