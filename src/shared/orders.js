// Hlídání po nákupu: koupené zboží z „Moje objednávky“ (posledních 14 dní, bez zrušených) do
// AlzaCore.storageKeys.purchases. Kontrola na pozadí ho pak hlídá do konce lhůty pro vrácení a při zlevnění
// upozorní („Koupili jste za X, teď stojí Y. Do D ho můžete vrátit a koupit znovu.“ – background.js checkPurchase).
// Objednávky se čtou stejným API jako stránka „Moje objednávky“ s přihlášením uživatele – ze stránky Alzy
// (purchases.js) i při kontrole na pozadí (background.js syncOrders). Číslo účtu se nikam neukládá, volající ho
// pokaždé zjistí ze stránky Alzy (getUserId).
// Úplné načtení nejvýš jednou za AlzaCore.purchaseSyncHours; mezitím nejvýš jednou za purchaseProbeMinutes jen seznam
// aktivních objednávek – změna (nová, zrušená, doručená objednávka) = hned úplné načtení.
const AlzaOrders = {
  maxOrders: 20,
  detailDelayMs: 300, // Rozestup dotazů na detaily objednávek, ať Alza nedostane dávku najednou
  retryMinutes: 3, // Po nepovedené kontrole (chyba, nepřihlášený) se další zkusí nejdřív za tuto dobu
  breakerErrors: 3, // Tolik nenačtených detailů za sebou ukončí dávku (createBreaker)

  // Jistič dávky dotazů na detaily objednávek (i pro AlzaOwned): po odpovědi HTTP 403 / 429 (Alza nebo její ochrana
  // dotazy odmítá) hned, jinak po breakerErrors chybách za sebou je open = true – volající dávku ukončí a zbytek
  // nechá na příště. Chyba z getJson má zprávu „HTTP <stav>“ (background.js fetchAlzaJson, purchases.js getJson)
  createBreaker() {
    const limit = this.breakerErrors;
    let errors = 0;
    const breaker = {
      open: false,
      ok() {
        errors = 0;
      },
      // error = výjimka z getJson (bez ní: odpověď přišla, ale nemá čekaný tvar). Vrací true u odmítnutí (403 / 429)
      // – to není chyba té jedné objednávky
      fail(error = null) {
        const refused = /^HTTP (?:403|429)\b/.test(String(error?.message || ""));
        errors++;
        if (refused || errors >= limit) breaker.open = true;
        return refused;
      },
    };
    return breaker;
  },

  // { domainKey, origin, getJson(url), getUserId(), always (bez omezení purchaseProbeMinutes), waitMs (před zjištěním
  // čísla účtu) } → { status: "skipped" | "noLogin" | "unchanged" | "synced", added: [názvy nově koupeného zboží],
  // blocked (jen u "synced": true = dávka detailů skončila předčasně – jistič; načtení se nepočítá jako úplné a zkusí
  // se znovu při další kontrole) }.
  // Chyba načtení objednávek se vyhodí. Po chybě i u nepřihlášeného se čas kontroly vrátí jen zčásti – další pokus
  // nejdřív za retryMinutes (ne při každém načtení stránky Alzy); always tu brzdu ignoruje
  async check({ domainKey, origin, getJson, getUserId, always = false, waitMs = 0 }) {
    // { "<doména>": čas úplného načtení, "<doména>:probe": čas kontroly, "<doména>:mark": otisk aktivních objednávek }
    const syncKey = AlzaCore.storageKeys.purchasesSync;
    const probeKey = `${domainKey}:probe`;
    const markKey = `${domainKey}:mark`;
    const probeMs = AlzaCore.purchaseProbeMinutes * 60 * 1000;
    const readSync = async () => {
      const { [syncKey]: sync = {} } = await chrome.storage.local.get(syncKey);
      return sync && typeof sync === "object" ? sync : {};
    };
    const stored = await readSync();
    const previousProbe = Number(stored[probeKey]) || 0;
    if (!always && Date.now() - previousProbe < probeMs) return { status: "skipped", added: [] };

    // Zabrat čas kontroly hned – druhá záložka (nebo kontrola na pozadí) mezitím objednávky znovu nenačte. Kdo
    // zapsal poslední, kontroluje; ostatní skončí
    const claim = Date.now();
    const assign = (values) => AlzaStore.run({ type: "assign", key: syncKey, values });
    await assign({ [probeKey]: claim });
    // Nepovedená kontrola čas uvolní (jen dokud je zabraný námi), ale s brzdou: čas kontroly se posune tak, aby
    // další pokus přišel nejdřív za retryMinutes od tohoto. Úplné vrácení by znamenalo dotaz (u nepřihlášeného dva
    // zápisy do úložiště) při každém načtení stránky Alzy. Novější z obou časů – kontrola s always nesmí zkrátit
    // čekání, které už běželo
    const release = async () => {
      if ((await readSync())[probeKey] !== claim) return;
      const brake = claim - Math.max(0, probeMs - this.retryMinutes * 60 * 1000);
      await assign({ [probeKey]: Math.max(previousProbe, brake) });
    };
    try {
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      if ((await readSync())[probeKey] !== claim) return { status: "skipped", added: [] };
      const userId = await getUserId(); // Jednou za kontrolu; číslo účtu jen v této proměnné a v adresách dotazů
      if (!userId) {
        await release(); // Nepřihlášený uživatel – zkusí se za chvíli
        return { status: "noLogin", added: [] };
      }
      const base = `${origin}/api/users/${userId}/v1/orders`;
      const active = await getJson(`${base}/active?productFilterType=0`).catch(() => null);
      const mark = this.mark(active);
      if (mark === null) throw new Error("objednávky se nepodařilo načíst");
      const fullDue = Date.now() - (stored[domainKey] || 0) >= AlzaCore.purchaseSyncHours * 60 * 60 * 1000;
      if (!fullDue && mark === stored[markKey]) return { status: "unchanged", added: [] };
      const { added, blocked } = await this.sync({ domainKey, origin, base, getJson, active });
      // Dávka ukončená jističem: čas úplného načtení ani otisk se nezapíšou – zbylé objednávky se načtou při další
      // kontrole (čas kontroly zůstává zabraný, tedy nejdřív za purchaseProbeMinutes)
      if (blocked) return { status: "synced", added, blocked: true };
      await assign({ [domainKey]: Date.now(), [markKey]: mark });
      return { status: "synced", added };
    } catch (error) {
      await release().catch(() => {});
      throw error;
    }
  },

  // Otisk aktivních objednávek (adresa + stav) – změní se s novou, zrušenou i doručenou objednávkou. Jen číslo
  // (hash), čísla objednávek se neukládají. null = odpověď nesedí
  mark(active) {
    if (!active || typeof active !== "object" || !Array.isArray(active.groups)) return null;
    const text = active.groups
      .flatMap((group) => (Array.isArray(group?.orders) ? group.orders : []))
      .map((order) => `${order?.self?.href || ""}|${order?.state || ""}`)
      .sort()
      .join("\n");
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
    return hash.toString(36);
  },

  // Úplné načtení: aktivní (už načtené) + archiv, detail každé objednávky ve lhůtě (s rozestupem detailDelayMs).
  // Vrací { added: [názvy nově přidaného zboží], complete (úplný přehled objednávek za lhůtu – jen pak se mažou
  // nákupy, které v objednávkách už nejsou), blocked (dávku detailů ukončil jistič, zbylé objednávky se nenačetly) }
  async sync({ domainKey, origin, base, getJson, active }) {
    const since = Date.now() - AlzaCore.purchaseReturnDays * AlzaCore.dayMs;
    const archive = await getJson(`${base}/archive?productFilterType=0&offset=0&limit=${this.maxOrders}`).catch(() => null);
    const archived = Array.isArray(archive?.value) ? archive.value : [];
    // Úplný přehled objednávek za lhůtu: obě načtení prošla a archiv nekončí uprostřed lhůty (víc než maxOrders)
    let complete =
      active !== null && typeof active === "object" && Array.isArray(archive?.value) &&
      (archived.length < this.maxOrders || archived.some((order) => Date.parse(order?.created) < since));
    const orders = [...archived, ...(Array.isArray(active?.groups) ? active.groups.flatMap((group) => group?.orders || []) : [])]
      // Archiv: value[]; aktivní objednávky: groups[].orders[]
      .filter((order) => Date.parse(order?.created) >= since && !AlzaCore.isCancelledOrder(order?.state) && typeof order?.self?.href === "string");

    const purchases = {};
    const breaker = this.createBreaker();
    let asked = 0;
    for (const order of orders) {
      let href = null;
      try {
        href = new URL(order.self.href, origin);
      } catch {
        // Poškozená adresa detailu – objednávka se přeskočí jako nenačtená
      }
      if (href?.origin !== origin) {
        complete = false;
        continue;
      }
      if (asked++ > 0) await new Promise((resolve) => setTimeout(resolve, this.detailDelayMs));
      let detail = null;
      let error = null;
      try {
        detail = await getJson(href.href);
      } catch (caught) {
        error = caught;
      }
      // Bez detailu objednávky by její zboží vypadalo jako zrušené. Totéž detail, který přišel, ale nemá parts
      // (změna API) – parseOrderPurchases by z něj nevrátil nic a všechny nákupy ve lhůtě by se smazaly jako stažené
      if (!detail || !Array.isArray(detail.parts)) {
        complete = false;
        breaker.fail(error);
        if (breaker.open) break; // 403 / 429 nebo chyby za sebou – zbylé objednávky až příště
        continue;
      }
      breaker.ok();
      // Stejný produkt ve víc objednávkách: hlídá se nejnižší zaplacená cena a nejpozdější lhůta pro vrácení ze
      // všech jeho nákupů (i když je pozdější nákup dražší nebo stejně drahý – vrátit jde ještě ten). Čas nákupu
      // (boughtAt), název a kusy jdou s vybranou cenou: podle boughtAt se v historii hledá cena z doby nákupu
      // (AlzaCore.getPurchaseDrop), musí tedy patřit k nákupu, jehož cena se hlídá. Při stejné ceně pozdější nákup –
      // cena, čas nákupu i lhůta pak patří téže objednávce a výsledek nezávisí na pořadí objednávek v odpovědi
      AlzaCore.parseOrderPurchases(detail, domainKey).forEach(({ key, ...purchase }) => {
        const previous = purchases[key];
        const cheaper = !previous || purchase.price < previous.price || (purchase.price === previous.price && purchase.boughtAt > previous.boughtAt);
        purchases[key] = { ...(cheaper ? purchase : previous), domain: domainKey, returnUntil: Math.max(purchase.returnUntil, previous?.returnUntil || 0) };
      });
    }
    const blocked = breaker.open;
    if (blocked) complete = false;

    // Prošlé lhůty této domény pryč; po úplném načtení i nákupy, které v objednávkách už nejsou (zrušená objednávka,
    // vrácené zboží po první synchronizaci). U stávajících zůstane, o jaké ceně už přišlo upozornění
    const key = AlzaCore.storageKeys.purchases;
    const { [key]: stored = {} } = await chrome.storage.local.get(key);
    const known = stored && typeof stored === "object" ? stored : {};
    const now = Date.now();
    const remove = [];
    const withdrawn = [];
    Object.entries(known).forEach(([entry, value]) => {
      if (value?.domain !== domainKey || purchases[entry]) return;
      if (!(value?.returnUntil > now)) remove.push(entry);
      else if (complete) {
        remove.push(entry);
        withdrawn.push(entry);
      }
    });
    if (Object.keys(purchases).length > 0 || remove.length > 0) {
      await AlzaStore.run({ type: "patchMap", key, set: purchases, remove, keep: ["notifiedPrice"] });
    }
    // Připomínka cashbacku ke zrušenému / vrácenému nákupu už neplatí
    if (withdrawn.length > 0) await AlzaStore.run({ type: "patchMap", key: AlzaCore.storageKeys.cashbackReminders, remove: withdrawn });
    const added = Object.entries(purchases).filter(([entry]) => !known[entry]).map(([, purchase]) => purchase.name || purchase.url);
    return { added, complete, blocked };
  },
};

// Moje nákupy (volba ownedItems): všechno koupené z archivu „Moje objednávky“ do AlzaCore.storageKeys.owned – přehled
// koupeného zboží v nastavení, štítek „Koupili jste…“ na detailu a připomínka konce záruky. Běží jen ve službě na
// pozadí (background.js syncOwned). Číslo účtu se neukládá; u nákupu zůstává jen číslo objednávky (odkaz na ni).
//   1) archiv po stránkách od nejnovější: první načtení projde celou historii (po částech – ownedMaxPages na běh,
//      pokračuje od uloženého offsetu), další už jen nové objednávky (dokud stránka přináší něco nového)
//   2) detaily objednávek (cena kusu, „lze reklamovat“, vráceno) jen u nedávných nákupů a po dávkách
// Stav načítání domény (AlzaCore.storageKeys.ownedSync): { offset, done, total, at, fails: { "<číslo objednávky>":
// kolikrát se její detail nenačetl } } – fails zapisuje operace countOwnedDetailFails (store.js)
const AlzaOwned = {
  pageDelayMs: 300, // Rozestup dotazů, ať Alza nedostane dávku najednou
  detailFailLimit: 3, // Detail, který se tolikrát nenačetl, jde na konec fronty (sortQueue)

  // Fronta detailů (AlzaCore.getOwnedDetailQueue) s ohledem na počítadlo selhání: objednávky, jejichž detail se už
  // detailFailLimit-krát nenačetl, až za všechny ostatní – jinak by trvale selhávající detaily držely čelo fronty
  // a zbytek by se nenačetl nikdy. Nezahazují se: zkusí se znovu, až na ně dojde řada
  sortQueue(queue, fails) {
    const failing = (order) => Number(fails?.[order]) >= this.detailFailLimit;
    return [...queue.filter((order) => !failing(order)), ...queue.filter(failing)];
  },

  // { domainKey, origin, getJson(url), getUserId(), force (kliknutí v nastavení: hned a s větší dávkou detailů),
  //   skipArchive (další kolo téhož kliknutí: archiv, který je už načtený celý, se kvůli force znovu nestahuje – jen
  //   detaily; nedokončené první načtení archivu a pravidelné hledání nových objednávek po ownedSyncHours běží dál) }
  // → { status: "skipped" | "noLogin" | "synced" | "off", added (nové nákupy), details (načtené detaily), pending
  //   (detaily na příště), done (archiv načten celý), total (objednávek v archivu), blocked (jen u "synced": true =
  //   dávku detailů ukončil jistič – HTTP 403 / 429 nebo chyby za sebou; volající nemá hned pokračovat dalším kolem) }.
  //   "off" = uživatel během načítání vypnul volbu ownedItems nebo smazal načtené nákupy – skončilo se bez dalšího
  //   zápisu. Chyba načtení archivu se vyhodí
  async sync({ domainKey, origin, getJson, getUserId, force = false, skipArchive = false }) {
    const keys = AlzaCore.storageKeys;
    const read = async () => {
      const data = await chrome.storage.local.get([keys.owned, keys.ownedSync]);
      const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
      const state = isObject(data[keys.ownedSync]) && isObject(data[keys.ownedSync][domainKey]) ? data[keys.ownedSync][domainKey] : {};
      return { owned: isObject(data[keys.owned]) ? data[keys.owned] : {}, state };
    };
    const wait = () => new Promise((resolve) => setTimeout(resolve, this.pageDelayMs));
    const before = await read();
    const now = Date.now();
    const archiveDue = !before.state.done || (force && !skipArchive) || now - (before.state.at || 0) >= AlzaCore.ownedSyncHours * 60 * 60 * 1000;
    if (!archiveDue && AlzaCore.getOwnedDetailQueue(before.owned, domainKey, now).length === 0) {
      return { status: "skipped", added: 0, details: 0, pending: 0, done: true, total: before.state.total ?? null };
    }
    let added = 0;
    let { done = false, total = null } = before.state;
    // Uživatel načítání mezitím zastavil (kontrola před každým dotazem): vypnul volbu ownedItems, nebo smazal načtené
    // nákupy – nastavení maže i stav načítání, a pokračování od rozpracovaného offsetu by do prázdného přehledu
    // zapsalo jen zbytek archivu. Pak se končí hned a bez dalšího zápisu (i rozpracovaná dávka detailů se zahodí)
    let hasState = Boolean(before.state.at); // Stav načítání domény je uložený (at zapisuje každá stránka archivu)
    const stopped = async () => {
      if (!(await AlzaCore.getSettings()).ownedItems) return true;
      if (!hasState) return false;
      const { [keys.ownedSync]: sync } = await chrome.storage.local.get(keys.ownedSync);
      return !sync?.[domainKey]?.at;
    };
    const off = () => ({ status: "off", added, details: 0, pending: 0, done: Boolean(done), total: total ?? null });
    if (await stopped()) return off();
    const userId = await getUserId(); // Jednou za načtení; číslo účtu jen v této proměnné a v adresách dotazů
    if (!userId) return { status: "noLogin", added: 0, details: 0, pending: 0, done: Boolean(before.state.done), total: before.state.total ?? null };
    const base = `${origin}/api/users/${userId}/v1/orders`;

    if (archiveDue) {
      // První načtení pokračuje tam, kde minule skončilo; po něm vždy od nejnovějších
      let offset = done ? 0 : Number(before.state.offset) || 0;
      for (let page = 0; page < AlzaCore.ownedMaxPages; page++) {
        if (page > 0) await wait();
        if (await stopped()) return off();
        const parsed = AlzaCore.parseArchivePage(await getJson(`${base}/archive?productFilterType=0&offset=${offset}&limit=${AlzaCore.ownedPageSize}`), domainKey);
        if (!parsed) throw new Error("archiv objednávek má neznámý tvar");
        total = parsed.total ?? total;
        offset += parsed.count;
        const last = parsed.count < AlzaCore.ownedPageSize || (total !== null && offset >= total);
        const wasDone = done;
        if (last) done = true;
        // Stav po každé stránce – přerušené první načtení (zavřený prohlížeč) naváže, kde skončilo
        const pageAdded = await AlzaStore.run({ type: "mergeOwned", domain: domainKey, orders: parsed.orders, sync: { offset: done ? 0 : offset, done, total, at: Date.now() } });
        added += pageAdded;
        hasState = true;
        // Už načtený archiv: stránka bez nového nákupu = dál jsou jen známé objednávky
        if (last || (wasDone && pageAdded === 0)) break;
      }
    }

    // Detaily: po kliknutí v nastavení větší dávka, na pozadí po troškách
    const { owned, state } = await read();
    const queue = this.sortQueue(AlzaCore.getOwnedDetailQueue(owned, domainKey), state.fails);
    const batch = queue.slice(0, AlzaCore.ownedDetailsPerRun * (force ? 3 : 1));
    const results = [];
    const failed = []; // Nenačtené detaily – zůstanou ve frontě na příště a zvýší se jim počítadlo selhání
    const breaker = AlzaOrders.createBreaker();
    for (const order of batch) {
      await wait();
      if (await stopped()) return off();
      let detail = null;
      let error = null;
      try {
        detail = await getJson(`${base}/${encodeURIComponent(order)}/`);
      } catch (caught) {
        error = caught;
      }
      if (detail && Array.isArray(detail.parts)) {
        breaker.ok();
        results.push({ order, details: AlzaCore.parseOwnedDetails(detail, domainKey) });
        continue;
      }
      // Odmítnutí (403 / 429) není chyba této objednávky – do počítadla selhání nejde
      if (!breaker.fail(error)) failed.push(order);
      if (breaker.open) break; // Zbytek dávky až příště
    }
    if (batch.length > 0 && (await stopped())) return off();
    if (results.length > 0) await AlzaStore.run({ type: "applyOwnedDetails", domain: domainKey, results });
    // Počítadlo selhání: +1 nenačteným, po úspěchu záznam pryč (jen když je co měnit)
    const counted = Object.keys(state.fails && typeof state.fails === "object" ? state.fails : {}).length > 0;
    if (failed.length > 0 || (results.length > 0 && counted)) {
      await AlzaStore.run({ type: "countOwnedDetailFails", domain: domainKey, failed, loaded: results.map(({ order }) => order) });
    }
    return { status: "synced", added, details: results.length, pending: queue.length - results.length, done, total, ...(breaker.open && { blocked: true }) };
  },

  // Délka záruky koupeného zboží z API detailu produktu (AlzaCore.getProductApiUrl → data.warranty) – u produktů,
  // které ji ještě nemají (getOwnedWarrantyQueue). Volá se po sync (background.js runOwnedSync) u přihlášené domény:
  // po kliknutí v nastavení větší dávka, na pozadí po troškách. Produkt, který už neexistuje nebo záruku neuvádí,
  // se zapíše jako „ptali jsme se“. { count (zjištěno / zapsáno), pending (zbývá), blocked? }
  async syncWarranties({ domainKey, getJson, force = false }) {
    const key = AlzaCore.storageKeys.owned;
    const readOwned = async () => {
      const { [key]: owned } = await chrome.storage.local.get(key);
      return owned && typeof owned === "object" ? owned : null;
    };
    // Uživatel mezitím vypnul volbu nebo smazal načtené nákupy
    const stopped = async () => !(await AlzaCore.getSettings()).ownedItems || !(await readOwned());
    const wait = () => new Promise((resolve) => setTimeout(resolve, this.pageDelayMs));
    const breaker = AlzaOrders.createBreaker();
    if (await stopped()) return { count: 0, pending: 0 };
    const queue = AlzaCore.getOwnedWarrantyQueue(await readOwned(), domainKey);
    const results = [];
    for (const { key, id } of queue.slice(0, AlzaCore.ownedWarrantiesPerRun * (force ? 3 : 1))) {
      if (results.length > 0) await wait();
      if (await stopped()) return { count: 0, pending: 0 };
      let json = null;
      let error = null;
      try {
        json = await getJson(AlzaCore.getProductApiUrl(domainKey, id));
      } catch (caught) {
        error = caught;
      }
      if (json && typeof json === "object") {
        breaker.ok();
        results.push({ key, months: AlzaCore.parseProductWarranty(json) });
        continue;
      }
      // Odmítnutí (403 / 429) = zkusit příště; jiná chyba (produkt už neexistuje) = neptat se pořád dokola
      if (!breaker.fail(error)) results.push({ key, months: null });
      if (breaker.open) break;
    }
    if (results.length > 0) await AlzaStore.run({ type: "applyOwnedWarranties", domain: domainKey, results });
    return { count: results.length, pending: queue.length - results.length, ...(breaker.open && { blocked: true }) };
  },
};
