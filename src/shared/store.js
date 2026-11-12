// Zápisy do chrome.storage.local přes jediného zapisovatele – službu na pozadí. Content scripty (víc záložek),
// popup i nastavení pošlou operaci zprávou a služba na pozadí je provede po jedné (fronta). Dřívější
// read-modify-write z více míst najednou přepisoval cizí změny (cílová cena, hlídaný seznam, nové minimum…).
// Čte se dál přímo (chrome.storage.local.get) odkudkoli.
//
// Operace (ops) dostávají jen data (zprávou nejde poslat funkci) a uvnitř fronty se nesmí znovu volat run –
// čekala by sama na sebe. Služba na pozadí nastaví isWriter = true a předává zprávy do handleMessage.
const AlzaStore = {
  isWriter: false,
  queue: Promise.resolve(),
  messageAction: "alzaStore",

  // Úloha ve frontě zapisovatele (jen služba na pozadí); vrací její výsledek
  exclusive(task) {
    if (!this.isWriter) return Promise.reject(new Error("AlzaStore.exclusive jen ve službě na pozadí"));
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  },

  async run(op) {
    if (this.isWriter) return this.exclusive(() => this.apply(op));
    const response = await chrome.runtime.sendMessage({ action: this.messageAction, op });
    if (!response) throw new Error(`Služba na pozadí neodpověděla (${op.type})`);
    if (!response.ok) throw new Error(response.error);
    return response.result;
  },

  apply(op) {
    const handler = Object.hasOwn(this.ops, op?.type) ? this.ops[op.type] : null;
    if (!handler) throw new Error(`Neznámá operace úložiště: ${op?.type}`);
    return handler.call(this, op);
  },

  // Posluchač chrome.runtime.onMessage ve službě na pozadí; true = odpověď přijde asynchronně
  handleMessage(message, sendResponse) {
    if (message?.action !== this.messageAction) return false;
    this.run(message.op).then(
      (result) => sendResponse({ ok: true, result }),
      (error) => sendResponse({ ok: false, error: String(error?.message || error) })
    );
    return true;
  },

  // === Čtení (kdekoli) ===

  // Záznamy cen produktů { klíč produktu: záznam } jedním čtením
  async getPriceRecords(domainKey, urls) {
    const keys = [...new Set(urls.map((url) => AlzaCore.getPriceKey(domainKey, url)))];
    if (keys.length === 0) return {};
    const data = await chrome.storage.local.get(keys);
    const prefix = AlzaCore.storagePrefixes.price;
    return Object.fromEntries(Object.entries(data).map(([key, record]) => [key.slice(prefix.length), record]));
  },

  // === Migrace ===
  // Dřívější alzaPrices_<doména> ({ url: záznam }, jeden obrovský objekt přepisovaný při každém produktu)
  // → alzaPrice_<doména>_<id>. Víc adres téhož produktu (parametry v URL): novější záznam, min/max z obou
  legacyToPriceRecords(domainKey, records, existing = {}) {
    const result = {};
    Object.entries(records || {}).forEach(([url, record]) => {
      if (!AlzaCore.isAlzaUrl(url) || !record || typeof record !== "object") return;
      const key = AlzaCore.getPriceKey(domainKey, url);
      result[key] = this.mergeDuplicateRecords(result[key] ?? existing[key], { ...record, url: record.url || url });
    });
    return result;
  },

  mergeDuplicateRecords(a, b) {
    if (!a) return b;
    const [older, newer] = (Number(a.lastUpdated) || 0) <= (Number(b.lastUpdated) || 0) ? [a, b] : [b, a];
    const merged = { ...newer };
    const pick = (key, better) => {
      const values = [older[key], newer[key]].filter((point) => Number.isFinite(point?.value));
      if (values.length > 0) merged[key] = values.reduce((best, point) => (better(point.value, best.value) ? point : best));
    };
    pick("minPrice", (value, best) => value < best);
    pick("maxPrice", (value, best) => value > best);
    pick("maxLowestPrice", (value, best) => value > best);
    return merged;
  },

  async migrate() {
    // Běží při každém startu služby na pozadí – nejdřív jen 3 staré klíče, celé úložiště až když je co převádět
    const prefix = AlzaCore.storagePrefixes.legacyPrices;
    const legacy = await chrome.storage.local.get(Object.keys(AlzaCore.domains).map((domainKey) => prefix + domainKey));
    const legacyKeys = Object.keys(legacy);
    if (legacyKeys.length === 0) return 0;
    const all = await chrome.storage.local.get(null);
    const updates = {};
    legacyKeys.forEach((key) => Object.assign(updates, this.legacyToPriceRecords(key.slice(prefix.length), all[key], { ...all, ...updates })));
    await chrome.storage.local.set(updates);
    await chrome.storage.local.remove(legacyKeys);
    return Object.keys(updates).length;
  },

  // Jednorázové opravy uložených dat (storageKeys.cleanups – co proběhlo, už se nespouští). Vrací počet změn
  async runCleanups() {
    const key = AlzaCore.storageKeys.cleanups;
    const { [key]: done = {} } = await chrome.storage.local.get(key);
    const name = "quantityTierListingPrices-2026-11";
    if (done[name]) return 0;
    const all = await chrome.storage.local.get(null);
    const pricePrefix = AlzaCore.storagePrefixes.price;
    const updates = {};
    let removed = 0;
    Object.entries(all).forEach(([storageKey, record]) => {
      if (!storageKey.startsWith(pricePrefix) || !record?.quantityTiers || !record.url) return;
      const productKey = storageKey.slice(pricePrefix.length);
      const domainKey = Object.keys(AlzaCore.domains).find((domain) => productKey.startsWith(`${domain}_`));
      if (!domainKey) return;
      const historyKey = AlzaCore.getHistoryKey(domainKey, record.url);
      if (!Array.isArray(all[historyKey])) return;
      const entries = structuredClone(all[historyKey]);
      const count = AlzaCore.removeQuantityTierEntries(entries, record.quantityTiers);
      if (count > 0) {
        updates[historyKey] = entries;
        removed += count;
      }
    });
    await chrome.storage.local.set({ ...updates, [key]: { ...done, [name]: Date.now() } });
    return removed;
  },

  // === Operace ===
  ops: {
    // Sloučí nově načtené ceny do záznamů produktů (AlzaCore.mergePriceRecord). records = { url: ceny + meta }.
    // Vrací { url: { before, record } } – before = záznam před sloučením (šipka změny, první záznam historie)
    async mergePrices({ domain, records, listId = null, now = Date.now() }) {
      const keys = Object.fromEntries(Object.keys(records).map((url) => [url, AlzaCore.getPriceKey(domain, url)]));
      const codesKey = AlzaCore.storageKeys.codes;
      const cashbacksKey = AlzaCore.storageKeys.cashbacks;
      const stored = await chrome.storage.local.get([...Object.values(keys), codesKey, cashbacksKey]);
      const updates = {};
      const result = {};
      const codes = stored[codesKey] && typeof stored[codesKey] === "object" ? stored[codesKey] : {};
      const cashbacks = stored[cashbacksKey] && typeof stored[cashbacksKey] === "object" ? stored[cashbacksKey] : {};
      let codesChanged = false;
      let cashbacksChanged = false;
      Object.entries(records).forEach(([url, incoming]) => {
        const key = keys[url];
        const current = updates[key] || stored[key];
        const before = current ? structuredClone(current) : null;
        const record = AlzaCore.mergePriceRecord(current ? structuredClone(current) : {}, incoming || {}, listId, now);
        record.url = current?.url || url;
        updates[key] = record;
        result[url] = { before, record };
        if (AlzaCore.updateCodeRegistry(codes, AlzaCore.getProductKey(domain, url), record, record.url, domain, now)) codesChanged = true;
        // Cashback s odkazem na podmínky – připomínka registrace po nákupu (background.js updateCashbackReminders)
        if (AlzaCore.updateCashbackRegistry(cashbacks, AlzaCore.getProductKey(domain, url), record, domain, now)) cashbacksChanged = true;
      });
      if (codesChanged) updates[codesKey] = codes;
      if (cashbacksChanged) updates[cashbacksKey] = cashbacks;
      if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);
      return result;
    },

    // Kontrola do historie produktu (AlzaCore.appendHistory). previousRecord = záznam ceny před sloučením
    // (první záznam historie na něj naváže). Vrací uloženou historii
    async appendHistory({ domain, lang, url, prices, availability = null, previousRecord, name = null, now = Date.now() }) {
      const key = AlzaCore.getHistoryKey(domain, url);
      const { [key]: stored } = await chrome.storage.local.get(key);
      const entries = AlzaCore.normalizeHistory(stored, lang);
      AlzaCore.appendHistory(entries, prices, availability, previousRecord, { now, name });
      await chrome.storage.local.set({ [key]: entries });
      return entries;
    },

    // Produkty viděné při procházení (browsing.js): pozorování z výpisu do historie (jen products s prices)
    // a záznam do přehledu procházených (storageKeys.browsed). products = [{ url, name, image, prices, availability }]
    async recordBrowsing({ domain, lang, products, now = Date.now() }) {
      const browsedKey = AlzaCore.storageKeys.browsed;
      const historyKeys = products.filter((product) => product.prices).map((product) => AlzaCore.getHistoryKey(domain, product.url));
      const data = await chrome.storage.local.get([browsedKey, ...historyKeys]);
      const browsed = data[browsedKey] || {};
      const updates = {};
      products.forEach((product) => {
        if (product.prices) {
          const historyKey = AlzaCore.getHistoryKey(domain, product.url);
          const entries = updates[historyKey] || AlzaCore.normalizeHistory(data[historyKey], lang);
          if (AlzaCore.appendListingObservation(entries, product.prices, product.availability, { now, name: product.name })) updates[historyKey] = entries;
        }
        const key = AlzaCore.getProductKey(domain, product.url);
        const previous = browsed[key] || {};
        browsed[key] = {
          url: previous.url || product.url,
          domain,
          name: product.name || previous.name || null,
          image: product.image || previous.image || null,
          seenAt: now,
        };
      });
      if (products.length > 0) await chrome.storage.local.set({ ...updates, [browsedKey]: browsed });
    },

    // Úprava objektu { klíč: položka } (cílové ceny, hlídané produkty a seznamy, procházené produkty):
    //   set = nahradit (keep = pole, která zůstanou z dosavadní položky, např. since)
    //   update = nahradit jen existující položku, merge = doplnit pole do položky, remove = smazat
    //   existingOnly = merge jen do existující položky (stav nákupu, „Hotovo“ u připomínky – smazaná položka
    //   nesmí vzniknout znovu jako útržek bez adresy a domény)
    // Vrací výsledný objekt
    async patchMap({ key, set = {}, update = {}, merge = {}, remove = [], keep = [], existingOnly = false }) {
      // Klíč "__proto__" by místo položky změnil prototyp – položka by se tiše ztratila
      [set, update, merge].forEach((entries) => delete entries.__proto__);
      const { [key]: stored } = await chrome.storage.local.get(key);
      const map = stored && typeof stored === "object" ? stored : {};
      const kept = (existing) => Object.fromEntries(keep.filter((field) => existing?.[field] !== undefined).map((field) => [field, existing[field]]));
      Object.entries(set).forEach(([entry, value]) => (map[entry] = { ...value, ...kept(map[entry]) }));
      Object.entries(update).forEach(([entry, value]) => {
        if (map[entry]) map[entry] = { ...value, ...kept(map[entry]) };
      });
      Object.entries(merge).forEach(([entry, value]) => {
        if (!existingOnly || (map[entry] && typeof map[entry] === "object")) map[entry] = { ...map[entry], ...value };
      });
      remove.forEach((entry) => delete map[entry]);
      await chrome.storage.local.set({ [key]: map });
      return map;
    },

    // Doplní pole do objektu pod klíčem (návrh čistky – odložení)
    async assign({ key, values }) {
      const { [key]: stored } = await chrome.storage.local.get(key);
      const value = { ...(stored && typeof stored === "object" ? stored : {}), ...values };
      await chrome.storage.local.set({ [key]: value });
      return value;
    },

    async recordVatCheck({ domain, withVat, now = Date.now() }) {
      const key = AlzaCore.storageKeys.vatCheck;
      const { [key]: checks = {} } = await chrome.storage.local.get(key);
      const next = AlzaCore.nextVatChecks(checks, domain, withVat, now);
      if (next) await chrome.storage.local.set({ [key]: next });
    },

    async appendErrors({ entries }) {
      const key = AlzaCore.storageKeys.errorLog;
      const { [key]: log } = await chrome.storage.local.get(key);
      await chrome.storage.local.set({ [key]: [...(Array.isArray(log) ? log : []), ...entries].slice(-AlzaCore.errorLogMaxEntries) });
    },

    // Data produktů (historie, záznam ceny, přehled procházených, kód v trezoru, viděný cashback, připomínka
    // cashbacku, hlídání po nákupu) – nastavení: úklid a smazání dat produktu. Hlídání a cílové ceny zůstávají.
    // productKeys = ["alza_cz_123", …]
    async removeProducts({ productKeys }) {
      const { history, price } = AlzaCore.storagePrefixes;
      const { browsed, codes, cashbacks, cashbackReminders, purchases } = AlzaCore.storageKeys;
      const mapKeys = [browsed, codes, cashbacks, cashbackReminders, purchases];
      await chrome.storage.local.remove(productKeys.flatMap((key) => [history + key, price + key]));
      const stored = await chrome.storage.local.get(mapKeys);
      const updates = {};
      mapKeys.forEach((mapKey) => {
        const map = stored[mapKey];
        if (!map || typeof map !== "object" || !productKeys.some((key) => Object.hasOwn(map, key))) return;
        productKeys.forEach((key) => delete map[key]);
        updates[mapKey] = map;
      });
      if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);
    },

    async remove({ keys }) {
      await chrome.storage.local.remove(keys);
    },

    // === Moje nákupy (AlzaOwned v shared/orders.js, služba na pozadí) ===

    // Objednávky z archivu (AlzaCore.parseArchivePage) do přehledu koupeného zboží a objednávek; sync = stav načítání
    // domény (doplní se do storageKeys.ownedSync). Vrací počet nových nákupů. Přehled zboží a objednávek se zapisuje
    // jen při skutečné změně (nový nákup, přejmenované zboží, zrušená objednávka, jiná částka) – stránka archivu se
    // samými známými objednávkami by jinak pokaždé přepsala celý přehled; stav načítání se zapisuje vždy
    async mergeOwned({ domain, orders = [], sync = null }) {
      const { owned: ownedKey, ownedOrders: ordersKey, ownedSync: syncKey } = AlzaCore.storageKeys;
      const stored = await chrome.storage.local.get([ownedKey, ordersKey, syncKey]);
      const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
      const owned = isObject(stored[ownedKey]) ? stored[ownedKey] : {};
      const allOrders = isObject(stored[ordersKey]) ? stored[ordersKey] : {};
      const domainOrders = isObject(allOrders[domain]) ? allOrders[domain] : {};
      // mergeOwnedOrders mění oba objekty na místě – změnu pozná srovnání podoby před a po
      const snapshot = () => [JSON.stringify(owned), JSON.stringify(domainOrders)];
      const before = orders.length > 0 ? snapshot() : null;
      const added = AlzaCore.mergeOwnedOrders(owned, domainOrders, orders, domain);
      const updates = {};
      if (before) {
        const after = snapshot();
        if (after[0] !== before[0]) updates[ownedKey] = owned;
        if (after[1] !== before[1]) updates[ordersKey] = { ...allOrders, [domain]: domainOrders };
      }
      if (sync) {
        const allSync = isObject(stored[syncKey]) ? stored[syncKey] : {};
        updates[syncKey] = { ...allSync, [domain]: { ...allSync[domain], ...sync } };
      }
      if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);
      return added;
    },

    // Údaje z detailů objednávek (cena kusu, reklamace, vrácení) k nákupům: results = [{ order, details }]
    async applyOwnedDetails({ domain, results = [], now = Date.now() }) {
      const key = AlzaCore.storageKeys.owned;
      const { [key]: owned } = await chrome.storage.local.get(key);
      if (!owned || typeof owned !== "object" || results.length === 0) return;
      // Záruka z detailu produktu (setWarranty ji ukládá k záznamu ceny) – nákup si ji vezme s prvním detailem objednávky
      const productKeys = [...new Set(results.flatMap(({ details }) => Object.keys(details || {})))];
      const priceKeys = productKeys.map((productKey) => `${AlzaCore.storagePrefixes.price}${productKey}`);
      const records = priceKeys.length > 0 ? await chrome.storage.local.get(priceKeys) : {};
      const warranties = Object.fromEntries(productKeys.map((productKey, index) => [productKey, records[priceKeys[index]]?.warranty]).filter(([, warranty]) => warranty));
      results.forEach(({ order, details }) => AlzaCore.applyOwnedDetails(owned, String(order), details || {}, domain, now, warranties));
      await chrome.storage.local.set({ [key]: owned });
    },

    // Délka záruky zjištěná z API produktu při načítání Mých nákupů (AlzaOwned.sync): results = [{ key, months | null }]
    // – i nezjištěná se zapíše jako „ptali jsme se“ (wa), ať se dotaz neopakuje při každém běhu
    async applyOwnedWarranties({ domain, results = [], now = Date.now() }) {
      const key = AlzaCore.storageKeys.owned;
      const { [key]: owned } = await chrome.storage.local.get(key);
      if (!owned || typeof owned !== "object" || results.length === 0) return;
      let changed = false;
      results.forEach(({ key: productKey, months }) => {
        if (owned[productKey]?.domain !== domain) return;
        changed = AlzaCore.applyOwnedWarrantyResult(owned, productKey, Number(months) || 0, now) || changed;
      });
      if (changed) await chrome.storage.local.set({ [key]: owned });
    },

    // Záruka z detailu produktu ({ m: měsíce, b: platí „pro firemní nákupy“ } – AlzaCore.getDocumentWarranty):
    // k záznamu ceny (budoucí nákup si ji vezme při načtení detailu objednávky) a ke koupeným kusům v Mých nákupech,
    // které ji ještě nemají. Zapisuje jen při změně; záznam ceny nevytváří (produkt, jehož ceny se neukládají)
    async setWarranty({ domain, url, warranty }) {
      const months = Number(warranty?.m);
      if (!AlzaCore.isKnownDomain(domain) || !Number.isInteger(months) || months <= 0 || months > 240) return;
      const value = { m: months, b: Boolean(warranty.b) };
      const priceKey = AlzaCore.getPriceKey(domain, url);
      const ownedKey = AlzaCore.storageKeys.owned;
      const stored = await chrome.storage.local.get([priceKey, ownedKey]);
      const changes = {};
      const record = stored[priceKey];
      if (record && typeof record === "object" && (record.warranty?.m !== value.m || Boolean(record.warranty?.b) !== value.b)) changes[priceKey] = { ...record, warranty: value };
      const owned = stored[ownedKey];
      const product = owned && typeof owned === "object" ? owned[AlzaCore.getProductKey(domain, url)] : null;
      if (product && AlzaCore.applyOwnedWarranty(product, value)) changes[ownedKey] = owned;
      if (Object.keys(changes).length > 0) await chrome.storage.local.set(changes);
    },

    // Počítadlo nenačtených detailů objednávek ve stavu načítání domény (storageKeys.ownedSync → { "<doména>":
    // { …, fails: { "<číslo objednávky>": počet } } }) – AlzaOwned.sortQueue podle něj řadí opakovaně selhávající
    // detaily na konec fronty. failed = čísla objednávek, jejichž detail se teď nenačetl (+1), loaded = načtené
    // (záznam se smaže). Volat až po applyOwnedDetails: zůstávají jen objednávky, které na detail ještě čekají,
    // a nejvýš maxFails záznamů (ty s nejvíc selháními). Zapisuje jen při změně
    async countOwnedDetailFails({ domain, failed = [], loaded = [], now = Date.now() }) {
      const maxFails = 200;
      const { owned: ownedKey, ownedSync: syncKey } = AlzaCore.storageKeys;
      const stored = await chrome.storage.local.get([ownedKey, syncKey]);
      const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
      // Smazané nákupy (nastavení) – stav načítání nesmí vzniknout znovu jako útržek
      if (!isObject(stored[ownedKey])) return;
      const allSync = isObject(stored[syncKey]) ? stored[syncKey] : {};
      const state = isObject(allSync[domain]) ? allSync[domain] : {};
      const previous = isObject(state.fails) ? state.fails : {};
      const waiting = new Set(AlzaCore.getOwnedDetailQueue(stored[ownedKey], domain, now).map(String));
      loaded.forEach((order) => waiting.delete(String(order)));
      const counts = new Map(Object.entries(previous).filter(([order, count]) => waiting.has(order) && count > 0));
      failed.map(String).filter((order) => /^\d{1,20}$/.test(order)).forEach((order) => counts.set(order, (Number(counts.get(order)) || 0) + 1));
      const fails = Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).slice(0, maxFails));
      const same = Object.keys(fails).length === Object.keys(previous).length && Object.entries(fails).every(([order, count]) => previous[order] === count);
      if (same) return;
      const { fails: dropped, ...rest } = state;
      await chrome.storage.local.set({ [syncKey]: { ...allSync, [domain]: Object.keys(fails).length > 0 ? { ...rest, fails } : rest } });
    },

    // Připomínka konce záruky odeslána: items = [{ key (produkt), order }]
    async markOwnedNotified({ items = [] }) {
      const key = AlzaCore.storageKeys.owned;
      const { [key]: owned } = await chrome.storage.local.get(key);
      if (!owned || typeof owned !== "object") return;
      let changed = false;
      items.forEach(({ key: productKey, order }) => {
        const buy = Object.hasOwn(owned, productKey) ? owned[productKey]?.buys?.find((candidate) => candidate.o === order) : null;
        if (!buy || buy.notified) return;
        buy.notified = true;
        changed = true;
      });
      if (changed) await chrome.storage.local.set({ [key]: owned });
    },

    // Import ověřené zálohy (nastavení): historie se sloučí podle času, objekty po položkách, záznamy cen ze
    // starého formátu (alzaPrices_<doména>) se převedou na klíče po produktech. Nic se nesmaže
    async importData({ items }) {
      const legacyPrefix = AlzaCore.storagePrefixes.legacyPrices;
      const converted = {};
      Object.entries(items).forEach(([key, value]) => {
        if (key.startsWith(legacyPrefix)) Object.assign(converted, this.legacyToPriceRecords(key.slice(legacyPrefix.length), value, converted));
        // Stejný produkt ve starém i novém formátu téže zálohy – sloučit, ne přepsat (minimum, maximum)
        else converted[key] = converted[key] && AlzaCore.parseProductStorageKey(key)?.kind === "price" ? this.mergeDuplicateRecords(converted[key], value) : value;
      });
      const existing = await chrome.storage.local.get(Object.keys(converted));
      const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
      Object.entries(converted).forEach(([key, value]) => {
        const kind = AlzaCore.parseProductStorageKey(key)?.kind;
        if (kind === "history") converted[key] = AlzaCore.mergeHistories(existing[key], value);
        else if (kind === "price") converted[key] = this.mergeDuplicateRecords(existing[key], value);
        else if (isObject(existing[key]) && isObject(value)) converted[key] = { ...existing[key], ...value };
      });
      await chrome.storage.local.set(converted);
      return Object.keys(converted).length;
    },
  },
};

globalThis.AlzaStore = AlzaStore;
