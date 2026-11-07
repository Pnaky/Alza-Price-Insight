// Content script (část AlzaPriceTracker): Hlídání seznamu na pozadí: synchronizace hlídaného seznamu, zvonečky v záložkách.
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Hlídání seznamu na pozadí (src/background.js) ===
  // Složení seznamu zná jen stránka, proto se hlídaný seznam aktualizuje při každém otevření.
  // Hlídá se celý seznam (ne jednotlivé položky), takže přesun položky mezi seznamy nic nerozbije.

  getWatchKey(listId) {
    return `${this.getAlzaDomain()}|${listId}`;
  },

  getWatchedListProducts() {
    const products = {};
    document.querySelectorAll(this.selectors.listItem).forEach((item) => {
      const product = this.getProductInfo(item);
      if (product) products[product.url] = { name: product.name, image: product.image };
    });
    return products;
  },

  getSelectedListName() {
    return document.querySelector(`${this.selectors.selectedListTab} ${this.selectors.listTabName}`)?.textContent.trim() || null;
  },

  // Počet položek ze záložky otevřeného seznamu "(11)"; null = záložka / počet nenalezen
  getSelectedListCount() {
    const text = document.querySelector(`${this.selectors.selectedListTab} ${this.selectors.listTabCount}`)?.textContent || "";
    const match = text.match(/\d+/);
    return match ? Number(match[0]) : null;
  },

  buildWatchedList(listId, existing) {
    return {
      domain: this.getAlzaDomain(),
      listId,
      // Název ze záložky (při přejmenování se při dalším otevření aktualizuje)
      name: this.getSelectedListName() || existing?.name || document.title.split("|")[0].trim() || listId,
      url: window.location.href,
      since: existing?.since || Date.now(),
      syncedAt: Date.now(),
      products: this.getWatchedListProducts(),
    };
  },

  async syncWatchedList(listId) {
    const storageKey = AlzaCore.storageKeys.watchLists;
    const key = this.getWatchKey(listId);
    const existing = (await this.getStorageData(storageKey))[storageKey]?.[key];
    if (!existing) return;

    const list = this.buildWatchedList(listId, existing);
    // Prázdný seznam v DOM spíš znamená nedokončené vykreslení než smazání všech položek
    if (Object.keys(list.products).length === 0) return;
    // Pojistka proti položkám jiného seznamu (přepínání záložek): počet položek na stránce musí sedět
    // s počtem u vybrané záložky, jinak raději nic nepřepsat – synchronizuje se při dalším otevření
    const tabCount = this.getSelectedListCount();
    if (tabCount !== null && tabCount !== document.querySelectorAll(this.selectors.listItem).length) return;
    // update = jen pokud se mezitím nepřestal hlídat (popup, jiná záložka)
    await AlzaStore.run({ type: "patchMap", key: storageKey, update: { [key]: list }, keep: ["since"] });
  },

  // Změny produktů otevřeného seznamu jsou viděny – služba na pozadí je odečte z čísla na ikoně
  markListSeen(items) {
    const keys = [...items]
      .map((item) => item.querySelector(this.selectors.productLink)?.href)
      .filter(Boolean)
      .map((url) => this.getProductKey(url));
    if (keys.length === 0) return;
    // Po aktualizaci rozšíření je kontext stránky neplatný (vyhodí hned) – číslo na ikoně pak nevadí
    try {
      Promise.resolve(chrome.runtime.sendMessage({ action: "watchSeen", keys })).catch(() => {});
    } catch {
      // ignorovat
    }
  },

  async getWatchState() {
    const listId = this.state.listId;
    if (!listId) return { listId: null, watched: false };
    const storageKey = AlzaCore.storageKeys.watchLists;
    const list = ((await this.getStorageData(storageKey))[storageKey] || {})[this.getWatchKey(listId)];
    return this.describeWatchState(listId, list);
  },

  // Seznam z importované zálohy nemusí mít products
  describeWatchState(listId, list) {
    return { listId, watched: Boolean(list), name: list?.name, count: Object.keys(list?.products || {}).length };
  },

  async setListWatched(enabled) {
    const listId = this.state.listId;
    if (!listId) return this.getWatchState();

    const storageKey = AlzaCore.storageKeys.watchLists;
    const key = this.getWatchKey(listId);
    const existing = (await this.getStorageData(storageKey))[storageKey]?.[key];
    const lists = await AlzaStore.run({
      type: "patchMap",
      key: storageKey,
      ...(enabled ? { set: { [key]: this.buildWatchedList(listId, existing) }, keep: ["since"] } : { remove: [key] }),
    });
    return this.describeWatchState(listId, lists[key]);
  },

  // Zvoneček v záložkách seznamů. Záložky nemají listId (to je jen v URL otevřeného seznamu),
  // proto se přepíná jen u otevřeného seznamu a ostatní hlídané seznamy se označí podle názvu.
  // Do záložek se nevkládá žádný prvek – React by při hydrataci narazil na cizí uzel a překreslil
  // celý seznam i s cenami. Zvoneček je ::after přes CSS třídu a klik se pozná podle pozice.
  setupWatchBells() {
    const storageKey = AlzaCore.storageKeys.watchLists;
    this.getStorageData(storageKey)
      .then((data) => {
        this.state.watchLists = data[storageKey] || {};
        this.scheduleWatchBells();
      })
      .catch((error) => console.error("Error loading watched lists:", error));

    // Změny z popupu nebo z jiné záložky prohlížeče
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[storageKey]) return;
      this.state.watchLists = changes[storageKey].newValue || {};
      this.scheduleWatchBells();
    });

    // React záložky překresluje (přepnutí seznamu, menu "…") a přepisuje jim třídy – označení doplnit znovu
    AlzaCore.createObserver(() => this.scheduleWatchBells(), { ignoreOwn: true }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-testid", "class"],
    });

    // Klik na zvoneček zachytit dřív, než ho dostane React (ten by přepnul seznam)
    ["pointerdown", "mousedown", "click"].forEach((type) =>
      window.addEventListener(type, (event) => this.onWatchBellEvent(event), true)
    );
  },

  scheduleWatchBells() {
    this.scheduleFrame("watchBells", () => this.renderWatchBells());
  },

  // Musí být idempotentní – vlastní změny tříd znovu spouští observer
  renderWatchBells() {
    const domain = this.getAlzaDomain();
    const lists = Object.values(this.state.watchLists).filter((list) => list.domain === domain);
    const watchedNames = new Set(lists.map((list) => list.name));
    const currentWatched = Boolean(this.state.listId && this.state.watchLists[this.getWatchKey(this.state.listId)]);

    document.querySelectorAll(this.selectors.listTab).forEach((tab) => {
      const name = tab.querySelector(this.selectors.listTabName)?.textContent.trim();
      const isCurrent = Boolean(this.state.listId) && tab.matches(this.selectors.selectedListTab);

      // Linka pod záložkou = hlídaný seznam, zvoneček jen u otevřeného seznamu
      this.setTabClass(tab, "alza-price-tracker-watched-tab", isCurrent ? currentWatched : watchedNames.has(name));
      this.setTabClass(tab, "alza-price-tracker-watch-tab", isCurrent);
    });
  },

  // classList.toggle zapíše atribut i beze změny – to by znovu spustilo observer
  setTabClass(tab, className, enabled) {
    if (tab.classList.contains(className) !== enabled) tab.classList.toggle(className, enabled);
  },

  // Příznak na prvku Alzy (data-alza-price-tracker-…) – jen při změně, ať se observer zbytečně nespouští
  setFlag(element, name, enabled) {
    if (element.hasAttribute(name) !== enabled) element.toggleAttribute(name, enabled);
  },

  isOnWatchBell(tab, x, y) {
    const { right, size, tolerance } = this.config.watchBell;
    const rect = tab.getBoundingClientRect();
    const bellRight = rect.right - right;
    const middle = rect.top + rect.height / 2;
    return x >= bellRight - size - tolerance && x <= bellRight + tolerance && Math.abs(y - middle) <= size / 2 + tolerance;
  },

  async onWatchBellEvent(event) {
    if (!event.isTrusted) return; // jen skutečný klik uživatele, ne událost vyvolaná skriptem stránky
    const tab = event.target?.closest?.(".alza-price-tracker-watch-tab");
    if (!tab || !this.isOnWatchBell(tab, event.clientX, event.clientY)) return;
    // Rozšíření bylo aktualizováno – klik nepohltit, zvoneček by stejně nic neuložil
    if (!AlzaCore.isContextAlive()) return;

    event.stopPropagation();
    if (event.type !== "click") return;
    event.preventDefault();

    const watched = Boolean(this.state.watchLists[this.getWatchKey(this.state.listId)]);
    try {
      await this.setListWatched(!watched); // označení překreslí storage.onChanged
    } catch (error) {
      console.error("Error toggling watched list:", error);
    }
  },
});
