// Testy oprav z auditu 2026-11-12 v jádru a úložišti (src/shared/core.js, src/shared/store.js): node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");

const { AlzaCore } = loadCore();
const DAY = AlzaCore.dayMs;
const plain = (value) => JSON.parse(JSON.stringify(value));
const at = (year, month, day) => new Date(year, month - 1, day, 12).getTime();

function setupStore(storage = {}) {
  const { AlzaCore: core, chrome, context } = loadCore({ storage, files: ["src/shared/store.js"] });
  context.AlzaStore.isWriter = true;
  return { AlzaCore: core, AlzaStore: context.AlzaStore, data: chrome.storage.local.data };
}

const goods = (id, price, { claim = true, banners = [], status = "Vyzvednuto", count = 1 } = {}) => ({
  commodityId: id,
  commodityUrl: `https://www.alza.cz/zbozi-d${id}.htm`,
  commodityName: `Zboží ${id}`,
  imageUrl: `https://image.alza.cz/products/AB${id}/AB${id}.jpg`,
  status,
  count,
  pricePerItem: `${price} Kč/ks`,
  onClaimItemGuideClick: { enabled: claim },
  warrantyClaimMessageBanners: banners,
});
const line = (name, price) => ({ commodityId: 1, commodityUrl: null, commodityName: name, count: 1, pricePerItem: `${price} Kč/ks`, onClaimItemGuideClick: { enabled: false }, warrantyClaimMessageBanners: [] });
const returnBanner = [{ warrantyClaimIconUri: "https://cdn.alza.cz/warrantyClaims/ReturnGoods.svg", message: { actions: { warrantyClaimDetail: { name: "AVRA262000123" } } } }];
const order = (...parts) => ({ created: "2026-11-01T10:00:00Z", parts: parts.map((items) => ({ created: "2026-11-01T10:00:00Z", items })) });

// === Hlídání po nákupu ===

test("parseOrderPurchases: vrácené zboží (banner + dobropis) se nehlídá, Moje nákupy jeho cenu dostanou", () => {
  // Jedno zboží za 5 000 s kódem −500, vrácené: faktura s bannerem a dobropis, který zboží i slevu opakuje
  const returned = order([goods(111, 5000, { claim: false, banners: returnBanner }), line("Slevový kód", -500)], [goods(111, 5000, { claim: false }), line("Slevový kód", -500)]);
  assert.deepEqual(plain(AlzaCore.parseOrderPurchases(returned, "alza_cz")), []);
  const invoice = { ...returned, parts: AlzaCore.getOrderGoodsParts(returned, "alza_cz") };
  assert.equal(AlzaCore.parseOrderPurchases(invoice, "alza_cz", { includeReturned: true })[0].price, 4500);
  assert.deepEqual(plain(AlzaCore.parseOwnedDetails(returned, "alza_cz")), { alza_cz_111: { p: 4500, claim: false, ret: true, rma: false, n: 1 } });
  // Běžná nová objednávka (ještě nejde reklamovat) se hlídá dál
  assert.equal(AlzaCore.parseOrderPurchases(order([goods(222, 900, { claim: false, status: "Rezervováno" })]), "alza_cz").length, 1);
});

test("parseOrderPurchases: zrušená položka nebrání odečtení kódu; položka „Vráceno“ jen pro Moje nákupy", () => {
  const cancelled = order([goods(1, 1000), goods(2, 300, { status: "Zrušeno" }), line("Slevový kód", -200)]);
  assert.deepEqual(plain(AlzaCore.parseOrderPurchases(cancelled, "alza_cz").map(({ key, price }) => [key, price])), [["alza_cz_1", 800]]);
  const back = order([goods(3, 700, { status: "Vráceno", claim: false })]);
  assert.deepEqual(plain(AlzaCore.parseOrderPurchases(back, "alza_cz")), []);
  assert.equal(AlzaCore.parseOrderPurchases(back, "alza_cz", { includeReturned: true })[0].price, 700);
});

test("getPurchaseDrop: v eurech je nejmenší rozdíl 5 centů, ne 1 €", () => {
  const now = at(2026, 11, 10);
  const purchase = { price: 15, domain: "alza_sk", boughtAt: now - 2 * DAY, returnUntil: now + 12 * DAY };
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 14.2 }, now).lowest, 14.2);
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 14.97 }, now), null);
  // Koruny beze změny: rozdíl pod 1 Kč není zlevnění
  assert.equal(AlzaCore.getPurchaseDrop({ ...purchase, domain: "alza_cz", price: 150 }, { original: 149.5 }, now), null);
});

// === Moje nákupy ===

test("parseArchivePage + mergeOwnedOrders: vrácená položka zůstane se stavem, dva řádky téhož zboží se sečtou", () => {
  const archive = (items) => ({ paging: { size: 1 }, value: [{ orderId: "77", created: "2026-05-01T10:00:00Z", totalPrice: "1 500 Kč", state: "Vyřízeno", items }] });
  const page = AlzaCore.parseArchivePage(archive([goods(5, 100, { count: 2 }), goods(5, 100, { count: 3 }), goods(6, 400, { status: "Vráceno" }), goods(7, 50, { status: "Zrušeno" })]), "alza_cz");
  assert.deepEqual(plain(page.orders[0].items.map(({ key, n, ret }) => ({ key, n, ret }))), [{ key: "alza_cz_5", n: 5 }, { key: "alza_cz_6", n: 1, ret: true }]);
  const owned = {};
  const orders = {};
  AlzaCore.mergeOwnedOrders(owned, orders, page.orders, "alza_cz");
  assert.equal(owned.alza_cz_5.buys[0].n, 5);
  assert.equal(owned.alza_cz_6.buys[0].ret, true);
  // Zboží vrácené až po prvním načtení: další načtení archivu stav doplní
  const later = AlzaCore.parseArchivePage(archive([goods(5, 100, { count: 5, status: "Vráceno" })]), "alza_cz");
  AlzaCore.mergeOwnedOrders(owned, orders, later.orders, "alza_cz");
  assert.equal(owned.alza_cz_5.buys.length, 1);
  assert.equal(owned.alza_cz_5.buys[0].ret, true);
});

test("parseOwnedDetails + applyOwnedDetails: firemní nákup, záruka z detailu produktu jen pro stejný druh nákupu", () => {
  const company = { ...order([goods(8, 2000)]) };
  company.parts[0].billingAddress = { company: "Firma s.r.o.", identificationNumber: "12345678" };
  assert.equal(AlzaCore.parseOwnedDetails(company, "alza_cz").alza_cz_8.biz, true);
  assert.equal("biz" in AlzaCore.parseOwnedDetails(order([goods(8, 2000)]), "alza_cz").alza_cz_8, false);

  const owned = { alza_cz_8: { domain: "alza_cz", buys: [{ t: at(2026, 1, 10), n: 1, o: "1" }, { t: at(2026, 3, 10), n: 1, o: "2" }] } };
  const warranties = { alza_cz_8: { m: 12, b: true } };
  AlzaCore.applyOwnedDetails(owned, "1", AlzaCore.parseOwnedDetails(company, "alza_cz"), "alza_cz", at(2026, 1, 12), warranties);
  AlzaCore.applyOwnedDetails(owned, "2", AlzaCore.parseOwnedDetails(order([goods(8, 2000)]), "alza_cz"), "alza_cz", at(2026, 3, 12), warranties);
  assert.deepEqual(plain(owned.alza_cz_8.buys.map(({ biz, w }) => ({ biz, w }))), [{ biz: true, w: 12 }, {}]);
  // Konec záruky podle měsíců z detailu; bez nich 24 měsíců
  assert.equal(AlzaCore.getWarrantyEnd(owned.alza_cz_8.buys[0]), at(2027, 1, 10));
  assert.equal(AlzaCore.getWarrantyEnd(owned.alza_cz_8.buys[1]), at(2028, 3, 10));
  assert.equal(AlzaCore.getWarrantyState(owned.alza_cz_8.buys[0], at(2027, 2, 1)).state, "expired");
  // Později zjištěná záruka už nastavenou nepřepíše; nákup bez detailu (druh neznáme) ji nedostane
  assert.equal(AlzaCore.applyOwnedWarranty(owned.alza_cz_8, { m: 36, b: true }), false);
  assert.equal(AlzaCore.applyOwnedWarranty({ buys: [{ t: 1, o: "3" }] }, { m: 36, b: false }), false);
  assert.equal(AlzaCore.applyOwnedWarranty(owned.alza_cz_8, { m: 36, b: false }), true);
  assert.equal(owned.alza_cz_8.buys[1].w, 36);
});

test("applyOwnedDetails: odhad vratky (zboží ve dvou částech bez reklamace) po konci záruky nákup nezmění", () => {
  const split = order([goods(9, 500, { claim: false })], [goods(9, 500, { claim: false })]);
  const details = AlzaCore.parseOwnedDetails(split, "alza_cz");
  assert.equal(details.alza_cz_9.guess, true);
  const bought = at(2024, 6, 1);
  const inWarranty = { alza_cz_9: { domain: "alza_cz", buys: [{ t: bought, n: 2, o: "5" }] } };
  AlzaCore.applyOwnedDetails(inWarranty, "5", details, "alza_cz", at(2024, 7, 1));
  assert.equal(inWarranty.alza_cz_9.buys[0].ret, true);
  const afterWarranty = { alza_cz_9: { domain: "alza_cz", buys: [{ t: bought, n: 2, o: "5", claim: true, ret: false, at: at(2024, 7, 1) }] } };
  AlzaCore.applyOwnedDetails(afterWarranty, "5", details, "alza_cz", at(2026, 6, 15));
  assert.equal(afterWarranty.alza_cz_9.buys[0].ret, false);
});

test("getOwnedDetailQueue: detail se čte znovu po lhůtě pro vrácení, při reklamaci, před koncem záruky a u delší záruky", () => {
  const queue = (buy, now) => plain(AlzaCore.getOwnedDetailQueue({ alza_cz_1: { domain: "alza_cz", buys: [{ n: 1, o: "9", dv: AlzaCore.ownedDetailVersion, claim: true, ret: false, ...buy }] } }, "alza_cz", now));
  const t = at(2025, 1, 10);
  // Detail načtený 2 dny po nákupu: do 30 dnů nic, pak jednou znovu
  assert.deepEqual(queue({ t, at: t + 2 * DAY }, t + 20 * DAY), []);
  assert.deepEqual(queue({ t, at: t + 2 * DAY }, t + 40 * DAY), ["9"]);
  assert.deepEqual(queue({ t, at: t + 40 * DAY }, t + 200 * DAY), []);
  // Rozpracovaná reklamace: znovu po 30 dnech
  assert.deepEqual(queue({ t, at: t + 100 * DAY, rma: true, claim: false }, t + 110 * DAY), []);
  assert.deepEqual(queue({ t, at: t + 100 * DAY, rma: true, claim: false }, t + 140 * DAY), ["9"]);
  // Do 60 dnů před koncem záruky se starým detailem; s čerstvým už ne. Vrácené zboží se nenačítá
  const until = AlzaCore.addMonths(t, 24);
  assert.deepEqual(queue({ t, at: t + 40 * DAY }, until - 50 * DAY), ["9"]);
  assert.deepEqual(queue({ t, at: until - 55 * DAY }, until - 50 * DAY), []);
  assert.deepEqual(queue({ t, at: t + 40 * DAY, ret: true, claim: false }, until - 50 * DAY), []);
  // Delší záruka ověřená po 24 měsících: znovu po 90 dnech
  assert.deepEqual(queue({ t, at: until + 10 * DAY }, until + 60 * DAY), []);
  assert.deepEqual(queue({ t, at: until + 10 * DAY }, until + 120 * DAY), ["9"]);
});

test("getWarrantyReminders + getWarrantyState: připomínka jen s čerstvým detailem, delší záruka bez ověření skončí", () => {
  const t = at(2025, 1, 10);
  const until = AlzaCore.addMonths(t, 24);
  const now = until - 20 * DAY;
  const owned = (detailAt) => ({ alza_cz_1: { domain: "alza_cz", name: "Televize", buys: [{ t, n: 1, o: "9", p: 20000, claim: true, ret: false, at: detailAt }] } });
  // Detail z doby nákupu: zboží mohlo být mezitím vráceno – nejdřív ho načte fronta
  assert.equal(AlzaCore.getWarrantyReminders(owned(t + 2 * DAY), now).length, 0);
  assert.deepEqual(plain(AlzaCore.getOwnedDetailQueue(owned(t + 2 * DAY), "alza_cz", now)), ["9"]);
  assert.equal(AlzaCore.getWarrantyReminders(owned(until - 30 * DAY), now).length, 1);
  // Delší záruka: platí 180 dní od posledního ověření, pak „skončila“
  const extended = { t, claim: true, ret: false, at: until + 10 * DAY };
  assert.equal(AlzaCore.getWarrantyState(extended, until + 100 * DAY).state, "extended");
  assert.equal(AlzaCore.getWarrantyState(extended, until + 400 * DAY).state, "expired");
});

test("getDocumentWarranty: řádek záruky u nefiremního účtu, blok výhod u firemního, roky i jiné jazyky", () => {
  const doc = ({ row = null, usp = [] }) => ({
    querySelector: (selector) => (selector === '[data-testid="more-info-warranty"]' && row ? { textContent: row } : null),
    querySelectorAll: () => usp.map((text) => ({ parentElement: { textContent: text } })),
  });
  assert.deepEqual(plain(AlzaCore.getDocumentWarranty(doc({ row: "Záruka 24 měsíců" }))), { m: 24, b: false });
  assert.deepEqual(plain(AlzaCore.getDocumentWarranty(doc({ row: "Záruka 3 roky" }))), { m: 36, b: false });
  assert.deepEqual(plain(AlzaCore.getDocumentWarranty(doc({ row: "Garancia 36 hónap" }))), { m: 36, b: false });
  assert.deepEqual(plain(AlzaCore.getDocumentWarranty(doc({ usp: ["Máte nárok na vrácení zboží zdarma do 14 dní", "Pro firemní nákupy: Záruka 12 měsíců"] }))), { m: 12, b: true });
  assert.deepEqual(plain(AlzaCore.getDocumentWarranty(doc({ usp: ["Pre firemné nákupy: Záruka 24 mesiacov"] }))), { m: 24, b: true });
  assert.equal(AlzaCore.getDocumentWarranty(doc({ usp: ["Máte nárok na vrácení zboží zdarma do 14 dní"] })), null);
  assert.equal(AlzaCore.getDocumentWarranty(doc({})), null);
});

test("store: setWarranty zapíše záruku k záznamu ceny i ke koupenému kusu, applyOwnedDetails ji vezme ze záznamu", async () => {
  const url = "https://www.alza.cz/zbozi-d8.htm";
  const { AlzaStore, data } = setupStore({
    alzaPrice_alza_cz_8: { original: 2000, lastUpdated: 1 },
    alzaOwned: { alza_cz_8: { domain: "alza_cz", url, buys: [{ t: at(2026, 1, 10), n: 1, o: "1", at: at(2026, 1, 12), claim: true, ret: false }, { t: at(2026, 5, 10), n: 1, o: "2" }] } },
  });
  await AlzaStore.run({ type: "setWarranty", domain: "alza_cz", url, warranty: { m: 36, b: false } });
  assert.deepEqual(plain(data.alzaPrice_alza_cz_8.warranty), { m: 36, b: false });
  assert.equal(data.alzaPrice_alza_cz_8.original, 2000);
  assert.equal(data.alzaOwned.alza_cz_8.buys[0].w, 36);
  assert.equal(data.alzaOwned.alza_cz_8.buys[1].w, undefined);
  // Druhý nákup dostane záruku ze záznamu ceny, jakmile se načte detail jeho objednávky
  await AlzaStore.run({ type: "applyOwnedDetails", domain: "alza_cz", results: [{ order: "2", details: { alza_cz_8: { p: 1900, claim: true, ret: false, rma: false, n: 1 } } }] });
  assert.equal(data.alzaOwned.alza_cz_8.buys[1].w, 36);
  // Neplatná záruka a produkt bez záznamu ceny nic nezapíší
  await AlzaStore.run({ type: "setWarranty", domain: "alza_cz", url, warranty: { m: 0, b: false } });
  await AlzaStore.run({ type: "setWarranty", domain: "alza_cz", url: "https://www.alza.cz/jine-d99.htm", warranty: { m: 24, b: false } });
  assert.equal(data.alzaPrice_alza_cz_8.warranty.m, 36);
  assert.equal("alzaPrice_alza_cz_99" in data, false);
});

// === Hlídané seznamy ===

test("parseCommodityList: nečitelná položka nesmí vypadat jako odebraná ze seznamu", () => {
  const entry = (id, navigationUrl = `https://www.alza.cz/produkt-d${id}.htm`) => ({ id, name: `Produkt ${id}`, navigationUrl, img: `https://image.alza.cz/${id}.jpg` });
  const response = (items) => ({ err: 0, data: [{ id: 5, name: "Seznam", itemCount: items.length, items }] });
  const previous = { "https://www.alza.cz/produkt-d1.htm": { name: "Produkt 1" }, "https://www.alza.cz/produkt-d2.htm": { name: "Produkt 2" } };
  const options = { domain: "alza_cz", listId: 5, products: previous };
  // API začne vracet relativní adresy: uložený obsah zůstane (null), místo aby se seznam vyprázdnil
  assert.equal(AlzaCore.parseCommodityList(response([entry(1, "/produkt-d1.htm"), entry(2, "/produkt-d2.htm")]), options), null);
  // Položka bez adresy navíc (poukaz) nevadí, dokud žádný známý produkt nechybí
  const withVoucher = AlzaCore.parseCommodityList(response([entry(1), entry(2), entry(3, null)]), options);
  assert.deepEqual(Object.keys(withVoucher.products).length, 2);
  // Skutečné odebrání bez nečitelných položek se pozná dál
  assert.deepEqual(plain(AlzaCore.parseCommodityList(response([entry(1)]), options).removed), ["Produkt 2"]);
});

// === Výpisy kategorií ===

test("getListingParameter: tisíce tečkou u mAh, desetiny u Wh, balení článků bez přepočtu", () => {
  const parameter = (description) => AlzaCore.getListingParameter("Produkt", description);
  assert.equal(parameter("Powerbanka 10.000 mAh - USB-C").amount, 10000);
  assert.equal(parameter("Powerbanka 20 000 mAh - USB-C").amount, 20000);
  assert.equal(parameter("Nabíjecí baterie 2500 mAh - AA, 4 ks v balení"), null);
  assert.equal(parameter("Nabíjecí stanice - baterie LiFePo4 o kapacitě 268.8 Wh, výkon 300 W").amount, 268.8);
  assert.equal(parameter("Nabíjecí stanice - baterie LiFePo4 o kapacitě 1.024 Wh").amount, 1024);
  assert.equal(parameter("Nabíjecí stanice - baterie LiFePo4 o kapacitě 288 Wh, výkon 300 W").amount, 288);
});

test("getListingEnergy + formatParameterPrice: mezera tisíců za „roční spotřeba“, dvojice s lomítkem, €/GB pod 1", () => {
  assert.deepEqual(plain(AlzaCore.getListingEnergy("Lednice, roční spotřeba 1 250 kWh/rok")), { kwh: 1250, per: "year" });
  assert.deepEqual(plain(AlzaCore.getListingEnergy("Lednice - roční spotřeba 140 kWh/rok, objem 300 l")), { kwh: 140, per: "year" });
  assert.deepEqual(plain(AlzaCore.getListingEnergy("Mrazák E, objem 2 215 kWh/rok")), { kwh: 215, per: "year" });
  assert.equal(AlzaCore.getListingEnergy("Pračka se sušičkou 49 / 300 kWh/100 cyklů"), null);
  assert.equal(AlzaCore.getListingEnergy("Pračka se sušičkou 49 a 300 kWh / 100 cyklů"), null);
  assert.deepEqual(plain(AlzaCore.getListingEnergy("Pračka - vážená spotřeba energie 33 kWh/100 cyklů")), { kwh: 33, per: "cycles" });
  assert.notEqual(AlzaCore.formatParameterPrice(18.9 / 256, "GB", "alza_sk"), AlzaCore.formatParameterPrice(21.5 / 256, "GB", "alza_sk"));
  assert.match(AlzaCore.formatParameterPrice(0.0049, "GB", "alza_sk"), /^0,0049\s€\/GB$/);
  assert.match(AlzaCore.formatParameterPrice(3.117, "GB", "alza_cz"), /^3,12\sKč\/GB$/);
});

test("getListingFilterPrices: cena člena AlzaPlus+ jako kupón s cenou „Bez členství“ jako běžnou", () => {
  const item = (header, nonMember) => ({
    querySelector: (selector) => {
      if (selector === AlzaCore.listingSelectors.priceHeader) return header ? { textContent: header } : null;
      if (selector === AlzaCore.listingSelectors.nonMemberPrice) return nonMember ? { textContent: nonMember } : null;
      return null;
    },
  });
  const member = AlzaCore.getListingFilterPrices(item("-14 % S ALZAPLUS+", "Bez členství: 499,-"), { special: 429 });
  assert.deepEqual(plain(member), { applus: 429, original: 499 });
  const discount = AlzaCore.getListingDiscount(member, []);
  assert.equal(discount.coupon, true);
  assert.equal(discount.percent, 14);
  // Jiná akční cena a dlaždice bez hlavičky zůstávají
  assert.deepEqual(plain(AlzaCore.getListingFilterPrices(item("Black Friday -10 %", null), { special: 429, original: 480 })), { special: 429, original: 480 });
  assert.deepEqual(plain(AlzaCore.getListingFilterPrices(item(null, null), { original: 480 })), { original: 480 });
});

// === Texty chyb ===

test("localizeError: známé důvody selhání v jazyce rozhraní, ostatní beze změny; překlad ve všech jazycích", () => {
  assert.equal(AlzaCore.localizeError("en", "přesměrováno mimo Alzu"), "redirected away from Alza");
  assert.equal(AlzaCore.localizeError("cz", "odpověď není JSON (nepřihlášen?)"), "odpověď není JSON (nepřihlášen?)");
  assert.equal(AlzaCore.localizeError("hu", "HTTP 403"), "HTTP 403");
  assert.equal(AlzaCore.localizeError("sk", new Error("timeout").message), "vypršal čas");
  Object.values(AlzaCore.errorTextKeys).forEach((key) => ["cz", "sk", "hu", "en"].forEach((lang) => assert.ok(AlzaCore.texts[lang][key], `${lang}.${key}`)));
});

// === Délka záruky z API produktu (načítání Mých nákupů) ===

test("parseProductWarranty + getOwnedWarrantyQueue: záruka z API produktu, fronta od nejnovějších nákupů", () => {
  assert.equal(AlzaCore.parseProductWarranty({ err: 0, data: { warranty: "36 měsíců" } }), 36);
  assert.equal(AlzaCore.parseProductWarranty({ err: 0, data: { warranty: "5 let" } }), 60);
  assert.equal(AlzaCore.parseProductWarranty({ err: 0, data: { warranty: null } }), null);
  assert.equal(AlzaCore.parseProductWarranty({ err: 1, data: { warranty: "24 měsíců" } }), null);
  assert.equal(AlzaCore.getProductApiUrl("alza_sk", "123"), "https://www.alza.sk/api/router/legacy/catalog/product/123");
  assert.equal(AlzaCore.getProductApiUrl("alza_cz", "12a"), null);

  const now = at(2026, 11, 12);
  const owned = {
    alza_cz_1: { domain: "alza_cz", buys: [{ t: at(2026, 1, 5), o: "1" }] },
    alza_cz_2: { domain: "alza_cz", buys: [{ t: at(2026, 6, 5), o: "2" }] },
    alza_cz_3: { domain: "alza_cz", buys: [{ t: at(2026, 7, 5), o: "3", w: 24 }] }, // záruku už má
    alza_cz_4: { domain: "alza_cz", buys: [{ t: at(2026, 8, 5), o: "4", ret: true }] }, // vráceno
    alza_cz_5: { domain: "alza_cz", buys: [{ t: at(2020, 1, 5), o: "5" }] }, // starší než 60 měsíců
    alza_cz_6: { domain: "alza_cz", wa: now - 5 * DAY, buys: [{ t: at(2026, 9, 5), o: "6" }] }, // ptali jsme se před 5 dny
    alza_cz_7: { domain: "alza_cz", wa: now - 40 * DAY, buys: [{ t: at(2026, 10, 5), o: "7" }] }, // ptali jsme se dávno
    alza_sk_8: { domain: "alza_sk", buys: [{ t: at(2026, 10, 9), o: "8" }] },
  };
  assert.deepEqual(plain(AlzaCore.getOwnedWarrantyQueue(owned, "alza_cz", now)), [{ key: "alza_cz_7", id: "7" }, { key: "alza_cz_2", id: "2" }, { key: "alza_cz_1", id: "1" }]);
  // Výsledek: měsíce všem nákupům bez záruky (i bez načteného detailu objednávky); nezjištěná = jen „ptali jsme se“
  AlzaCore.applyOwnedWarrantyResult(owned, "alza_cz_1", 36, now);
  AlzaCore.applyOwnedWarrantyResult(owned, "alza_cz_2", 0, now);
  assert.equal(owned.alza_cz_1.buys[0].w, 36);
  assert.equal(owned.alza_cz_2.buys[0].w, undefined);
  assert.deepEqual(plain(AlzaCore.getOwnedWarrantyQueue(owned, "alza_cz", now)), [{ key: "alza_cz_7", id: "7" }]);
});

test("AlzaOwned.syncWarranties: zjistí záruky po dávce, neexistující produkt se neptá znovu, odmítnutí dávku ukončí", async () => {
  const now = Date.now();
  const buys = (days) => [{ t: now - days * DAY, n: 1, o: String(days) }];
  const storage = {
    alzaSettings: { ownedItems: true },
    alzaOwned: Object.fromEntries([1, 2, 3, 4].map((id) => [`alza_cz_${id}`, { domain: "alza_cz", url: `https://www.alza.cz/p-d${id}.htm`, buys: buys(id * 10) }])),
  };
  const { chrome, context } = loadCore({ storage, files: ["src/shared/store.js", "src/shared/orders.js"] });
  context.AlzaStore.isWriter = true;
  const AlzaOwned = require("node:vm").runInContext("AlzaOwned", context); // const skriptu není vlastnost globálního objektu
  AlzaOwned.pageDelayMs = 0;
  const calls = [];
  const replies = { 1: { err: 0, data: { warranty: "24 měsíců" } }, 2: { err: 0, data: { warranty: "60 měsíců" } }, 3: new Error("HTTP 404"), 4: { err: 0, data: {} } };
  const getJson = async (url) => {
    const id = url.match(/^https:\/\/www\.alza\.cz\/api\/router\/legacy\/catalog\/product\/(\d+)$/)?.[1];
    calls.push(id);
    if (replies[id] instanceof Error) throw replies[id];
    return replies[id];
  };
  const result = await AlzaOwned.syncWarranties({ domainKey: "alza_cz", getJson });
  assert.deepEqual(plain(result), { count: 4, pending: 0 });
  assert.deepEqual(calls, ["1", "2", "3", "4"]); // od nejnovějšího nákupu
  const owned = chrome.storage.local.data.alzaOwned;
  assert.deepEqual(plain([1, 2, 3, 4].map((id) => owned[`alza_cz_${id}`].buys[0].w ?? null)), [24, 60, null, null]);
  assert.ok([1, 2, 3, 4].every((id) => owned[`alza_cz_${id}`].wa > 0));
  // Podruhé už není na co se ptát
  assert.deepEqual(plain(await AlzaOwned.syncWarranties({ domainKey: "alza_cz", getJson })), { count: 0, pending: 0 });
  assert.equal(calls.length, 4);
  // Odmítnutí (403): dávka končí, produkty zůstanou ve frontě; vypnutá volba = nic
  [1, 2, 3, 4].forEach((id) => delete owned[`alza_cz_${id}`].wa);
  [3, 4].forEach((id) => (replies[id] = new Error("HTTP 403")));
  assert.deepEqual(plain(await AlzaOwned.syncWarranties({ domainKey: "alza_cz", getJson })), { count: 0, pending: 2, blocked: true });
  chrome.storage.local.data.alzaSettings = { ownedItems: false };
  const before = calls.length;
  assert.deepEqual(plain(await AlzaOwned.syncWarranties({ domainKey: "alza_cz", getJson })), { count: 0, pending: 0 });
  assert.equal(calls.length, before);
});
