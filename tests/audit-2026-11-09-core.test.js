// Testy oprav z auditu 2026-11-09 v jádru a úložišti (src/shared/core.js, src/shared/store.js): node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");

const { AlzaCore } = loadCore();
const DAY = AlzaCore.dayMs;
const NOW = Date.UTC(2026, 10, 6, 12);
const plain = (value) => JSON.parse(JSON.stringify(value));
const endOfDay = (year, month, day) => new Date(year, month - 1, day, 23, 59, 59).getTime();

function setupStore(storage = {}) {
  const { AlzaCore: core, chrome, context } = loadCore({ storage, files: ["src/shared/store.js"] });
  context.AlzaStore.isWriter = true;
  const written = [];
  chrome.storage.onChanged.addListener((changes) => written.push(...Object.keys(changes)));
  return { AlzaCore: core, AlzaStore: context.AlzaStore, data: chrome.storage.local.data, written };
}

// === #2 getPurchaseDrop: jen skutečné zlevnění od nákupu ===

test("getPurchaseDrop: cena s kódem / AlzaPlus+ z doby nákupu není zlevnění", () => {
  const purchase = { price: 31490, boughtAt: NOW - 3 * DAY, returnUntil: NOW + 10 * DAY };
  // Při nákupu platil slevový kód (v objednávce zvláštní řádek) – stejná cena s kódem dnes nic
  const withCode = [{ t: NOW - 10 * DAY, s: NOW, p: { original: 31490, discount: 29990 }, a: "in" }];
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 31490, discount: 29990 }, NOW, withCode), null);
  // Bez historie (starší volání) se srovnává jen s cenou z objednávky
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 31490, discount: 29990 }, NOW).lowest, 29990);
  // AlzaPlus+ už při nákupu – upozorní až pod ní
  const withPlus = [{ t: NOW - 10 * DAY, s: NOW, p: { original: 31490, applus: 30490 }, a: "in" }];
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 31490, applus: 30490 }, NOW, withPlus), null);
  assert.deepEqual(plain(AlzaCore.getPurchaseDrop(purchase, { original: 30990, applus: 29490 }, NOW, withPlus)), {
    lowest: 29490,
    saving: 1000,
    reference: 30490,
  });
});

test("getPurchaseDrop: cena kolem nákupu z historie, bez ní nic", () => {
  const purchase = { price: 1000, boughtAt: NOW - 5 * DAY, returnUntil: NOW + 9 * DAY };
  // Prázdná historie – cenu z doby nákupu neznáme
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 500 }, NOW, []), null);
  // Historie začíná až po nákupu – první známá cena
  const later = [{ t: NOW - 2 * DAY, s: NOW - DAY, p: { original: 900 }, a: "in" }];
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 900 }, NOW, later), null);
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 850 }, NOW, later).lowest, 850);
  // Zlevnění až po nákupu (víc než den) se ohlásí; cena z doby nákupu je stav platný při nákupu
  const history = [
    { t: NOW - 20 * DAY, s: NOW - 4 * DAY - 1, p: { original: 1000 }, a: "in" },
    { t: NOW - 3 * DAY, s: NOW, p: { original: 800 }, a: "in" },
  ];
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 800 }, NOW, history).reference, 1000);
  assert.equal(AlzaCore.getPurchaseReferencePrice(history, purchase.boughtAt), 1000);
  // Výpis neukázal kód, detail ho ukázal hodinu po nákupu – patří k ceně z doby nákupu
  const listingThenDetail = [
    { t: NOW - 20 * DAY, s: NOW - 5 * DAY, p: { original: 1000 }, a: "in" },
    { t: NOW - 5 * DAY + 3600000, s: NOW, p: { original: 1000, discount: 900 }, a: "in" },
  ];
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 1000, discount: 900 }, NOW, listingThenDetail), null);
});

test("parseOrderPurchases: slevový kód (záporný řádek) se u objednávky s jedním zbožím odečte", () => {
  const order = (items) => ({ parts: [{ created: "2026-11-05T19:27:53.69Z", items }] });
  const phone = { commodityId: 13583950, commodityUrl: "/oppo-find-x10-d13583950.htm", pricePerItem: "31 490 Kč/ks", count: 1 };
  const shipping = [
    { commodityId: 7565262, commodityName: "Služba Doprava zboží", commodityUrl: "", pricePerItem: "69 Kč/ks", count: 1 },
    { commodityId: 7360243, commodityName: "Voucher Sleva na dopravné", commodityUrl: "", pricePerItem: "-69 Kč/ks", count: 1 },
  ];
  const code = { commodityId: 1, commodityName: "Slevový kód OPPO", commodityUrl: "", pricePerItem: "-500 Kč/ks", count: 1 };
  assert.equal(AlzaCore.parseOrderPurchases(order([phone, ...shipping, code]), "alza_cz")[0].price, 30990);
  // Sleva na dopravné jen ruší dopravu – cena zboží zůstává
  assert.equal(AlzaCore.parseOrderPurchases(order([phone, ...shipping]), "alza_cz")[0].price, 31490);
  // Víc kusů: sleva za kus
  assert.equal(AlzaCore.parseOrderPurchases(order([{ ...phone, pricePerItem: "1 000 Kč/ks", count: 2 }, { ...code, pricePerItem: "-200 Kč/ks" }]), "alza_cz")[0].price, 900);
  // Víc zboží – nevíme, ke kterému sleva patří
  const filament = { commodityId: 5513971, commodityUrl: "/filament-d5513971.htm", pricePerItem: "428 Kč/ks", count: 1 };
  const two = AlzaCore.parseOrderPurchases(order([phone, filament, code]), "alza_cz");
  assert.deepEqual(plain(two.map(({ price }) => price)), [31490, 428]);
});

test("parseOrderPurchases: procentní sleva k položce (AlzaPlus+) se u víc zboží přiřadí podle částky", () => {
  const order = (items) => ({ parts: [{ created: "2026-11-05T19:27:53.69Z", items }] });
  const jar = { commodityId: 1415001, commodityName: "JAR Platinum", commodityUrl: "/jar-d1415001.htm", pricePerItem: "91 Kč/ks", count: 1 };
  const filament = { commodityId: 5513971, commodityUrl: "/filament-d5513971.htm", pricePerItem: "428 Kč/ks", count: 1 };
  const applus = { commodityId: 2, commodityName: "Sleva 30% k položce CIS1415", commodityUrl: "", pricePerItem: "-27 Kč/ks", count: 1 };
  const prices = (items) => plain(AlzaCore.parseOrderPurchases(order(items), "alza_cz").map(({ price }) => price));
  assert.deepEqual(prices([jar, filament, applus]), [64, 428]);
  // Haléře a sleva na každý ze dvou kusů (−54,60 za řádek) i jen na jeden kus
  assert.deepEqual(prices([{ ...jar, count: 2 }, filament, { ...applus, pricePerItem: "-27,30 Kč/ks", count: 2 }]), [63.7, 428]);
  assert.deepEqual(prices([{ ...jar, count: 2 }, filament, applus]), [77.5, 428]);
  // Částka nesedí na žádné zboží, nebo sedí na víc – nepřiřadí se
  assert.deepEqual(prices([jar, filament, { ...applus, pricePerItem: "-200 Kč/ks" }]), [91, 428]);
  assert.deepEqual(prices([jar, { ...filament, pricePerItem: "91 Kč/ks" }, applus]), [91, 91]);
  // Kód produktu z adresy obrázku rozhodne i při stejné ceně a u pevné částky (skutečný tvar API objednávky)
  const image = (code) => `https://image.alza.cz/products/${code}/${code}.jpg?width=160&height=160`;
  const coded = [{ ...jar, imageUrl: image("CIS1415") }, { ...filament, pricePerItem: "91 Kč/ks", imageUrl: image("FIL428") }];
  assert.deepEqual(prices([...coded, { ...applus, commodityId: null, commodityUrl: null }]), [64, 91]);
  assert.deepEqual(prices([...coded, { ...applus, commodityName: "Sleva k položce CIS1415", pricePerItem: "-10 Kč/ks" }]), [81, 91]);
  assert.equal(AlzaCore.parseOrderDiscountPercent("Zľava 12,5 % k položke"), 12.5);
  assert.equal(AlzaCore.parseOrderDiscountPercent("Slevový kód OPPO"), null);
});

// === #4 termíny cashbacku ===

test("findTermDates: maďarské krátké datum je měsíc.den, rok z předchozího data", () => {
  const times = (text, lang, ref = NOW) => AlzaCore.findTermDates(text, ref, lang).map(({ time }) => time);
  assert.deepEqual(plain(times("2026. 11. 01. – 12. 05.", "hu")), [endOfDay(2026, 11, 1), endOfDay(2026, 12, 5)]);
  assert.deepEqual(plain(times("2026. 11. 01. – 01. 31.", "hu")), [endOfDay(2026, 11, 1), endOfDay(2027, 1, 31)]);
  // Česky den.měsíc; rok z předchozího data, přes přelom roku další rok
  assert.deepEqual(plain(times("od 1. 10. 2026 do 31. 1.", "cz")), [endOfDay(2026, 10, 1), endOfDay(2027, 1, 31)]);
});

test("findTermDates: datum bez roku dávno minulé je příští rok", () => {
  const december = new Date(2026, 11, 10, 12).getTime();
  assert.equal(AlzaCore.findTermDates("Registrace do 15. 1.", december, "cz")[0].time, endOfDay(2027, 1, 15));
  // Nedávno minulé datum zůstává letos (akce skončila)
  assert.equal(AlzaCore.findTermDates("Akce skončila 30. 9.", NOW, "cz")[0].time, endOfDay(2026, 9, 30));
});

test("readCashbackTerms: „Zaregistrujte svůj nákup v období od 19. 9. do 15. 1. 2027“ je období registrace", () => {
  const terms = plain(AlzaCore.readCashbackTerms("Zaregistrujte svůj nákup v období od 19. 9. do 15. 1. 2027.", null, NOW));
  assert.deepEqual(terms.registerEnds, [{ until: endOfDay(2027, 1, 15), from: new Date(2026, 8, 19).getTime() }]);
  assert.deepEqual(terms.purchaseEnds, []);
  // Nákupní období v jiné větě za registrací zůstává nákupním
  const other = plain(AlzaCore.readCashbackTerms("Nutná registrace. Nákup v období: 1. 10. 2026 – 31. 12. 2026", null, NOW));
  assert.deepEqual(other.purchaseEnds, [endOfDay(2026, 12, 31)]);
  assert.deepEqual(other.registerEnds, []);
});

test("readCashbackTerms: maďarská stránka – období nákupu měsíc.den, „határideje“", () => {
  const text = "A vásárlás időszaka: 2026. 11. 01. – 12. 05. Regisztráció határideje: 2027. 01. 15.";
  for (const lang of ["hu", null]) {
    const terms = plain(AlzaCore.readCashbackTerms(text, null, NOW, lang));
    assert.deepEqual(terms.purchaseEnds, [endOfDay(2026, 12, 5)], String(lang));
    assert.deepEqual(terms.registerEnds, [{ until: endOfDay(2027, 1, 15), from: null }], String(lang));
  }
  assert.equal(AlzaCore.parseCashbackTerms("A regisztráció határideje: 2027. 02. 28.", null, NOW, "hu").registerUntil, endOfDay(2027, 2, 28));
  assert.equal(AlzaCore.getTermsLanguage("Registrace nejpozději do 31. 1. 2027"), null);
});

// === #6 getPromoCode ===

test("getPromoCode: celé slovo, ne číslo ani cena", () => {
  const row = (text) => ({ textContent: text, querySelector: () => null });
  assert.equal(AlzaCore.getPromoCode(row("Vásároljon kuponkóddal kedvezményesen")), null);
  assert.equal(AlzaCore.getPromoCode(row("Vásároljon NYAR10 kuponkóddal")), null);
  assert.equal(AlzaCore.getPromoCode(row("kuponkóddal NYAR10 kedvezményesen")), "NYAR10");
  assert.equal(AlzaCore.getPromoCode(row("Koupit s kódem 1299,-")), null);
  assert.equal(AlzaCore.getPromoCode(row("Koupit s kódem 2026")), null);
  assert.equal(AlzaCore.getPromoCode(row("Koupit s kódem A1299,-")), null);
  assert.equal(AlzaCore.getPromoCode(row("Kúpiť s kódom ABC12 €")), null);
  assert.equal(AlzaCore.getPromoCode(row("Koupit s kódem ABC12 Kč")), null);
  assert.equal(AlzaCore.getPromoCode(row("kuponkóddal XY99 Ft")), null);
  assert.equal(AlzaCore.getPromoCode(row("Koupit s kódem SALE10, platí do neděle")), "SALE10");
  assert.equal(AlzaCore.getPromoCode(row("Koupit s kódem 2026ALZAEXTRA5 Slevový kód vám dává…")), "2026ALZAEXTRA5");
});

// === #7 a #8 objednávky ===

test("parseOrderPurchases: produkt s adresou ?dq= má klíč z čísla a adresa ho drží", () => {
  const detail = { parts: [{ created: "2026-11-05T19:27:53.69Z", items: [
    { commodityId: 7654321, commodityUrl: "/kabel-usb-c?dq=7654321", pricePerItem: "199 Kč/ks", count: 1 },
    { commodityId: 5513971, commodityUrl: "https://www.alza.cz/filament-d5513971.htm?x=1", pricePerItem: "428 Kč/ks", count: 1 },
  ] }] };
  const items = plain(AlzaCore.parseOrderPurchases(detail, "alza_cz"));
  assert.deepEqual(items.map(({ key, url }) => [key, url]), [
    ["alza_cz_7654321", "https://www.alza.cz/kabel-usb-c?dq=7654321"],
    ["alza_cz_5513971", "https://www.alza.cz/filament-d5513971.htm"],
  ]);
  assert.equal(AlzaCore.getProductKey("alza_cz", items[0].url), "alza_cz_7654321");
});

test("isCancelledOrder: zrušené i vrácené ve všech jazycích", () => {
  for (const state of ["Zrušena", "Stornováno", "Vráceno", "Vrácená", "Zboží vráceno", "Vrátené", "Vrátená", "Visszaküldve", "Törölve", "Returned", "Cancelled", "Refunded"]) {
    assert.equal(AlzaCore.isCancelledOrder(state), true, state);
  }
  for (const state of ["Vyřízena", "Vyzvednuto", "Odoslaná", "Teljesítve", "Delivered", "", null]) {
    assert.equal(AlzaCore.isCancelledOrder(state), false, String(state));
  }
});

// === #11 cashback: nová akce, vrácená částka v € ===

test("updateCashbackRegistry: nová akce resetuje since, € s centy, seenAt se nepřepisuje každou chvíli", () => {
  const registry = {};
  const record = (title, terms = "/akce-a") => ({ original: 1000, cashback: { price: 800, terms, title } });
  AlzaCore.updateCashbackRegistry(registry, "alza_cz_1", record("Jarní cashback"), "alza_cz", NOW);
  AlzaCore.updateCashbackRegistry(registry, "alza_cz_1", record("Jarní cashback"), "alza_cz", NOW + DAY);
  assert.equal(registry.alza_cz_1.since, NOW);
  AlzaCore.updateCashbackRegistry(registry, "alza_cz_1", record("Zimní cashback"), "alza_cz", NOW + 2 * DAY);
  assert.equal(registry.alza_cz_1.since, NOW + 2 * DAY);
  AlzaCore.updateCashbackRegistry(registry, "alza_cz_1", record("Zimní cashback", "/akce-b"), "alza_cz", NOW + 3 * DAY);
  assert.equal(registry.alza_cz_1.since, NOW + 3 * DAY);
  // Bez názvu a odkazu (popisek se nenačetl) akce trvá
  AlzaCore.updateCashbackRegistry(registry, "alza_cz_1", { original: 1000, cashback: { price: 800 } }, "alza_cz", NOW + 4 * DAY);
  assert.equal(registry.alza_cz_1.since, NOW + 3 * DAY);
  assert.equal(registry.alza_cz_1.title, "Zimní cashback");
  // Jen posun seenAt o pár minut – beze změny
  assert.equal(AlzaCore.updateCashbackRegistry(registry, "alza_cz_1", { original: 1000, cashback: { price: 800 } }, "alza_cz", NOW + 4 * DAY + 60000), false);
  assert.equal(registry.alza_cz_1.seenAt, NOW + 4 * DAY);

  const euro = {};
  AlzaCore.updateCashbackRegistry(euro, "alza_sk_1", { original: 62.5, cashback: { price: 50 } }, "alza_sk", NOW);
  assert.equal(euro.alza_sk_1.refund, 12.5);
});

test("updateCodeRegistry: posun seenAt do hodiny se nezapisuje, staré kódy se mažou", () => {
  const registry = { alza_cz_9: { code: "OLD", seenAt: NOW - 31 * DAY } };
  const record = { discount: { price: 900, code: "SALE10" } };
  assert.equal(AlzaCore.updateCodeRegistry(registry, "alza_cz_1", record, "u", "alza_cz", NOW), true);
  assert.equal(registry.alza_cz_9, undefined);
  assert.equal(AlzaCore.updateCodeRegistry(registry, "alza_cz_1", record, "u", "alza_cz", NOW + 60000), false);
  assert.equal(registry.alza_cz_1.seenAt, NOW);
  assert.equal(AlzaCore.updateCodeRegistry(registry, "alza_cz_1", record, "u", "alza_cz", NOW + AlzaCore.registrySeenRefreshMs), true);
  assert.equal(registry.alza_cz_1.seenAt, NOW + AlzaCore.registrySeenRefreshMs);
  // Změna ceny s kódem se zapíše hned
  assert.equal(AlzaCore.updateCodeRegistry(registry, "alza_cz_1", { discount: { price: 850, code: "SALE10" } }, "u", "alza_cz", NOW + AlzaCore.registrySeenRefreshMs + 1), true);
});

// === #13 úklid stupňů množstevní slevy ===

test("removeQuantityTierEntries: záznam z detailu se stejnou cenou zůstane, slučuje jen stejnou dostupnost a název", () => {
  const tiers = [[1, 1, 89], [2, 2, 83], [3, 100000, 76]];
  // AlzaPlus+ rovný stupni a záznam s cashbackem (z detailu) se nemažou
  const detail = [
    { t: 1, s: 2, p: { original: 89, applus: 76 }, a: "in" },
    { t: 3, s: 4, p: { original: 76, cashback: 70 }, a: "in" },
  ];
  assert.equal(AlzaCore.removeQuantityTierEntries(detail, tiers), 0);
  assert.equal(detail.length, 2);
  // Změna dostupnosti a názvu se při sloučení neztratí
  const entries = [
    { t: 1, s: 2, p: { original: 89 }, a: "in" },
    { t: 3, s: 4, p: { original: 76 }, a: "in" },
    { t: 5, s: 6, p: { original: 89 }, a: "out" },
    { t: 7, s: 8, p: { original: 76 }, a: "out" },
    { t: 9, s: 10, p: { original: 89 }, a: "out", n: "Nový název" },
  ];
  assert.equal(AlzaCore.removeQuantityTierEntries(entries, tiers), 2);
  assert.deepEqual(plain(entries.map(({ t, a, n }) => [t, a, n ?? null])), [[1, "in", null], [5, "out", null], [9, "out", "Nový název"]]);
});

// === getChangeTone, překlady ===

test("getChangeTone: zlevnění po nákupu a nový kód jsou down ve všech jazycích", () => {
  for (const lang of ["cz", "sk", "hu", "en"]) {
    assert.equal(AlzaCore.getChangeTone(AlzaCore.translate(lang, "notifyPurchaseDrop", "31 490 Kč", "29 990 Kč", "20. 11.")), "down", lang);
    assert.equal(AlzaCore.getChangeTone(AlzaCore.translate(lang, "notifyNewCode", "OPPO1", "26 490 Kč")), "down", lang);
  }
  assert.equal(AlzaCore.getChangeTone("Cena: 100 Kč → 120 Kč (+20 Kč, +20 %)"), "up");
});

test("notifyCashbackOpenNoAmount: ve všech jazycích jen lhůta ({0})", () => {
  for (const lang of ["cz", "sk", "hu", "en"]) {
    const text = AlzaCore.texts[lang].notifyCashbackOpenNoAmount;
    assert.ok(text?.includes("{0}") && !text.includes("{1}"), lang);
    assert.ok(AlzaCore.translate(lang, "notifyCashbackOpenNoAmount", "15. 1. 2027").includes("15. 1. 2027"), lang);
  }
});

// === store.js ===

test("removeProducts smaže i kód, cashback, připomínku a nákup produktu", async () => {
  const keys = ["alzaCodes", "alzaCashbacks", "alzaCashbackReminders", "alzaPurchases"];
  const { AlzaStore, data } = setupStore(Object.fromEntries(keys.map((key) => [key, { alza_cz_101: { x: 1 }, alza_cz_202: { x: 2 } }])));
  await AlzaStore.run({ type: "removeProducts", productKeys: ["alza_cz_101"] });
  keys.forEach((key) => assert.deepEqual(Object.keys(data[key]), ["alza_cz_202"], key));
});

test("patchMap existingOnly: merge nevytvoří chybějící položku", async () => {
  const { AlzaStore, data } = setupStore({ alzaPurchases: { alza_cz_1: { url: "u", price: 10 } } });
  await AlzaStore.run({ type: "patchMap", key: "alzaPurchases", merge: { alza_cz_1: { notifiedPrice: 9 }, alza_cz_2: { notifiedPrice: 5 } }, existingOnly: true });
  assert.deepEqual(plain(data.alzaPurchases), { alza_cz_1: { url: "u", price: 10, notifiedPrice: 9 } });
  // Výchozí chování beze změny
  await AlzaStore.run({ type: "patchMap", key: "alzaPurchases", merge: { alza_cz_2: { notifiedPrice: 5 } } });
  assert.deepEqual(plain(data.alzaPurchases.alza_cz_2), { notifiedPrice: 5 });
});

test("mergePrices: trezor kódů a cashbacků se nepřepisuje kvůli samotnému seenAt", async () => {
  const { AlzaStore, data, written } = setupStore();
  const url = "https://www.alza.cz/produkt-a-d101.htm";
  const record = { original: 1000, discount: { price: 900, icon: null, code: "SALE10" }, cashback: { price: 800, terms: "/akce", title: "Akce" } };
  await AlzaStore.run({ type: "mergePrices", domain: "alza_cz", records: { [url]: record }, now: NOW });
  assert.equal(data.alzaCodes.alza_cz_101.code, "SALE10");
  assert.ok(data.alzaCashbacks.alza_cz_101);
  written.length = 0;
  await AlzaStore.run({ type: "mergePrices", domain: "alza_cz", records: { [url]: record }, now: NOW + 60000 });
  assert.deepEqual(written, ["alzaPrice_alza_cz_101"]);
  await AlzaStore.run({ type: "mergePrices", domain: "alza_cz", records: { [url]: record }, now: NOW + 2 * 60 * 60 * 1000 });
  assert.ok(written.includes("alzaCodes") && written.includes("alzaCashbacks"));
});

test("getPurchaseDrop: akční cena den po nákupu je zlevnění, kód nalezený po nákupu ne", () => {
  // Nákup v 15:31 za 25 990, v 17:22 nová akční cena 24 691 (QE65S85H, 2026-11-09)
  const boughtAt = NOW - 2 * 3600000;
  const purchase = { price: 25990, boughtAt, returnUntil: boughtAt + 14 * DAY };
  const before = [{ t: NOW - 5 * DAY, s: NOW - 3600000, p: { original: 25990 }, a: "in" }];
  assert.deepEqual(plain(AlzaCore.getPurchaseDrop(purchase, { original: 25990, special: 24691 }, NOW, before)), {
    lowest: 24691,
    saving: 1299,
    reference: 25990,
  });
  // Historie s akční cenou už zapsanou (další kontrola) – srovnává se pořád se stavem při nákupu
  const after = [...before, { t: NOW - 3600000, s: NOW, p: { original: 25990, special: 24691 }, a: "in" }];
  assert.equal(AlzaCore.getPurchaseReferencePrice(after, boughtAt), 25990);
  // Kód zjištěný detailem hodinu po nákupu patří k ceně z doby nákupu
  const code = [...before, { t: NOW - 3600000, s: NOW, p: { original: 25990, discount: 24990 }, a: "in" }];
  assert.equal(AlzaCore.getPurchaseReferencePrice(code, boughtAt), 24990);
});
