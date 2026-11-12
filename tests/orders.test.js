// Testy načítání objednávek (src/shared/orders.js): hlídání po nákupu (AlzaOrders) a Moje nákupy (AlzaOwned).
// API Alzy nahrazuje podstrčené getJson / getUserId – žádný síťový požadavek: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadCore } = require("./load-core");

const plain = (value) => JSON.parse(JSON.stringify(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const USER = "987654321"; // Číslo účtu – nesmí se objevit v úložišti
const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
const ORIGINS = { alza_cz: "https://www.alza.cz", alza_sk: "https://www.alza.sk", alza_hu: "https://www.alza.hu" };
const baseOf = (domainKey) => `${ORIGINS[domainKey]}/api/users/${USER}/v1/orders`;

function setup(storage = {}) {
  const { AlzaCore, chrome, context } = loadCore({ storage: { alzaSettings: { ownedItems: true }, ...storage }, files: ["src/shared/store.js", "src/shared/orders.js"] });
  context.AlzaStore.isWriter = true;
  // const na nejvyšší úrovni skriptu není vlastnost globálního objektu – čte se jménem
  const AlzaOrders = vm.runInContext("AlzaOrders", context);
  const AlzaOwned = vm.runInContext("AlzaOwned", context);
  AlzaOrders.detailDelayMs = 0;
  AlzaOwned.pageDelayMs = 0;
  const written = [];
  chrome.storage.onChanged.addListener((changes) => written.push(...Object.keys(changes)));
  return { AlzaCore, AlzaOrders, AlzaOwned, chrome, data: chrome.storage.local.data, written };
}

// Odpověď = hodnota, funkce (zavolá se), nebo Error (vyhodí se – jako getJson při „HTTP <stav>“)
const reply = (value, ...args) => {
  const result = typeof value === "function" ? value(...args) : value;
  if (result instanceof Error) throw result;
  return result;
};

// === Hlídání po nákupu ===

const order = (domainKey, id, daysAgo, state = "Vyřízena") => ({ orderId: String(id), created: iso(daysAgo), state, self: { href: `${baseOf(domainKey)}/${id}/` } });
const item = (id, price, extra = {}) => ({
  commodityId: id,
  commodityUrl: `/zbozi-d${id}.htm`,
  commodityName: `Zboží ${id}`,
  pricePerItem: price,
  count: 1,
  status: "Vyzvednuto",
  onClaimItemGuideClick: { enabled: true },
  warrantyClaimMessageBanners: [],
  ...extra,
});
const detail = (daysAgo, items) => ({ created: iso(daysAgo), parts: [{ created: iso(daysAgo), items }] });

// Náhrada API objednávek: active / archive = pole objednávek (nebo hotová odpověď), details = { číslo objednávky: detail }
function shop(domainKey, { active = [], archive = [], details = {} } = {}) {
  const base = baseOf(domainKey);
  const api = { active, archive, details, userId: USER, userIdCalls: 0, calls: [], times: [] };
  api.detailCalls = () => api.calls.filter((call) => /^\/\d+\/$/.test(call));
  api.args = (extra = {}) => ({
    domainKey,
    origin: ORIGINS[domainKey],
    getUserId: async () => {
      api.userIdCalls++;
      return api.userId;
    },
    getJson: async (url) => {
      assert.ok(url.startsWith(base), `dotaz mimo API objednávek: ${url}`);
      const path = url.slice(base.length);
      api.calls.push(path);
      api.times.push(Date.now());
      if (path.startsWith("/active?")) {
        const value = reply(api.active);
        return Array.isArray(value) ? { groups: [{ orders: value }] } : value;
      }
      if (path.startsWith("/archive?")) {
        const value = reply(api.archive);
        return Array.isArray(value) ? { value } : value;
      }
      const id = path.match(/^\/(\d+)\/$/)?.[1];
      if (!id || !Object.hasOwn(api.details, id)) throw new Error("HTTP 404");
      return reply(api.details[id], id);
    },
    ...extra,
  });
  return api;
}

test("AlzaOrders.check: úplné načtení uloží nákupy, čas a otisk; číslo účtu se neukládá", async () => {
  const { AlzaCore, AlzaOrders, data } = setup();
  const api = shop("alza_cz", {
    active: [order("alza_cz", 1002, 1, "Připravujeme")],
    archive: [order("alza_cz", 1001, 3), order("alza_cz", 900, 40), order("alza_cz", 1000, 2, "Zrušena")],
    details: { 1001: detail(3, [item(111, "428 Kč/ks")]), 1002: detail(1, [item(222, "31 490 Kč/ks", { count: 2 })]) },
  });
  const result = await AlzaOrders.check(api.args());
  assert.deepEqual(plain(result), { status: "synced", added: ["Zboží 111", "Zboží 222"] });
  // Jen objednávky ve lhůtě a nezrušené: 2 detaily; číslo účtu se zjišťuje jednou
  assert.deepEqual(api.detailCalls(), ["/1001/", "/1002/"]);
  assert.equal(api.userIdCalls, 1);
  const bought = data.alzaPurchases.alza_cz_111;
  assert.equal(bought.price, 428);
  assert.equal(bought.domain, "alza_cz");
  assert.equal(bought.url, "https://www.alza.cz/zbozi-d111.htm");
  assert.equal(bought.returnUntil, bought.boughtAt + AlzaCore.purchaseReturnDays * DAY);
  assert.equal(data.alzaPurchases.alza_cz_222.price, 31490);
  const sync = data.alzaPurchasesSync;
  assert.ok(Date.now() - sync.alza_cz < 5000);
  assert.ok(Date.now() - sync["alza_cz:probe"] < 5000);
  assert.equal(sync["alza_cz:mark"], AlzaOrders.mark({ groups: [{ orders: api.active }] }));
  assert.ok(!JSON.stringify(data).includes(USER), "číslo účtu nesmí být v úložišti");
});

test("AlzaOrders.check: zabraný čas kontroly – další kontrola až po purchaseProbeMinutes, always ji obejde", async () => {
  const { AlzaCore, AlzaOrders, data } = setup();
  const api = shop("alza_cz", { active: [order("alza_cz", 1002, 1)], details: { 1002: detail(1, [item(222, "100 Kč/ks")]) } });
  assert.equal((await AlzaOrders.check(api.args())).status, "synced");
  api.calls.length = 0;
  api.userIdCalls = 0;
  assert.deepEqual(plain(await AlzaOrders.check(api.args())), { status: "skipped", added: [] });
  assert.deepEqual([api.calls.length, api.userIdCalls], [0, 0]);
  // Stránka Moje objednávky / tlačítko Zkontrolovat: bez omezení – stejný otisk = jen seznam aktivních objednávek
  assert.deepEqual(plain(await AlzaOrders.check(api.args({ always: true }))), { status: "unchanged", added: [] });
  assert.deepEqual(api.calls, ["/active?productFilterType=0"]);
  // Po purchaseProbeMinutes se kontroluje znovu; nová objednávka (jiný otisk) = hned úplné načtení
  data.alzaPurchasesSync["alza_cz:probe"] -= AlzaCore.purchaseProbeMinutes * 60 * 1000;
  api.active = [...api.active, order("alza_cz", 1003, 0)];
  api.details[1003] = detail(0, [item(333, "50 Kč/ks")]);
  assert.deepEqual(plain(await AlzaOrders.check(api.args())), { status: "synced", added: ["Zboží 333"] });
  // Úplné načtení i beze změny otisku po purchaseSyncHours
  data.alzaPurchasesSync["alza_cz:probe"] = 0;
  data.alzaPurchasesSync.alza_cz -= AlzaCore.purchaseSyncHours * 60 * 60 * 1000;
  assert.equal((await AlzaOrders.check(api.args())).status, "synced");
});

test("AlzaOrders.check: dvě souběžné kontroly – načítá ta, která čas zabrala poslední", async () => {
  const { AlzaOrders } = setup();
  const api = shop("alza_cz", { active: [order("alza_cz", 1002, 1)], details: { 1002: detail(1, [item(222, "100 Kč/ks")]) } });
  const first = AlzaOrders.check(api.args({ waitMs: 40 }));
  await sleep(10);
  const second = AlzaOrders.check(api.args({ always: true, waitMs: 40 }));
  assert.deepEqual([(await first).status, (await second).status], ["skipped", "synced"]);
  assert.equal(api.userIdCalls, 1);
});

test("AlzaOrders.check: po chybě načtení zůstane krátká brzda, always ji ignoruje", async () => {
  const { AlzaCore, AlzaOrders, data } = setup({ alzaPurchasesSync: { alza_cz: 5, "alza_cz:probe": 7, "alza_cz:mark": "x" } });
  const probeMs = AlzaCore.purchaseProbeMinutes * 60 * 1000;
  const retryMs = AlzaOrders.retryMinutes * 60 * 1000;
  const api = shop("alza_cz", { active: new Error("HTTP 500") });
  await assert.rejects(() => AlzaOrders.check(api.args()), /objednávky se nepodařilo načíst/);
  // Čas kontroly se nevrátil na původní hodnotu: další pokus nejdřív za retryMinutes
  const probe = data.alzaPurchasesSync["alza_cz:probe"];
  const left = probe + probeMs - Date.now();
  assert.ok(left > retryMs - 5000 && left <= retryMs, `do dalšího pokusu ${left} ms`);
  assert.deepEqual(plain({ at: data.alzaPurchasesSync.alza_cz, mark: data.alzaPurchasesSync["alza_cz:mark"] }), { at: 5, mark: "x" });
  api.calls.length = 0;
  assert.equal((await AlzaOrders.check(api.args())).status, "skipped");
  assert.equal(api.calls.length, 0);
  // Špatný tvar odpovědi (otisk null) je také chyba; always brzdu ignoruje a čekání, které už běží, nezkrátí
  api.active = { orders: [] };
  await assert.rejects(() => AlzaOrders.check(api.args({ always: true })), /nepodařilo načíst/);
  assert.equal(api.calls.length, 1);
  assert.ok(data.alzaPurchasesSync["alza_cz:probe"] >= probe);
  const recent = Date.now() - 60 * 1000; // kontrola před minutou: do další zbývá víc než brzda
  data.alzaPurchasesSync["alza_cz:probe"] = recent;
  await assert.rejects(() => AlzaOrders.check(api.args({ always: true })), /nepodařilo načíst/);
  assert.equal(data.alzaPurchasesSync["alza_cz:probe"], recent);
  // Po uplynutí brzdy se zkouší znovu
  data.alzaPurchasesSync["alza_cz:probe"] = probe - retryMs;
  api.active = [];
  assert.equal((await AlzaOrders.check(api.args())).status, "synced");
});

test("AlzaOrders.check: výjimka při zjišťování čísla účtu také nechá brzdu", async () => {
  const { AlzaCore, AlzaOrders, data } = setup();
  const api = shop("alza_cz");
  const args = api.args({
    getUserId: async () => {
      throw new Error("HTTP 503");
    },
  });
  await assert.rejects(() => AlzaOrders.check(args), /HTTP 503/);
  assert.ok(Date.now() - data.alzaPurchasesSync["alza_cz:probe"] < AlzaCore.purchaseProbeMinutes * 60 * 1000);
  assert.equal((await AlzaOrders.check(api.args())).status, "skipped");
});

test("AlzaOrders.check: nepřihlášený – žádný dotaz na objednávky a další pokus až po brzdě", async () => {
  const { AlzaCore, AlzaOrders, data, written } = setup();
  const api = shop("alza_cz", { active: [] });
  api.userId = null;
  assert.deepEqual(plain(await AlzaOrders.check(api.args())), { status: "noLogin", added: [] });
  assert.deepEqual([api.userIdCalls, api.calls.length], [1, 0]);
  const left = data.alzaPurchasesSync["alza_cz:probe"] + AlzaCore.purchaseProbeMinutes * 60 * 1000 - Date.now();
  assert.ok(left > 0 && left <= AlzaOrders.retryMinutes * 60 * 1000);
  // Další načtení stránky Alzy: nic se neptá ani nezapisuje
  written.length = 0;
  assert.equal((await AlzaOrders.check(api.args())).status, "skipped");
  assert.deepEqual([api.userIdCalls, written.length], [1, 0]);
  // Na stránce Moje objednávky (always) se zkusí hned
  api.userId = USER;
  assert.equal((await AlzaOrders.check(api.args({ always: true }))).status, "synced");
});

test("AlzaOrders.mark: otisk se mění s novou, zrušenou i doručenou objednávkou; špatná odpověď = null", () => {
  const { AlzaOrders } = setup();
  const mark = (orders) => AlzaOrders.mark({ groups: [{ orders }] });
  const first = order("alza_cz", 1001, 1, "Připravujeme");
  const second = order("alza_cz", 1002, 0, "Připravujeme");
  assert.match(mark([first]), /^[0-9a-z]+$/);
  assert.equal(mark([first, second]), mark([second, first])); // nezáleží na pořadí
  assert.equal(AlzaOrders.mark({ groups: [{ orders: [first] }, { orders: [second] }] }), mark([first, second])); // ani na skupinách
  assert.notEqual(mark([first]), mark([first, second]));
  assert.notEqual(mark([first]), mark([{ ...first, state: "Zrušena" }]));
  assert.notEqual(mark([first]), mark([{ ...first, state: "Připraveno k vyzvednutí" }]));
  assert.notEqual(mark([first]), mark([]));
  assert.equal(typeof mark([]), "string"); // žádná aktivní objednávka je platná odpověď
  assert.ok(!mark([first]).includes("1001"), "otisk nenese číslo objednávky");
  for (const bad of [null, undefined, "x", 5, {}, { groups: "x" }, { orders: [] }]) assert.equal(AlzaOrders.mark(bad), null);
});

// Uložené nákupy: 111 je v objednávkách, 222 už ne (zrušeno / vráceno), 333 má prošlou lhůtu, 444 je z jiné Alzy
const storedPurchases = () => {
  const now = Date.now();
  const purchase = (domain, extra = {}) => ({ url: `${ORIGINS[domain]}/x.htm`, domain, name: "Starý název", price: 500, count: 1, boughtAt: now - 2 * DAY, returnUntil: now + 12 * DAY, ...extra });
  return {
    alzaPurchases: {
      alza_cz_111: purchase("alza_cz", { notifiedPrice: 390 }),
      alza_cz_222: purchase("alza_cz"),
      alza_cz_333: purchase("alza_cz", { boughtAt: now - 20 * DAY, returnUntil: now - 6 * DAY }),
      alza_sk_444: purchase("alza_sk"),
    },
    alzaCashbackReminders: { alza_cz_222: { terms: "t" }, alza_sk_444: { terms: "t" } },
  };
};

test("AlzaOrders.sync: po úplném načtení zmizí nákupy, které v objednávkách už nejsou, i jejich připomínka cashbacku", async () => {
  const { AlzaOrders, data } = setup(storedPurchases());
  const api = shop("alza_cz", { archive: [order("alza_cz", 1001, 2)], details: { 1001: detail(2, [item(111, "428 Kč/ks")]) } });
  assert.deepEqual(plain(await AlzaOrders.check(api.args())), { status: "synced", added: [] }); // 111 už bylo známé
  assert.deepEqual(Object.keys(data.alzaPurchases).sort(), ["alza_cz_111", "alza_sk_444"]);
  assert.equal(data.alzaPurchases.alza_cz_111.price, 428);
  assert.equal(data.alzaPurchases.alza_cz_111.notifiedPrice, 390); // o jaké ceně už přišlo upozornění
  assert.deepEqual(Object.keys(data.alzaCashbackReminders), ["alza_sk_444"]);
});

test("AlzaOrders.sync: detail bez parts (změna API) není úplné načtení – nic ve lhůtě se nesmaže", async () => {
  for (const broken of [{ created: iso(2), items: [item(111, "428 Kč/ks")] }, { parts: "x" }, [], "text"]) {
    const { AlzaOrders, data } = setup(storedPurchases());
    const api = shop("alza_cz", { archive: [order("alza_cz", 1001, 2)], details: { 1001: broken } });
    assert.deepEqual(plain(await AlzaOrders.check(api.args())), { status: "synced", added: [] });
    // Zůstává vše ve lhůtě včetně připomínek; pryč je jen nákup s prošlou lhůtou
    assert.deepEqual(Object.keys(data.alzaPurchases).sort(), ["alza_cz_111", "alza_cz_222", "alza_sk_444"]);
    assert.equal(data.alzaPurchases.alza_cz_111.price, 500);
    assert.deepEqual(Object.keys(data.alzaCashbackReminders).sort(), ["alza_cz_222", "alza_sk_444"]);
  }
});

test("AlzaOrders.sync: nenačtený detail, nenačtený archiv, cizí adresa detailu a plný archiv nejsou úplné načtení", async () => {
  const run = async (options, tune = () => {}) => {
    const context = setup(storedPurchases());
    tune(context.AlzaOrders);
    await context.AlzaOrders.check(shop("alza_cz", options).args());
    return Object.keys(context.data.alzaPurchases).sort();
  };
  const kept = ["alza_cz_111", "alza_cz_222", "alza_sk_444"];
  const details = { 1001: detail(2, [item(111, "428 Kč/ks")]) };
  assert.deepEqual(await run({ archive: [order("alza_cz", 1001, 2), order("alza_cz", 1002, 1)], details: { ...details, 1002: new Error("HTTP 500") } }), kept);
  assert.deepEqual(await run({ active: [order("alza_cz", 1001, 2)], archive: new Error("HTTP 500"), details }), kept);
  assert.deepEqual(await run({ archive: [order("alza_cz", 1001, 2), { ...order("alza_cz", 1002, 1), self: { href: "https://evil.example/api/1002/" } }], details }), kept);
  assert.deepEqual(await run({ archive: [order("alza_cz", 1001, 2), { ...order("alza_cz", 1002, 1), self: { href: "https://[" } }], details }), kept);
  // Archiv plný objednávek ze lhůty (maxOrders) – starší z téže lhůty mohly zůstat za hranou
  const full = { archive: [order("alza_cz", 1001, 2), order("alza_cz", 1002, 1)], details: { ...details, 1002: detail(1, []) } };
  assert.deepEqual(await run(full, (orders) => (orders.maxOrders = 2)), kept);
  assert.deepEqual(await run(full), ["alza_cz_111", "alza_sk_444"]); // pod hranou je načtení úplné
});

test("AlzaOrders.sync: stejné zboží ve dvou objednávkách – nejnižší cena, čas nákupu k ní a nejpozdější lhůta", async () => {
  const bought = async (archive, details) => {
    const { AlzaOrders, data } = setup();
    await AlzaOrders.check(shop("alza_cz", { archive, details }).args());
    return data.alzaPurchases.alza_cz_111;
  };
  const RETURN = 14 * DAY;
  const near = (actual, daysAgo) => Math.abs(actual - (Date.now() - daysAgo * DAY)) < 5000;
  const orders = [order("alza_cz", 1002, 1), order("alza_cz", 1001, 6)]; // archiv od nejnovější
  // Dřívější nákup levnější, pozdější dražší: cena a čas nákupu z levnějšího, lhůta z pozdějšího
  let result = await bought(orders, { 1001: detail(6, [item(111, "400 Kč/ks")]), 1002: detail(1, [item(111, "450 Kč/ks", { commodityName: "Dražší" })]) });
  assert.equal(result.price, 400);
  assert.equal(result.name, "Zboží 111");
  assert.ok(near(result.boughtAt, 6), "čas nákupu patří k hlídané ceně");
  assert.ok(near(result.returnUntil - RETURN, 1), "lhůta z pozdějšího nákupu");
  // Totéž při opačném pořadí objednávek v odpovědi
  result = await bought([...orders].reverse(), { 1001: detail(6, [item(111, "400 Kč/ks")]), 1002: detail(1, [item(111, "450 Kč/ks")]) });
  assert.deepEqual([result.price, near(result.boughtAt, 6), near(result.returnUntil - RETURN, 1)], [400, true, true]);
  // Pozdější nákup levnější: vše z něj
  result = await bought(orders, { 1001: detail(6, [item(111, "450 Kč/ks")]), 1002: detail(1, [item(111, "400 Kč/ks")]) });
  assert.deepEqual([result.price, near(result.boughtAt, 1), near(result.returnUntil - RETURN, 1)], [400, true, true]);
  // Stejná cena: pozdější nákup (cena, čas i lhůta z jedné objednávky), ať je v odpovědi kdekoli
  for (const list of [orders, [...orders].reverse()]) {
    result = await bought(list, { 1001: detail(6, [item(111, "400 Kč/ks")]), 1002: detail(1, [item(111, "400 Kč/ks")]) });
    assert.deepEqual([result.price, near(result.boughtAt, 1), near(result.returnUntil - RETURN, 1)], [400, true, true]);
  }
});

test("AlzaOrders.sync: jistič – po HTTP 403 / 429 dávka detailů končí, načtení není úplné a zkusí se znovu", async () => {
  for (const status of [403, 429]) {
    const { AlzaCore, AlzaOrders, data } = setup(storedPurchases());
    const api = shop("alza_cz", {
      archive: [order("alza_cz", 1003, 1), order("alza_cz", 1002, 2), order("alza_cz", 1001, 3)],
      details: { 1003: detail(1, [item(555, "90 Kč/ks")]), 1002: new Error(`HTTP ${status}`), 1001: detail(3, [item(111, "428 Kč/ks")]) },
    });
    assert.deepEqual(plain(await AlzaOrders.check(api.args())), { status: "synced", added: ["Zboží 555"], blocked: true });
    assert.deepEqual(api.detailCalls(), ["/1003/", "/1002/"]); // třetí detail se už nezkouší
    // Co se načetlo, je uložené; nic se nesmazalo jako stažené; čas úplného načtení ani otisk se nezapsaly
    assert.deepEqual(Object.keys(data.alzaPurchases).sort(), ["alza_cz_111", "alza_cz_222", "alza_cz_555", "alza_sk_444"]);
    assert.deepEqual(Object.keys(data.alzaCashbackReminders).sort(), ["alza_cz_222", "alza_sk_444"]);
    assert.equal(data.alzaPurchasesSync.alza_cz, undefined);
    assert.equal(data.alzaPurchasesSync["alza_cz:mark"], undefined);
    // Další kontrola (po purchaseProbeMinutes) načte objednávky znovu celé
    data.alzaPurchasesSync["alza_cz:probe"] -= AlzaCore.purchaseProbeMinutes * 60 * 1000;
    api.details[1002] = detail(2, []);
    assert.deepEqual(plain(await AlzaOrders.check(api.args())), { status: "synced", added: [] });
    assert.ok(data.alzaPurchasesSync.alza_cz > 0);
    assert.deepEqual(Object.keys(data.alzaPurchases).sort(), ["alza_cz_111", "alza_cz_555", "alza_sk_444"]);
  }
});

test("AlzaOrders.sync: jistič – tři chyby za sebou dávku ukončí, chyby proložené úspěchem ne", async () => {
  const archive = [1005, 1004, 1003, 1002, 1001].map((id, index) => order("alza_cz", id, index + 1));
  const failing = new Error("HTTP 500");
  let context = setup();
  let api = shop("alza_cz", { archive, details: { 1005: failing, 1004: { parts: null }, 1003: new Error("timeout"), 1002: detail(4, []), 1001: detail(5, []) } });
  assert.deepEqual(plain(await context.AlzaOrders.check(api.args())), { status: "synced", added: [], blocked: true });
  assert.equal(api.detailCalls().length, 3);
  context = setup();
  api = shop("alza_cz", { archive, details: { 1005: failing, 1004: detail(2, []), 1003: failing, 1002: detail(4, [item(111, "10 Kč/ks")]), 1001: failing } });
  assert.deepEqual(plain(await context.AlzaOrders.check(api.args())), { status: "synced", added: ["Zboží 111"] });
  assert.equal(api.detailCalls().length, 5);
  assert.ok(context.data.alzaPurchasesSync.alza_cz > 0);
});

test("AlzaOrders.sync: mezi detaily objednávek je prodleva", async () => {
  const { AlzaOrders } = setup();
  AlzaOrders.detailDelayMs = 40;
  const api = shop("alza_cz", {
    archive: [order("alza_cz", 1003, 1), order("alza_cz", 1002, 2), order("alza_cz", 1001, 3)],
    details: { 1003: detail(1, []), 1002: detail(2, []), 1001: detail(3, []) },
  });
  await AlzaOrders.check(api.args());
  const times = api.times.slice(-3);
  assert.equal(api.detailCalls().length, 3);
  assert.ok(times[1] - times[0] >= 35 && times[2] - times[1] >= 35, `rozestupy ${times[1] - times[0]} a ${times[2] - times[1]} ms`);
  assert.ok(times[0] - api.times.at(-4) < 35, "před prvním detailem se nečeká");
});

test("AlzaOrders.sync: ceny v € a Ft (alza.sk, alza.hu)", async () => {
  const { AlzaOrders, data } = setup();
  const sk = shop("alza_sk", { archive: [order("alza_sk", 2001, 1)], details: { 2001: detail(1, [item(111, "12,90 €/ks"), item(112, "1 299,50 €/ks")]) } });
  const hu = shop("alza_hu", { active: [order("alza_hu", 3001, 1, "Feldolgozás alatt")], details: { 3001: detail(1, [item(111, "4 990 Ft/db", { count: 3 })]) } });
  assert.equal((await AlzaOrders.check(sk.args())).status, "synced");
  assert.equal((await AlzaOrders.check(hu.args())).status, "synced");
  assert.deepEqual(
    plain(Object.fromEntries(Object.entries(data.alzaPurchases).map(([key, { price, count, url, domain }]) => [key, { price, count, url, domain }]))),
    {
      alza_sk_111: { price: 12.9, count: 1, url: "https://www.alza.sk/zbozi-d111.htm", domain: "alza_sk" },
      alza_sk_112: { price: 1299.5, count: 1, url: "https://www.alza.sk/zbozi-d112.htm", domain: "alza_sk" },
      alza_hu_111: { price: 4990, count: 3, url: "https://www.alza.hu/zbozi-d111.htm", domain: "alza_hu" },
    }
  );
  // Každá doména má svůj čas kontroly a otisk
  assert.deepEqual(Object.keys(data.alzaPurchasesSync).sort(), ["alza_hu", "alza_hu:mark", "alza_hu:probe", "alza_sk", "alza_sk:mark", "alza_sk:probe"]);
});

// === Moje nákupy ===

const ownedItem = (domainKey, id, extra = {}) => ({
  commodityId: id,
  commodityUrl: `${ORIGINS[domainKey]}/zbozi-d${id}.htm`,
  commodityName: `Zboží ${id}`,
  status: "Vyzvednuto",
  count: 1,
  brand: "Značka",
  categorySegment1: "Audio-Video",
  ...extra,
});
// Objednávka archivu se zbožím číslo = číslo objednávky
const ownedOrder = (domainKey, id, daysAgo, extra = {}) => ({ orderId: String(id), created: iso(daysAgo), state: "Vyřízena", totalPrice: "7 709 Kč", items: [ownedItem(domainKey, id)], ...extra });
const ownedDetail = (domainKey, id, price) => ({
  created: iso(1),
  parts: [{ created: iso(1), items: [ownedItem(domainKey, id, { pricePerItem: price, onClaimItemGuideClick: { enabled: true }, warrantyClaimMessageBanners: [] })] }],
});

// Náhrada archivu: orders = všechny objednávky od nejnovější (stránkuje se podle offset / limit), details = { číslo: detail };
// bez záznamu v details vrací detail s cenou 100 Kč
function archiveShop(domainKey, orders, details = {}) {
  const base = baseOf(domainKey);
  const api = { orders, details, userId: USER, userIdCalls: 0, offsets: [], detailCalls: [], onArchive: null, onDetail: null };
  api.args = (extra = {}) => ({
    domainKey,
    origin: ORIGINS[domainKey],
    getUserId: async () => {
      api.userIdCalls++;
      return api.userId;
    },
    getJson: async (url) => {
      assert.ok(url.startsWith(base), `dotaz mimo API objednávek: ${url}`);
      const path = url.slice(base.length);
      if (path.startsWith("/archive?")) {
        const query = new URL(url).searchParams;
        const offset = Number(query.get("offset"));
        api.offsets.push(offset);
        if (api.onArchive) reply(api.onArchive, offset);
        return { paging: { size: api.orders.length }, value: api.orders.slice(offset, offset + Number(query.get("limit"))) };
      }
      const id = path.match(/^\/(\d+)\/$/)?.[1];
      assert.ok(id, `neznámý dotaz ${path}`);
      api.detailCalls.push(id);
      if (api.onDetail) reply(api.onDetail, id);
      return Object.hasOwn(api.details, id) ? reply(api.details[id], id) : ownedDetail(domainKey, Number(id), "100 Kč/ks");
    },
    ...extra,
  });
  return api;
}

// Uložený přehled: nákupy z objednávek ids (od nejnovější, den po dni), archiv načtený celý a čerstvě
const ownedStorage = (domainKey, ids, sync = {}) => {
  const now = Date.now();
  const owned = Object.fromEntries(ids.map((id, index) => [`${domainKey}_${id}`, { url: `${ORIGINS[domainKey]}/zbozi-d${id}.htm`, domain: domainKey, name: `Zboží ${id}`, buys: [{ t: now - (index + 1) * DAY, n: 1, o: String(id) }] }]));
  const orders = Object.fromEntries(ids.map((id, index) => [String(id), [now - (index + 1) * DAY, 7709]]));
  return { alzaOwned: owned, alzaOwnedOrders: { [domainKey]: orders }, alzaOwnedSync: { [domainKey]: { done: true, total: ids.length, offset: 0, at: now, ...sync } } };
};
const detailTimes = (data, domainKey, ids) => ids.map((id) => Boolean(data.alzaOwned[`${domainKey}_${id}`].buys[0].at));

test("AlzaOwned.sync: první načtení po stránkách, pokračuje od uloženého offsetu; pak už jen nové objednávky", async () => {
  const { AlzaCore, AlzaOwned, data } = setup();
  AlzaCore.ownedPageSize = 2;
  AlzaCore.ownedMaxPages = 2;
  AlzaCore.ownedDetailsPerRun = 0; // tady jen archiv
  const api = archiveShop("alza_cz", [7, 6, 5, 4, 3, 2, 1].map((id, index) => ownedOrder("alza_cz", id, index + 1)));
  // 1. běh: dvě stránky (ownedMaxPages), archiv ještě není celý
  let result = await AlzaOwned.sync(api.args());
  assert.deepEqual(plain(result), { status: "synced", added: 4, details: 0, pending: 4, done: false, total: 7 });
  assert.deepEqual(api.offsets, [0, 2]);
  assert.deepEqual(plain({ ...data.alzaOwnedSync.alza_cz, at: 0 }), { offset: 4, done: false, total: 7, at: 0 });
  // 2. běh naváže na offsetu 4 a archiv dokončí (poslední stránka je neúplná)
  api.offsets.length = 0;
  result = await AlzaOwned.sync(api.args());
  assert.deepEqual(plain(result), { status: "synced", added: 3, details: 0, pending: 7, done: true, total: 7 });
  assert.deepEqual(api.offsets, [4, 6]);
  assert.deepEqual(plain({ ...data.alzaOwnedSync.alza_cz, at: 0 }), { offset: 0, done: true, total: 7, at: 0 });
  assert.equal(Object.keys(data.alzaOwned).length, 7);
  assert.deepEqual(Object.keys(data.alzaOwnedOrders.alza_cz).sort(), ["1", "2", "3", "4", "5", "6", "7"]);
  assert.equal(api.userIdCalls, 2); // jednou za běh
  assert.ok(!JSON.stringify(data).includes(USER), "číslo účtu nesmí být v úložišti");
  // Načtený archiv: po kliknutí (force) jen první stránka, dokud nepřinese nic nového
  api.offsets.length = 0;
  result = await AlzaOwned.sync(api.args({ force: true }));
  assert.deepEqual([result.added, result.done], [0, true]);
  assert.deepEqual(api.offsets, [0]);
  // Dvě nové objednávky: stránka s novým nákupem → ještě další, ta už nic nového nepřinese
  api.orders = [ownedOrder("alza_cz", 9, 0), ownedOrder("alza_cz", 8, 0), ...api.orders];
  api.offsets.length = 0;
  result = await AlzaOwned.sync(api.args({ force: true }));
  assert.deepEqual([result.added, result.total], [2, 9]);
  assert.deepEqual(api.offsets, [0, 2]);
  // Na pozadí (bez force) se čerstvě načtený archiv neptá vůbec; bez fronty detailů ani na číslo účtu
  for (const product of Object.values(data.alzaOwned)) product.buys.forEach((buy) => Object.assign(buy, { at: Date.now(), dv: AlzaCore.ownedDetailVersion, claim: true, ret: false, p: 100 }));
  api.offsets.length = 0;
  api.userIdCalls = 0;
  assert.equal((await AlzaOwned.sync(api.args())).status, "skipped");
  assert.deepEqual([api.offsets.length, api.userIdCalls], [0, 0]);
  // …a po ownedSyncHours zase ano
  data.alzaOwnedSync.alza_cz.at -= AlzaCore.ownedSyncHours * 60 * 60 * 1000;
  assert.equal((await AlzaOwned.sync(api.args())).status, "synced");
  assert.deepEqual(api.offsets, [0]);
});

test("AlzaOwned.sync: přerušené první načtení (chyba stránky) naváže tam, kde skončilo", async () => {
  const { AlzaCore, AlzaOwned, data } = setup();
  AlzaCore.ownedPageSize = 2;
  AlzaCore.ownedDetailsPerRun = 0;
  const api = archiveShop("alza_cz", [5, 4, 3, 2, 1].map((id, index) => ownedOrder("alza_cz", id, index + 1)));
  api.onArchive = (offset) => (offset === 2 ? new Error("HTTP 502") : null);
  await assert.rejects(() => AlzaOwned.sync(api.args()), /HTTP 502/);
  assert.deepEqual(plain({ ...data.alzaOwnedSync.alza_cz, at: 0 }), { offset: 2, done: false, total: 5, at: 0 });
  assert.equal(Object.keys(data.alzaOwned).length, 2);
  api.onArchive = null;
  api.offsets.length = 0;
  const result = await AlzaOwned.sync(api.args());
  assert.deepEqual([result.added, result.done, result.total], [3, true, 5]);
  assert.deepEqual(api.offsets, [2, 4]);
  assert.equal(Object.keys(data.alzaOwned).length, 5);
  // Neznámý tvar odpovědi archivu je chyba, stav se nemění
  const args = api.args({ force: true });
  await assert.rejects(() => AlzaOwned.sync({ ...args, getJson: async () => ({ items: [] }) }), /neznámý tvar/);
  assert.equal(data.alzaOwnedSync.alza_cz.done, true);
});

test("AlzaOwned.sync: skipArchive – další kolo téhož kliknutí načtený archiv znovu nestahuje", async () => {
  const { AlzaCore, AlzaOwned, data } = setup(ownedStorage("alza_cz", [3, 2, 1]));
  AlzaCore.ownedDetailsPerRun = 1; // force = trojnásobná dávka
  const api = archiveShop("alza_cz", [3, 2, 1].map((id, index) => ownedOrder("alza_cz", id, index + 1)));
  let result = await AlzaOwned.sync(api.args({ force: true, skipArchive: true }));
  assert.deepEqual(plain(result), { status: "synced", added: 0, details: 3, pending: 0, done: true, total: 3 });
  assert.deepEqual([api.offsets.length, api.detailCalls.length], [0, 3]);
  // Nic dalšího ve frontě: bez dotazu na číslo účtu
  api.userIdCalls = 0;
  result = await AlzaOwned.sync(api.args({ force: true, skipArchive: true }));
  assert.equal(result.status, "skipped");
  assert.equal(api.userIdCalls, 0);
  // Bez skipArchive stáhne force první stránku archivu jako dosud
  assert.equal((await AlzaOwned.sync(api.args({ force: true }))).status, "synced");
  assert.deepEqual(api.offsets, [0]);
  // Nedokončené první načtení archivu pokračuje i se skipArchive
  data.alzaOwnedSync.alza_cz = { offset: 1, done: false, total: 3, at: Date.now() };
  api.offsets.length = 0;
  result = await AlzaOwned.sync(api.args({ force: true, skipArchive: true }));
  assert.deepEqual([result.status, result.done], ["synced", true]);
  assert.deepEqual(api.offsets, [1]);
});

test("AlzaOwned.sync: detaily po dávkách, cena kusu v Kč, € a Ft", async () => {
  const { AlzaCore, AlzaOwned, data } = setup();
  AlzaCore.ownedDetailsPerRun = 1;
  const shops = {
    alza_cz: archiveShop("alza_cz", [ownedOrder("alza_cz", 12, 1), ownedOrder("alza_cz", 11, 2)], { 12: ownedDetail("alza_cz", 12, "5 990 Kč/ks"), 11: ownedDetail("alza_cz", 11, "428 Kč/ks") }),
    alza_sk: archiveShop("alza_sk", [ownedOrder("alza_sk", 21, 1, { totalPrice: "129,90 €" })], { 21: ownedDetail("alza_sk", 21, "12,90 €/ks") }),
    alza_hu: archiveShop("alza_hu", [ownedOrder("alza_hu", 31, 1, { totalPrice: "24 990 Ft" })], { 31: ownedDetail("alza_hu", 31, "4 990 Ft/db") }),
  };
  // Na pozadí jeden detail na běh (ownedDetailsPerRun), zbytek čeká
  assert.deepEqual(plain(await AlzaOwned.sync(shops.alza_cz.args())), { status: "synced", added: 2, details: 1, pending: 1, done: true, total: 2 });
  assert.deepEqual(shops.alza_cz.detailCalls, ["12"]); // od nejnovějšího nákupu
  assert.deepEqual(plain(await AlzaOwned.sync(shops.alza_cz.args())), { status: "synced", added: 0, details: 1, pending: 0, done: true, total: 2 });
  assert.equal((await AlzaOwned.sync(shops.alza_sk.args())).details, 1);
  assert.equal((await AlzaOwned.sync(shops.alza_hu.args())).details, 1);
  const buy = (key) => data.alzaOwned[key].buys[0];
  assert.deepEqual([buy("alza_cz_12").p, buy("alza_cz_11").p, buy("alza_sk_21").p, buy("alza_hu_31").p], [5990, 428, 12.9, 4990]);
  assert.ok(buy("alza_sk_21").at > 0 && buy("alza_sk_21").claim === true);
  assert.deepEqual(plain(Object.fromEntries(Object.entries(data.alzaOwnedOrders).map(([domain, orders]) => [domain, Object.values(orders).map(([, total]) => total)]))), {
    alza_cz: [7709, 7709],
    alza_sk: [129.9],
    alza_hu: [24990],
  });
  assert.deepEqual([shops.alza_cz.userIdCalls, shops.alza_sk.userIdCalls], [2, 1]);
});

test("AlzaOwned.sync: nepřihlášený – nic se nenačítá ani nezapisuje", async () => {
  const { AlzaOwned, written } = setup();
  const api = archiveShop("alza_cz", [ownedOrder("alza_cz", 1, 1)]);
  api.userId = null;
  assert.deepEqual(plain(await AlzaOwned.sync(api.args({ force: true }))), { status: "noLogin", added: 0, details: 0, pending: 0, done: false, total: null });
  assert.deepEqual([api.offsets.length, api.detailCalls.length, written.length], [0, 0, 0]);
});

test("AlzaOwned.sync: jistič – po HTTP 403 / 429 dávka detailů končí, zbytek zůstane ve frontě", async () => {
  for (const status of [403, 429]) {
    const { AlzaCore, AlzaOwned, data } = setup(ownedStorage("alza_cz", [5, 4, 3, 2, 1]));
    const api = archiveShop("alza_cz", [], { 4: new Error(`HTTP ${status}`) });
    const result = await AlzaOwned.sync(api.args());
    assert.deepEqual(plain(result), { status: "synced", added: 0, details: 1, pending: 4, done: true, total: 5, blocked: true });
    assert.deepEqual(api.detailCalls, ["5", "4"]);
    assert.deepEqual(detailTimes(data, "alza_cz", [5, 4, 3, 2, 1]), [true, false, false, false, false]);
    // Odmítnutí není chyba té objednávky – počítadlo selhání se nezvyšuje
    assert.equal(data.alzaOwnedSync.alza_cz.fails, undefined);
    assert.equal(AlzaCore.getOwnedDetailQueue(data.alzaOwned, "alza_cz").length, 4);
    // Hned první detail odmítnut: nic se nezapíše
    const next = await AlzaOwned.sync(api.args());
    assert.deepEqual([next.details, next.pending, next.blocked], [0, 4, true]);
    assert.deepEqual(api.detailCalls, ["5", "4", "4"]);
  }
});

test("AlzaOwned.sync: jistič – tři nenačtené detaily za sebou dávku ukončí a započítají se jako selhání", async () => {
  const { AlzaOwned, data } = setup(ownedStorage("alza_cz", [6, 5, 4, 3, 2, 1]));
  const api = archiveShop("alza_cz", [], { 5: new Error("HTTP 500"), 4: { parts: "x" }, 3: new Error("timeout") });
  const result = await AlzaOwned.sync(api.args());
  assert.deepEqual(plain(result), { status: "synced", added: 0, details: 1, pending: 5, done: true, total: 6, blocked: true });
  assert.deepEqual(api.detailCalls, ["6", "5", "4", "3"]);
  assert.deepEqual(plain(data.alzaOwnedSync.alza_cz.fails), { 3: 1, 4: 1, 5: 1 });
  // Chyby proložené úspěchem dávku neukončí
  const other = setup(ownedStorage("alza_cz", [6, 5, 4, 3, 2, 1]));
  const mixed = archiveShop("alza_cz", [], { 6: new Error("HTTP 500"), 4: new Error("HTTP 500"), 2: new Error("HTTP 500") });
  const second = await other.AlzaOwned.sync(mixed.args());
  assert.deepEqual([second.details, second.pending, second.blocked], [3, 3, undefined]);
  assert.equal(mixed.detailCalls.length, 6);
});

test("AlzaOwned.sync: trvale selhávající detail neblokuje čelo fronty – po detailFailLimit pokusech jde na konec", async () => {
  const { AlzaCore, AlzaOwned, data } = setup(ownedStorage("alza_cz", [3, 2, 1]));
  AlzaCore.ownedDetailsPerRun = 1;
  const api = archiveShop("alza_cz", [], { 3: new Error("HTTP 500") });
  // Nejnovější objednávka 3 je v čele fronty a její detail se nenačte: tři běhy ji zkouší
  for (let run = 1; run <= AlzaOwned.detailFailLimit; run++) {
    const result = await AlzaOwned.sync(api.args());
    assert.deepEqual([result.details, result.pending, result.blocked], [0, 3, undefined]);
    assert.deepEqual(plain(data.alzaOwnedSync.alza_cz.fails), { 3: run });
  }
  assert.deepEqual(api.detailCalls, ["3", "3", "3"]);
  // Pak dostanou přednost ostatní…
  assert.equal((await AlzaOwned.sync(api.args())).details, 1);
  assert.equal((await AlzaOwned.sync(api.args())).details, 1);
  assert.deepEqual(api.detailCalls.slice(3), ["2", "1"]);
  assert.deepEqual(detailTimes(data, "alza_cz", [3, 2, 1]), [false, true, true]);
  // …a selhávající se nezahazuje: zkouší se dál, jen až po nich
  let result = await AlzaOwned.sync(api.args());
  assert.deepEqual([result.details, result.pending], [0, 1]);
  assert.deepEqual(plain(data.alzaOwnedSync.alza_cz.fails), { 3: 4 });
  // Po úspěchu záznam zmizí (stav načítání jinak zůstává)
  delete api.details[3];
  result = await AlzaOwned.sync(api.args());
  assert.deepEqual([result.details, result.pending], [1, 0]);
  assert.equal(data.alzaOwnedSync.alza_cz.fails, undefined);
  assert.deepEqual([data.alzaOwnedSync.alza_cz.done, data.alzaOwnedSync.alza_cz.total], [true, 3]);
  assert.deepEqual(plain(AlzaOwned.sortQueue(["a", "b", "c", "d"], { a: 3, c: 9, d: 2 })), ["b", "d", "a", "c"]);
  assert.deepEqual(plain(AlzaOwned.sortQueue(["a", "b"], null)), ["a", "b"]);
});

test("AlzaOwned.sync: vypnutí volby ownedItems během načítání archivu běh ukončí bez dalšího zápisu", async () => {
  const { AlzaCore, AlzaOwned, chrome, data, written } = setup();
  AlzaCore.ownedPageSize = 2;
  const api = archiveShop("alza_cz", [5, 4, 3, 2, 1].map((id, index) => ownedOrder("alza_cz", id, index + 1)));
  // Uživatel volbu vypne ve chvíli, kdy je uložená první stránka
  let writtenAtStop = null;
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.alzaOwnedSync || writtenAtStop !== null) return;
    data.alzaSettings.ownedItems = false;
    writtenAtStop = written.length;
  });
  const result = await AlzaOwned.sync(api.args({ force: true }));
  assert.deepEqual(plain(result), { status: "off", added: 2, details: 0, pending: 0, done: false, total: 5 });
  assert.deepEqual([api.offsets, api.detailCalls], [[0], []]);
  assert.equal(written.length, writtenAtStop);
  assert.equal(Object.keys(data.alzaOwned).length, 2);
});

test("AlzaOwned.sync: vypnutí volby během detailů – rozpracovaná dávka se zahodí", async () => {
  const { AlzaOwned, data, written } = setup(ownedStorage("alza_cz", [3, 2, 1]));
  const api = archiveShop("alza_cz", []);
  api.onDetail = () => {
    data.alzaSettings.ownedItems = false;
    return null;
  };
  const result = await AlzaOwned.sync(api.args());
  assert.deepEqual(plain(result), { status: "off", added: 0, details: 0, pending: 0, done: true, total: 3 });
  assert.deepEqual(api.detailCalls, ["3"]);
  assert.equal(written.length, 0);
  assert.deepEqual(detailTimes(data, "alza_cz", [3, 2, 1]), [false, false, false]);
  // Vypnuto už před načítáním: ani jeden dotaz na objednávky
  const off = setup({ ...ownedStorage("alza_cz", [3, 2, 1]), alzaSettings: { ownedItems: false } });
  const idle = archiveShop("alza_cz", []);
  assert.equal((await off.AlzaOwned.sync(idle.args({ force: true }))).status, "off");
  assert.deepEqual([idle.offsets.length, idle.detailCalls.length, idle.userIdCalls, off.written.length], [0, 0, 0, 0]);
});

test("AlzaOwned.sync: smazání načtených nákupů během načítání běh ukončí – stav ani přehled nevznikne znovu", async () => {
  const { AlzaCore, AlzaOwned, chrome, data } = setup();
  AlzaCore.ownedPageSize = 2;
  const api = archiveShop("alza_cz", [5, 4, 3, 2, 1].map((id, index) => ownedOrder("alza_cz", id, index + 1)));
  let deleted = false;
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.alzaOwnedSync?.newValue || deleted) return;
    deleted = true;
    chrome.storage.local.remove(["alzaOwned", "alzaOwnedOrders", "alzaOwnedSync"]); // tlačítko „Smazat načtené nákupy“
  });
  const result = await AlzaOwned.sync(api.args({ force: true }));
  assert.equal(result.status, "off");
  assert.deepEqual(api.offsets, [0]);
  assert.deepEqual([data.alzaOwned, data.alzaOwnedOrders, data.alzaOwnedSync], [undefined, undefined, undefined]);
  // Totéž během detailů
  const second = setup(ownedStorage("alza_cz", [3, 2, 1]));
  const details = archiveShop("alza_cz", []);
  details.onDetail = () => {
    second.chrome.storage.local.remove(["alzaOwned", "alzaOwnedOrders", "alzaOwnedSync"]);
    return new Error("HTTP 500");
  };
  assert.equal((await second.AlzaOwned.sync(details.args())).status, "off");
  assert.deepEqual(details.detailCalls, ["3"]);
  assert.deepEqual([second.data.alzaOwned, second.data.alzaOwnedSync], [undefined, undefined]);
  // Další běh začne od začátku
  const again = await second.AlzaOwned.sync(archiveShop("alza_cz", [ownedOrder("alza_cz", 3, 1)]).args());
  assert.deepEqual([again.status, again.added, again.done], ["synced", 1, true]);
});
