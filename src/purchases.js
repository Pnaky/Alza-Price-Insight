// Content script: Hlídání po nákupu – objednávky ze stránky Alzy (AlzaOrders v shared/orders.js; totéž dělá i kontrola
// na pozadí). Číslo účtu se nikam neukládá – vezme se z požadavků, které stránka Alzy sama poslala (Performance API).
// Na stránkách „Můj účet“ (Objednávky, detail objednávky) bez omezení četnosti. Jen se zapnutou volbou watchPurchases.
const AlzaPurchases = {
  userIdWaitMs: 4000, // Stránka své požadavky na /api/users/<číslo>/ pošle až po načtení

  async init() {
    const domainKey = AlzaCore.getDomainKey(window.location.hostname);
    if (!domainKey || !AlzaCore.domains[domainKey]) return;
    if (!(await AlzaCore.getSettings()).watchPurchases) return;
    await AlzaOrders.check({
      domainKey,
      origin: window.location.origin,
      getJson: (url) => this.getJson(url),
      getUserId: () => this.findUserId(),
      always: /^\/my-account\//i.test(window.location.pathname),
      waitMs: this.userIdWaitMs,
    });
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
};

AlzaPurchases.init().catch((error) => console.error("Alza Price Insight – nákupy:", error));
