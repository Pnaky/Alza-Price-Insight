// Content script: Hlídání po nákupu – koupené zboží z „Moje objednávky“ (posledních 14 dní, bez zrušených) do
// AlzaCore.storageKeys.purchases. Kontrola na pozadí ho pak hlídá do konce lhůty pro vrácení a při zlevnění
// upozorní („Koupili jste za X, teď stojí Y. Do D ho můžete vrátit a koupit znovu.“ – background.js checkPurchase).
// Objednávky čte stejným API jako stránka „Moje objednávky“, ze stránky Alzy s přihlášením uživatele. Číslo účtu
// se nikam neukládá – vezme se z požadavků, které stránka Alzy sama poslala (Performance API).
// Načítá se nejvýš jednou za AlzaCore.purchaseSyncHours a jen se zapnutou volbou watchPurchases.
const AlzaPurchases = {
  userIdWaitMs: 4000, // Stránka své požadavky na /api/users/<číslo>/ pošle až po načtení
  maxOrders: 20,

  async init() {
    const domainKey = AlzaCore.getDomainKey(window.location.hostname);
    if (!domainKey || !AlzaCore.domains[domainKey]) return;
    if (!(await AlzaCore.getSettings()).watchPurchases) return;

    const syncKey = AlzaCore.storageKeys.purchasesSync;
    const { [syncKey]: sync = {} } = await chrome.storage.local.get(syncKey);
    if (Date.now() - (sync?.[domainKey] || 0) < AlzaCore.purchaseSyncHours * 60 * 60 * 1000) return;

    await new Promise((resolve) => setTimeout(resolve, this.userIdWaitMs));
    const userId = this.findUserId();
    if (!userId) return; // Nepřihlášený uživatel (nebo stránka bez požadavků na účet) – zkusí se jinde
    await this.sync(domainKey, userId);
    await AlzaStore.run({ type: "assign", key: syncKey, values: { [domainKey]: Date.now() } });
  },

  findUserId() {
    for (const entry of performance.getEntriesByType("resource")) {
      const match = entry.name.match(/^https:\/\/www\.alza\.(?:cz|sk|hu)\/api\/users\/(\d+)\//);
      if (match) return match[1];
    }
    return null;
  },

  async getJson(url) {
    // Firefox: content.fetch posílá požadavek jako stránka Alzy (původ, cookies); Chrome to dělá i obyčejný fetch
    const pageFetch = typeof content !== "undefined" && typeof content?.fetch === "function" ? content.fetch.bind(content) : fetch;
    const response = await pageFetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },

  async sync(domainKey, userId) {
    const base = `${window.location.origin}/api/users/${userId}/v1/orders`;
    const since = Date.now() - AlzaCore.purchaseReturnDays * AlzaCore.dayMs;
    const lists = await Promise.all([
      this.getJson(`${base}/active?productFilterType=0`).catch(() => null),
      this.getJson(`${base}/archive?productFilterType=0&offset=0&limit=${this.maxOrders}`).catch(() => null),
    ]);
    const orders = lists
      // Archiv: value[]; aktivní objednávky: groups[].orders[]
      .flatMap((list) => [...(Array.isArray(list?.value) ? list.value : []), ...(Array.isArray(list?.groups) ? list.groups.flatMap((group) => group?.orders || []) : [])])
      .filter((order) => Date.parse(order?.created) >= since && !AlzaCore.isCancelledOrder(order?.state) && typeof order?.self?.href === "string");

    // Stejný produkt ve víc objednávkách – hlídá se nejnižší zaplacená cena (a nejpozdější lhůta)
    const purchases = {};
    for (const order of orders) {
      const href = new URL(order.self.href, window.location.origin);
      if (href.origin !== window.location.origin) continue;
      const detail = await this.getJson(href.href).catch(() => null);
      AlzaCore.parseOrderPurchases(detail, domainKey).forEach(({ key, ...purchase }) => {
        const previous = purchases[key];
        if (!previous || purchase.price < previous.price) purchases[key] = { ...purchase, domain: domainKey, returnUntil: Math.max(purchase.returnUntil, previous?.returnUntil || 0) };
      });
    }

    // Prošlé lhůty této domény pryč; u stávajících zůstane, o jaké ceně už přišlo upozornění
    const key = AlzaCore.storageKeys.purchases;
    const { [key]: stored = {} } = await chrome.storage.local.get(key);
    const now = Date.now();
    const remove = Object.entries(stored || {})
      .filter(([entry, value]) => value?.domain === domainKey && !(value?.returnUntil > now) && !purchases[entry])
      .map(([entry]) => entry);
    if (Object.keys(purchases).length > 0 || remove.length > 0) {
      await AlzaStore.run({ type: "patchMap", key, set: purchases, remove, keep: ["notifiedPrice"] });
    }
  },
};

AlzaPurchases.init().catch((error) => console.error("Alza Price Insight – nákupy:", error));
