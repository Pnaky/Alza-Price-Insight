// Content script: ceny, historie a hlídání cen v nákupních seznamech a na detailu produktu Alzy.
// Základ objektu AlzaPriceTracker (nastavení, stav, načítání seznamu, zobrazení cen); další části
// v src/content/ se k němu přidají přes Object.assign, spustí ho content/start.js
const AlzaPriceTracker = {
  config: {
    targetUrlPattern: /https:\/\/www\.(alza\.cz|alza\.sk|alza\.hu)\/Order1\.htm(\?.*)?/,
    cacheValidityMs: 15 * 60 * 1000, // 15 minut
    batchSize: 3,
    failedBatchRetryDelay: 2000, // Zpoždění před opětovným pokusem o načtení dávky
    maxBatchRetryAttempts: 3, // Maximální počet pokusů o načtení celé dávky
    // Barvy čar v grafu historie (odpovídají barvám boxů v css/main.css)
    historyTypes: {
      original: "#e53935",
      blackfriday: "#212121",
      special: "#0094e7",
      benefit: "#5b7fb5",
      b2b: "#2fa585",
      applus: "#f29400",
      discount: "#d4a900",
      cashback: "#2e7d32",
      scrappage: "#689700",
    },
    // Barvy dostupnosti podle Alzy (skladem zelená, na cestě modrá, nedostupné i na objednávku oranžová);
    // prodej skončil = šedá, produkt "zamrzne" bez cen
    historyAvailabilityColors: {
      in: "#5cb82e",
      order: "#f26b1d",
      expected: "#0094e7",
      out: "#f26b1d",
      ended: "#9e9e9e",
      other: "#cfcfcf",
    },
    // Zvoneček v záložce seznamu (::after) – musí odpovídat .alza-price-tracker-watch-tab v css/main.css
    watchBell: { right: 8, size: 18, tolerance: 3 },
    // Po přepnutí záložky Alza změní adresu hned, položky nového seznamu vykreslí až po ~300 ms – tak dlouho
    // nejvýš čekat, než se položky na stránce vymění (jinak by se položky starého seznamu přiřadily novému)
    listSwitchTimeoutMs: 3000,
    historyMilestoneColors: {
      min: "#2e7d32",
      max: "#8e24aa",
      target: "#ef6c00",
    },
    // Hodnocení aktuální ceny vůči obvyklé (AlzaCore.getPriceVerdict)
    verdictColors: {
      lowest: "#2e7d32",
      good: "#2e7d32",
      usual: "#757575",
      high: "#c62828",
    },
  },

  // Překlady (cz/sk/hu) – společné texty z AlzaCore + texty stránky
  translations: AlzaPriceTrackerTexts, // content/texts.js
  state: {
    currencySymbol: null,
    locale: null,
    language: null, // Jazyk domény – podle něj se čte stránka Alzy (dostupnost…)
    uiLanguage: null, // Jazyk zobrazených textů (AlzaCore.getDisplayLanguage – volba v nastavení, jinak jazyk domény)
    saveBrowsing: false, // Volba „Ukládat ceny z procházení“ – detail se pak zapíše i u nehlídaného produktu
    listId: null,
    listSignature: null, // Položky naposledy zpracovaného seznamu (rememberListState)
    loadedListName: null, // Jeho vybraná záložka
    listSwitchWait: null, // Zrušení čekání na položky po přepnutí záložky (loadList)
    missingPricesIntervalId: null,
    // Notifikace o průběhu načítání cen
    loading: {
      isLoading: false,
      itemsToLoad: 0,
      itemsLoaded: 0,
      notificationElement: null,
    },
    priceRecords: new Map(), // Záznamy cen (klíč produktu → záznam) načtené pro stránku; obnovuje storage.onChanged
    urlObserver: null, // Jediný observer pro sledování změn URL
    itemsObserver: null, // Čekání na vykreslení položek seznamu
    inFlightItems: new WeakSet(), // Položky, pro které právě probíhá načítání (prevence duplicit)
    historyTriggers: new WeakSet(), // Prvky s listenerem pro otevření historie
    noPriceUrls: new Set(), // Neprodávané produkty – prázdná cena u nich není chybějící cena k dotažení
    savedRecords: new Map(), // Právě uložené záznamy (productUrl → record) pro zobrazení bez dalšího čtení storage
    scheduledFrames: new Set(), // Úlohy naplánované na příští snímek (scheduleFrame)
    variantStats: null, // Výběr velikosti na detailu: { záhlaví výběru: ceny variant } přečtené z rozbalených nabídek
    quantityTotalResize: false, // Posluchač změny velikosti okna pro sloupec součtu už je
    cartWarningsReady: false, // Zachytávání vložení do košíku už je nastavené
    cartWarningBypass: false, // Uživatel v upozornění zvolil „Přesto vložit“ – další klik projde
    closeCartWarning: null, // Zavření otevřeného upozornění před vložením do košíku
    saveBlocked: null, // Důvod pozastavení ukládání (nepřihlášen, ceny bez DPH…) – platí do dalšího načtení seznamu
    saveBlockedElement: null,
    watchLists: {}, // Hlídané seznamy (kopie alzaWatchLists) pro vykreslení zvonečků bez čtení storage
    targets: {}, // Cílové ceny (kopie alzaTargets)
    itemData: new WeakMap(), // Položka seznamu → { url, priceMap, change, packCount, discountWarning, strikethroughWarning, verdict }
    listView: { filter: "all", sort: "default" }, // Filtr a řazení v liště nad seznamem
    toolbarElement: null,
    product: null, // Detail produktu: { url, name, image }
    productData: null, // Uložený záznam ceny ze seznamu (je-li)
    productPanelTimeout: null,
  },

  // === Selektory na jednom místě ===
  selectors: {
    listItem: '[data-testid="shoppingListItem"]', // wrapper položky
    productLink: '[data-testid="shoppingListItem_name"]', // odkaz na produkt
    image: '[data-testid="shoppingListItem_image"]', // obrázek
    priceContainer: '[data-testid="shoppingListItem_price"]', // hlavní cena
    availability: '[data-testid="shoppingListItem_availability"]', // dostupnost
    quantityInput: '[data-testid="slider/valueInput"]', // počet ks
    addToCartButton: '[data-testid="shoppingListItem_addToCartButton"]', // vložit položku do košíku
    buyAllButton: '[data-testid="shoppingListItem_buyAllButton"]', // přidat vše do košíku
    listTab: '[data-testid="shoppingListsTabs_item"], [data-testid="shoppingListsTabs_selectedItem"]', // záložka seznamu (i v menu "…")
    selectedListTab: '[data-testid="shoppingListsTabs_selectedItem"]',
    listTabName: '[data-testid="shoppingListsTabs_itemName"]',
    listTabCount: '[data-testid="shoppingListsTabs_itemCount"]', // "(11)" – počet položek seznamu
  },

  init() {
    // Content script se vkládá na všechny stránky Alzy (výpisy kategorií obsluhuje category.js) – tady
    // jen seznamy (Order1.htm) a detail produktu (*-d<číslo>.htm). Ostatní stránky nechat být
    const isListPage = this.config.targetUrlPattern.test(window.location.href);
    const isProductPage = !isListPage && Boolean(AlzaCore.getProductId(window.location.pathname + window.location.search)) && AlzaCore.isProductDocument(document);
    if (!isListPage && !isProductPage) return;

    if (!chrome?.storage?.local) {
      console.error("❌ Rozšíření nemůže být inicializováno - chrome.storage.local není dostupné");
      return;
    }

    // Firefox po aktualizaci rozšíření vloží skript do otevřené stránky znovu – prvky předchozí verze jsou mrtvé
    // (lišta, oznámení) a dostupnost by měla starý příznak, takže by se k ní historie znovu nepřipojila
    document
      .querySelectorAll(".alza-price-tracker-toolbar:not(.alza-price-tracker-unit-toolbar), .alza-price-tracker-notification")
      .forEach((element) => element.remove());
    document.querySelectorAll(".alza-price-tracker-history-trigger").forEach((element) => element.classList.remove("alza-price-tracker-history-trigger"));

    const { currency, locale, lang } = AlzaCore.domains[this.getAlzaDomain()];
    this.state.currencySymbol = currency;
    this.state.locale = locale;
    this.state.language = lang;
    this.state.uiLanguage = lang;

    // Jazyk textů z nastavení ještě před prvním vykreslením
    AlzaCore.getSettings()
      .then((settings) => {
        this.state.uiLanguage = AlzaCore.getDisplayLanguage(settings, lang);
        this.state.saveBrowsing = settings.saveBrowsing;
      })
      .catch((error) => console.error("Error loading settings:", error))
      .finally(() => this.start(isListPage));
  },

  start(isListPage) {
    try {
      this.setupMessageListener();
      this.setupTargets();
      this.logExtensionInfo();

      if (isListPage) {
        this.observePageChanges().catch((error) => console.error("Error observing page changes:", error));
        this.setupWatchBells();
        this.setupCartWarnings();
        this.watchPriceRecords();
        this.removeLegacyPriceChanges().catch((error) => console.error("Error removing legacy keys:", error));
      } else {
        this.setupProductPage().catch((error) => console.error("Error setting up product page:", error));
      }
    } catch (error) {
      console.error("Chyba při inicializaci:", error);
    }
  },

  // Pomocná metoda pro překlady s parametry
  translate(key, ...params) {
    return AlzaCore.translateFrom(this.translations, this.state.uiLanguage || this.state.language || "cz", key, params);
  },

  // Položky otevřeného seznamu jako text adres produktů – pozná, že se po přepnutí seznamu vyměnily
  getListSignature() {
    return [...document.querySelectorAll(this.selectors.listItem)].map((item) => item.querySelector(this.selectors.productLink)?.href || "").join("\n");
  },

  // Naposledy zpracovaný seznam (položky + záložka) – loadList podle něj pozná přepnutí na jiný seznam
  rememberListState() {
    this.state.listSignature = this.getListSignature();
    this.state.loadedListName = this.getSelectedListName();
  },

  getAlzaDomain() {
    return AlzaCore.getDomainKey(window.location.hostname);
  },

  async observePageChanges() {
    let lastUrl = window.location.href;

    // Přepnutí záložky: Alza mění adresu a položky v různém pořadí (adresa někdy hned, položky až po ~300 ms,
    // jindy obojí najednou). Položky ID seznamu nenesou – nový seznam se pozná podle toho, že jsou na stránce
    // jiné položky než v naposledy zpracovaném seznamu. Do té doby čekat; když se nevymění (stejný seznam,
    // nebo už se vyměnily dřív, než se změnila adresa), ceny zobrazit, ale hlídaný seznam nepřepisovat –
    // položky starého seznamu by se uložily pod nový listId. Nové načtení stránky adresu vždy odpovídá
    const loadList = (switched = false) => {
      if (!window.location.href.includes("Order1.htm?listId=")) return;
      const listId = new URLSearchParams(window.location.search).get("listId") || "Neznámé ID";
      this.state.listId = listId;
      this.state.listSwitchWait?.();

      const load = (syncWatched) => {
        this.state.listSwitchWait = null;
        if (this.state.listId !== listId) return;
        this.reloadPrices(listId, { syncWatched }).catch((error) => console.error("Error reloading prices:", error));
        // Po načtení hlavních cen nastavit pozorovatele pro detekci chybějících cen
        setTimeout(() => this.setupMissingPricesObserver(), 3000);
      };
      const previous = this.state.listSignature;
      if (!switched || this.getListSignature() !== previous) {
        load(true);
        return;
      }

      const waitObserver = AlzaCore.createObserver(() => {
        if (this.getListSignature() !== previous) finish(true);
      });
      const timer = setTimeout(() => finish(false), this.config.listSwitchTimeoutMs);
      const stop = () => {
        waitObserver.disconnect();
        clearTimeout(timer);
      };
      const finish = (changed) => {
        stop();
        load(changed);
      };
      this.state.listSwitchWait = stop; // Další přepnutí čekání zruší
      waitObserver.observe(document.body, { childList: true, subtree: true });
    };

    loadList();

    // Observer pro změny URL stačí jeden
    if (this.state.urlObserver) return;

    // Vlastní vykreslení (ceny, lišta) observer nespouští – reaguje jen na změny Alzy
    const observer = AlzaCore.createObserver(() => {
      // Lištu nad seznamem mohl React při překreslení odstranit
      if (this.state.toolbarElement) this.scheduleListToolbar();
      this.scheduleRestorePrices();

      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        loadList(true);
      } else if (!this.state.listSwitchWait && this.state.loadedListName && this.getSelectedListName() === this.state.loadedListName) {
        // Odebrání / přidání položky ve stejném seznamu – zapamatované položky obnovit (při přepnutí
        // záložky se mění i vybraná záložka, takže položky nového seznamu se sem nedostanou)
        this.state.listSignature = this.getListSignature();
      }
    }, { ignoreOwn: true });

    observer.observe(document.body, { childList: true, subtree: true });
    this.state.urlObserver = observer;
  },

  setupMissingPricesObserver() {
    // Zrušit případnou předchozí kontrolu, aby neběželo více intervalů současně
    if (this.state.missingPricesIntervalId) {
      clearInterval(this.state.missingPricesIntervalId);
      this.state.missingPricesIntervalId = null;
    }

    // Kontrola chybějících cen každých 5 sekund, dokud nejsou všechny načteny
    const checkInterval = 5000; // 5 sekund
    const maxChecks = 5; // Maximální počet kontrol (celkově 25 sekund)
    let checkCount = 0;

    const checkAndLoadMissingPrices = () => {
      checkCount++;

      // Najít všechny produkty bez zobrazených cen
      const items = document.querySelectorAll(this.selectors.listItem);
      const missingPriceItems = Array.from(items).filter((item) => {
        if (this.state.inFlightItems.has(item)) return false; // už se načítá
        if (this.state.noPriceUrls.has(item.querySelector(this.selectors.productLink)?.href)) return false;
        const priceContainer = item.querySelector(this.selectors.priceContainer);
        return priceContainer && priceContainer.textContent.trim() === "";
      });

      if (missingPriceItems.length === 0) {
        return true; // Všechno načteno
      }

      if (checkCount > maxChecks) {
        return true; // Ukončit i když nejsou všechny načteny
      }

      // Připravit seznam produktů pro opětovné načtení
      const productsToFetch = missingPriceItems
        .map((item) => {
          const productLink = item.querySelector(this.selectors.productLink);
          return {
            productUrl: productLink ? productLink.href : null,
            item,
          };
        })
        .filter((product) => product.productUrl);

      if (productsToFetch.length > 0) {
        this.batchFetchPrices(productsToFetch, this.state.listId).catch((error) => console.error("Error fetching missing prices:", error));
      }

      return false; // Ještě nejsou všechny načteny
    };

    // Okamžitá první kontrola
    const allLoaded = checkAndLoadMissingPrices();

    // Pokud nejsou všechny načteny, nastavit interval
    if (!allLoaded) {
      const intervalId = setInterval(() => {
        const allLoaded = checkAndLoadMissingPrices();
        if (allLoaded) {
          clearInterval(intervalId);
        }
      }, checkInterval);

      // Uložit ID intervalu pro případné ruční vyčištění
      this.state.missingPricesIntervalId = intervalId;
    }
  },

  // Notifikace o načítání (vytvoří se jednou, pak se jen aktualizuje text)
  showLoadingNotification(total, loaded) {
    // Aktualizace stavu načítání
    this.state.loading.isLoading = true;
    this.state.loading.itemsToLoad = total;
    this.state.loading.itemsLoaded = loaded;

    // Pokud notifikace již existuje, pouze aktualizovat její obsah
    if (this.state.loading.notificationElement) {
      const progressText = this.state.loading.notificationElement.querySelector(".progress-text");
      if (progressText) {
        progressText.textContent = this.translate("loadingProgress", loaded, total);
      }
      return;
    }

    // Vytvoření nové notifikace pomocí CSS tříd
    const notification = document.createElement("div");
    notification.className = "alza-price-tracker-notification";

    const spinner = document.createElement("div");
    spinner.className = "alza-price-tracker-notification-spinner";

    const progressText = document.createElement("span");
    progressText.className = "progress-text";
    progressText.textContent = this.translate("loadingProgress", loaded, total);

    notification.appendChild(spinner);
    notification.appendChild(progressText);
    document.body.appendChild(notification);

    this.state.loading.notificationElement = notification;
  },

  // Metoda pro skrytí notifikace o načítání - používá externí CSS
  hideLoadingNotification() {
    const notification = this.state.loading.notificationElement;
    if (!notification) return;
    // Stav uvolnit hned – načítání dalšího seznamu během animace si vytvoří novou notifikaci,
    // místo aby aktualizovalo tuhle mizející
    this.state.loading.notificationElement = null;
    this.state.loading.isLoading = false;
    notification.classList.add("fade-out");
    setTimeout(() => notification.remove(), 300);
  },

  // Metoda pro přidání spinneru k položce - varianta B (hned za cenou)
  addSpinnerToItem(itemElement) {
    // Přidat třídu pro indikaci načítání
    itemElement.classList.add("alza-price-tracker-loading-item");

    // Najít samotný element s cenou
    const priceContainer = itemElement.querySelector(this.selectors.priceContainer);
    if (!priceContainer) return;

    // Zabránit duplicitám – pokud už je hned za cenou spinner, nic nedělej
    if (priceContainer.querySelector(".alza-price-tracker-spinner-container")) return;

    // Vytvořit spinner container
    const spinnerContainer = document.createElement("div");
    spinnerContainer.className = "alza-price-tracker-spinner-container";

    // Vytvořit spinner
    const spinner = document.createElement("div");
    spinner.className = "alza-price-tracker-spinner";
    spinnerContainer.appendChild(spinner);

    // Připojit spinner přímo ZA cenu
    // Ukotvit spinner k ceně tak, aby neovlivnil layout (absolutní pozice vůči ceně)
    priceContainer.style.position = "relative";
    // pro jistotu vytvořit inline kontext – bez změny šířky řádku
    if (getComputedStyle(priceContainer).display === "inline") {
      priceContainer.style.display = "inline-block";
    }
    priceContainer.appendChild(spinnerContainer);
  },

  removeSpinnerFromItem(itemElement) {
    // Odstranit třídu indikace načítání
    itemElement.classList.remove("alza-price-tracker-loading-item");

    // Najít a odstranit spinner (kdekoliv v položce)
    const spinnerContainer = itemElement.querySelector(
      `${this.selectors.priceContainer} .alza-price-tracker-spinner-container`
    );
    if (spinnerContainer) spinnerContainer.remove();
  },

  // syncWatched = false: položky na stránce nemusí patřit seznamu listId (loadList) – hlídaný seznam nepřepisovat
  async reloadPrices(listId, { syncWatched = true } = {}) {
    this.state.saveBlocked = null;
    this.state.saveBlockedElement?.remove();
    this.state.saveBlockedElement = null;

    const items = document.querySelectorAll(this.selectors.listItem);

    // Čekání na položky předchozího seznamu zrušit – jinak by se při přepínání prázdných seznamů
    // observery hromadily a po vykreslení položek zpracovaly seznam vícekrát
    this.state.itemsObserver?.disconnect();
    this.state.itemsObserver = null;

    if (items.length > 0) {
      this.processItems(items, listId, syncWatched);
    } else {
      const observer = AlzaCore.createObserver((mutations, obs) => {
        const updatedItems = document.querySelectorAll(this.selectors.listItem);
        if (updatedItems.length > 0) {
          obs.disconnect();
          this.state.itemsObserver = null;
          this.processItems(updatedItems, listId, syncWatched);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      this.state.itemsObserver = observer;
    }
  },

  processItems(items, listId, syncWatched = true) {
    this.rememberListState();
    if (syncWatched) this.syncWatchedList(listId).catch((error) => console.error("Error syncing watched list:", error));
    this.markListSeen(items);

    const urls = [...items].map((item) => item.querySelector(this.selectors.productLink)?.href).filter(Boolean);
    this.getPriceRecords(urls).then((storedPrices) => {
      let productsToFetch = [];

      items.forEach((item) => {
        const productUrl = item.querySelector(this.selectors.productLink)?.href;
        if (!productUrl) return;
        const productData = storedPrices[productUrl];

        // Čerstvý záznam (mladší než 15 minut) se zobrazí bez stahování; neprodávaný produkt nemá co zobrazit
        // Čas v budoucnosti (posunuté hodiny) za čerstvý nepovažovat – produkt by se už nikdy nestáhl
        const age = Date.now() - productData?.lastUpdated;
        if (productData && age >= 0 && age < this.config.cacheValidityMs) {
          if (AlzaCore.getPriceEntries(productData).length > 0) {
            this.displayAllPrices(item, null, productData, productUrl);
          } else {
            this.state.noPriceUrls.add(productUrl);
            this.removeSpinnerFromItem(item);
          }
          return;
        }

        // Ceny jsou staré nebo chybí - načíst nové
        productsToFetch.push({ productUrl, item });
        this.addSpinnerToItem(item);
      });

      // Zkrácení textů dostupnosti + klik na historii i u položek, které se nezobrazí přes displayAllPrices
      this.scheduleAvailabilityText();

      if (productsToFetch.length > 0) {
        // Zobrazit notifikaci o načítání
        this.showLoadingNotification(productsToFetch.length, 0);
        this.batchFetchPrices(productsToFetch, listId).catch((error) => console.error("Error fetching prices:", error));
      }
    }).catch((error) => console.error("Error processing list items:", error));
  },

  // Helper method for updating loading notification
  updateLoadingNotification() {
    if (this.state.loading.isLoading) {
      this.state.loading.itemsLoaded++;
      this.showLoadingNotification(this.state.loading.itemsToLoad, this.state.loading.itemsLoaded);

      // Pokud jsou všechny položky načteny, skrýt notifikaci
      if (this.state.loading.itemsLoaded >= this.state.loading.itemsToLoad) {
        setTimeout(() => this.hideLoadingNotification(), 1000);
      }
    }
  },

  // Stažení a rozbor stránky produktu ve službě na pozadí (shared/product-page.js – v Chromu offscreen dokument):
  // HTML se neparsuje na hlavním vlákně Alzy, má timeout a cookies se pošlou jen Alze (i po přesměrování).
  // Vrací výsledek fetchProductPage; přechodnou chybu (síť, timeout, 429, 5xx) vyhodí – kolo stahování ji
  // zopakuje (retryFailedProducts). Trvalou (404, přesměrování mimo Alzu, není detail) vrátí { ok: false }
  async fetchProductPage(url) {
    const result = await chrome.runtime.sendMessage({ action: "fetchProductPage", url });
    if (!result) throw new Error("Služba na pozadí neodpověděla");
    if (!result.ok && AlzaCore.isRetryableFetchError(result)) throw new Error(result.error);
    return result;
  },

  // Pozastavení ukládání do dalšího načtení seznamu (nepřihlášen, ceny bez DPH…) s upozorněním na stránce
  blockSaving(reasonKey) {
    if (this.state.saveBlocked) return;
    this.state.saveBlocked = reasonKey;
    console.warn("Ukládání cen pozastaveno:", reasonKey);

    const warning = this.createEl("div", "alza-price-tracker-notification alza-price-tracker-notification--warning", `⚠️ ${this.translate(reasonKey)}`);
    warning.title = this.translate("close");
    warning.addEventListener("click", () => warning.remove());
    document.body.appendChild(warning);
    this.state.saveBlockedElement = warning;
  },

  // Stažení stránky produktu, ceny, uložení a zobrazení. Přechodná chyba se vyhodí (opakuje ji kolo stahování)
  async fetchOriginalPrice(productUrl, itemElement, listId) {
    // Ukládání je pozastavené – další produkty už zbytečně nestahovat
    if (this.state.saveBlocked) {
      this.removeSpinnerFromItem(itemElement);
      return { skipped: true };
    }

    let page;
    try {
      page = await this.fetchProductPage(productUrl);
    } catch (error) {
      this.removeSpinnerFromItem(itemElement);
      throw error;
    }
    if (!page.ok || !page.isProduct) {
      // Trvalá chyba – opakování nepomůže (404, přihlášení / captcha místo detailu…)
      console.warn(`Alza Price Insight – produkt nejde načíst (${page.error || "není detail produktu"}): ${productUrl}`);
      this.state.noPriceUrls.add(productUrl); // Doplňování chybějících cen by ho jinak stahovalo znovu každých pár sekund
      this.removeSpinnerFromItem(itemElement);
      this.updateLoadingNotification();
      return { skipped: true };
    }

    // Bez přihlášení nebo s cenami bez DPH nic neukládat – rozbilo by to historii i min/max
    if (page.saveProblem) {
      this.blockSaving(page.saveProblem);
      this.removeSpinnerFromItem(itemElement);
      return { skipped: true };
    }

    const { prices, name, packCount, quantityTiers, conditions } = page;
    // Dostupnost z řádku jen když v něm je pořád tentýž produkt (stahování trvá, React mezitím mohl řádek použít
    // pro jiný) – null = beze změny
    const availability = itemElement.querySelector(this.selectors.productLink)?.href === productUrl ? this.getAvailabilityCode(itemElement) : null;
    const recordHistory = (snapshot, oldPrices) =>
      this.recordPriceHistory(productUrl, snapshot, availability, oldPrices?.[productUrl], name).catch((error) =>
        console.error(`Error saving price history for ${productUrl}:`, error)
      );

    // Produkt se neprodává – uložit prázdný záznam a pokračovat bez chyby. Příznak noPrice nastaví lastUpdated,
    // takže se produkt 15 minut znovu nestahuje
    if (AlzaCore.getPriceEntries(prices || {}).length === 0) {
      this.removeSpinnerFromItem(itemElement);
      this.state.noPriceUrls.add(productUrl);
      const oldPrices = await this.savePricesToStorage({ [productUrl]: { noPrice: true } }, listId);
      recordHistory({}, oldPrices);
      this.state.savedRecords.delete(productUrl);
      this.updateLoadingNotification();
      return { noPrice: true };
    }

    // Počet kusů a množstevní slevy se ukládají jako metaúdaje záznamu (bez historie). Počet kusů, který detail
    // tentokrát nemá, zůstane původní; množstevní slevy a ceny jiných stavů se přepíšou vždy (null je smaže)
    let savedRecord;
    try {
      const oldPrices = await this.savePricesToStorage({ [productUrl]: { ...prices, ...(packCount && { packCount }), quantityTiers, conditions } }, listId);
      recordHistory(prices, oldPrices);
      savedRecord = this.state.savedRecords.get(productUrl) || null;
      this.state.savedRecords.delete(productUrl);
    } catch (error) {
      this.removeSpinnerFromItem(itemElement);
      throw error;
    }

    this.state.noPriceUrls.delete(productUrl);
    // Zobrazit s právě uloženým záznamem – bez dalšího čtení storage
    await this.displayAllPrices(itemElement, AlzaCore.getPriceEntries(prices), savedRecord, productUrl);
    this.removeSpinnerFromItem(itemElement);
    this.updateLoadingNotification();
    return prices;
  },

  // Pool s pevným počtem souběžných úloh – další úloha startuje hned, jak se uvolní místo
  // (dříve se čekalo na dokončení celé trojice, tj. na nejpomalejší request)
  async runWithConcurrency(items, limit, worker) {
    let index = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index++];
        try {
          await worker(current);
        } catch (error) {
          console.error("Unexpected worker error:", error);
        }
      }
    });
    await Promise.all(runners);
  },

  // Jedno kolo stahování; vrací produkty, které selhaly (fetchOriginalPrice při úspěchu vždy resolvne
  // – i u přeskočeného nebo neprodávaného produktu)
  async fetchRound(products, listId, errorLabel) {
    const failedProducts = [];
    await this.runWithConcurrency(products, this.config.batchSize, (element) =>
      this.fetchOriginalPrice(element.productUrl, element.item, listId).catch((error) => {
        console.error(`${errorLabel} ${element.productUrl}:`, error);
        failedProducts.push(element);
      })
    );
    return failedProducts;
  },

  // Helper for retrying failed products
  async retryFailedProducts(failedProducts, listId) {
    if (failedProducts.length === 0) return [];

    await new Promise((resolve) => setTimeout(resolve, this.config.failedBatchRetryDelay));

    // Opakování neúspěšných produktů až třikrát s postupně se zvyšujícím zpožděním
    let remainingProducts = [...failedProducts];
    let retryAttempt = 1;
    const maxRetryAttempts = this.config.maxBatchRetryAttempts;

    while (remainingProducts.length > 0 && retryAttempt <= maxRetryAttempts) {
      remainingProducts = await this.fetchRound(remainingProducts, listId, `Retry ${retryAttempt} failed for`);
      retryAttempt++;

      // Pokud stále máme neúspěšné produkty a nejsme na posledním pokusu, počkáme před dalším pokusem
      if (remainingProducts.length > 0 && retryAttempt <= maxRetryAttempts) {
        // Exponenciální prodleva mezi pokusy celé dávky
        const nextDelay = this.config.failedBatchRetryDelay * 1.5 ** (retryAttempt - 1);
        await new Promise((resolve) => setTimeout(resolve, nextDelay));
      }
    }

    return remainingProducts;
  },

  // Produkty, které se nepodařilo načíst ani po opakování
  reportFailedProducts(failedProducts) {
    if (failedProducts.length > 0) {
      console.error(
        `Failed to load prices for ${failedProducts.length} products after all attempts:`,
        failedProducts.map((el) => el.productUrl)
      );

      // Odstranit spinnery ze zbývajících položek
      failedProducts.forEach(({ item }) => {
        this.removeSpinnerFromItem(item);
      });
    }
  },

  async batchFetchPrices(products, listId) {
    // Přeskočit položky, které se už načítají (např. kontrola chybějících cen nebo opakovaný reload)
    products = products.filter(({ item }) => !this.state.inFlightItems.has(item));
    if (products.length === 0) return;
    products.forEach(({ item }) => this.state.inFlightItems.add(item));

    let remainingProducts = [];
    try {
      // První kolo načítání
      const failedProducts = await this.fetchRound(products, listId, "Failed to fetch price for");

      // Druhé kolo - opakované načítání produktů, které selhaly
      remainingProducts = await this.retryFailedProducts(failedProducts, listId);
    } finally {
      products.forEach(({ item }) => this.state.inFlightItems.delete(item));
    }

    this.reportFailedProducts(remainingProducts);

    // Skrýt notifikaci po dokončení všech pokusů
    setTimeout(() => this.hideLoadingNotification(), 1000);
  },

  // Cena i s měnou domény ("1 299 Kč", "12,90 €") – stejné pravidlo jako služba na pozadí a popup
  formatPrice(price) {
    // bezpečnostní pojistka – pokud náhodou přijde nedefinovaná/nečíselná hodnota
    if (typeof price !== "number" || Number.isNaN(price)) return "";
    return AlzaCore.formatPrice(price, this.getAlzaDomain());
  },

  // Čtení přímo; zápisy přes AlzaStore (jediný zapisovatel – služba na pozadí, souběžné záložky se nepřepíšou)
  getStorageData(keys) {
    return chrome.storage.local.get(keys);
  },

  // Uložení cen (AlzaCore.mergePriceRecord – min/max, šipka změny…). prices = { url: ceny + meta }.
  // Vrací { url: záznam před sloučením }; uložené záznamy jsou v state.savedRecords a v mezipaměti
  async savePricesToStorage(prices, listId) {
    const result = await AlzaStore.run({ type: "mergePrices", domain: this.getAlzaDomain(), records: prices, listId });
    const oldPrices = {};
    Object.entries(result).forEach(([url, { before, record }]) => {
      if (before) oldPrices[url] = before;
      this.state.savedRecords.set(url, record);
      this.state.priceRecords.set(this.getProductKey(url), record);
    });
    return oldPrices;
  },

  // Záznamy cen produktů { url: záznam } (bez záznamu chybí) – jedno čtení klíčů po produktech, do mezipaměti
  async getPriceRecords(urls) {
    const byKey = await AlzaStore.getPriceRecords(this.getAlzaDomain(), urls);
    Object.entries(byKey).forEach(([key, record]) => this.state.priceRecords.set(key, record));
    return Object.fromEntries(urls.map((url) => [url, byKey[this.getProductKey(url)]]).filter(([, record]) => record));
  },

  async getPriceRecord(url) {
    return (await this.getPriceRecords([url]))[url] || null;
  },

  // Mezipaměť záznamů cen podle změn ve storage (kontrola na pozadí, jiná záložka) – obnova přepsaných cen
  // pak nemusí číst storage při každé změně stránky
  watchPriceRecords() {
    const prefix = `${AlzaCore.storagePrefixes.price}${this.getAlzaDomain()}_`;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      Object.entries(changes).forEach(([key, { newValue }]) => {
        if (!key.startsWith(prefix)) return;
        const productKey = key.slice(AlzaCore.storagePrefixes.price.length);
        if (newValue) this.state.priceRecords.set(productKey, newValue);
        else this.state.priceRecords.delete(productKey);
      });
    });
  },

  // Změna počtu kusů (a jiné překreslení Reactem) přepíše buňku s cenou součtem Alzy – naše ceny vrátit
  // z uloženého záznamu, bez nového stahování
  scheduleRestorePrices() {
    this.scheduleFrame("restorePrices", () => this.restoreOverwrittenPrices().catch((error) => console.error("Error restoring prices:", error)));
  },

  async restoreOverwrittenPrices() {
    // Změněný počet kusů u položek, jejichž ceny zůstaly: hned přepočítat součet (React mezitím vkládá vlastní
    // „cena / ks“ – ta je schovaná CSS, aby řádek neproblikl)
    document.querySelectorAll(this.selectors.listItem).forEach((item) => {
      const container = item.querySelector(this.selectors.priceContainer);
      const data = this.getItemData(item);
      if (!container || !data || !container.querySelector(".alza-price-tracker-price")) return;
      const quantity = String(parseInt(item.querySelector(this.selectors.quantityInput)?.value, 10) || 1);
      if (container.dataset.alzaPriceTrackerQuantity === quantity) return;
      this.showQuantityTotal(item, container, data.priceMap, data.quantityTiers);
      this.scheduleAvailabilityText();
    });

    const items = [...document.querySelectorAll(this.selectors.listItem)].filter((item) => {
      const container = item.querySelector(this.selectors.priceContainer);
      return container && !this.state.inFlightItems.has(item) && container.textContent.trim() !== "" && !container.querySelector(".alza-price-tracker-price");
    });
    // Jen z mezipaměti (state.priceRecords) – čtení storage při každé změně stránky bylo drahé. Položka bez
    // záznamu se tu nikdy nezobrazí (nepřihlášen, neprodává se…), zkouší ji jen načtení seznamu
    for (const item of items) {
      // Mezitím je mohlo vykreslit čerstvé načtení – to má přednost před uloženým záznamem
      if (item.querySelector(`${this.selectors.priceContainer} .alza-price-tracker-price`)) continue;
      const url = item.querySelector(this.selectors.productLink)?.href;
      const record = url && this.state.priceRecords.get(this.getProductKey(url));
      // URL s sebou – React mohl řádek během čekání použít pro jiný produkt
      if (record && AlzaCore.getPriceEntries(record).length > 0) await this.displayAllPrices(item, null, record, url);
    }
  },

  // Helper for creating a price display element
  createPriceDisplayElement(priceObj, hasMultiplePrices) {
    const formattedPrice = this.formatPrice(priceObj.price);
    const priceElement = document.createElement("span");

    // Použití CSS tříd místo inline stylů
    priceElement.classList.add("alza-price-tracker-price");
    priceElement.dataset.priceType = priceObj.type; // Podle typu se označí podezřelá cena (markSuspiciousPrices)

    // Přidat třídu pro original pouze pokud existuje více cen
    if (priceObj.type === "original" && hasMultiplePrices) {
      priceElement.classList.add(`alza-price-tracker-price-${priceObj.type}`);
    } else if (priceObj.type !== "original") {
      priceElement.classList.add(`alza-price-tracker-price-${priceObj.type}`);
    }

    const icon = priceObj.icon ? this.createIconElement(priceObj.icon) : null;
    if (icon) priceElement.appendChild(icon);

    const textNode = document.createTextNode(` ${formattedPrice}`);
    priceElement.appendChild(textNode);

    return priceElement;
  },

  // Vykreslení cen položky; Min/Max v tooltipu nejvyšší ceny. expectedUrl = produkt, pro který se ceny
  // stahovaly – React mezitím mohl řádek použít pro jiný produkt (přepnutí seznamu)
  async displayAllPrices(itemElement, prices, knownProductData = null, expectedUrl = null) {
    const priceContainer = itemElement.querySelector(this.selectors.priceContainer);
    if (!priceContainer) return;

    const productId = itemElement.querySelector(this.selectors.productLink)?.href;
    if (expectedUrl && productId !== expectedUrl) return;

    priceContainer.innerHTML = "";

    try {
      if (!productId) return;

      // Pokud záznam už máme v paměti, nečíst znovu storage
      const productData = knownProductData || this.state.priceRecords.get(this.getProductKey(productId)) || (await this.getPriceRecord(productId));

      if (!productData) return;

      // Use the prices parameter if provided (for fresh fetches), otherwise use stored prices
      const formattedPrices = prices && prices.length > 0 ? prices : AlzaCore.getPriceEntries(productData);

      // Check if there are multiple prices
      const hasMultiplePrices = formattedPrices.length > 1;

      // Render all prices (ascending), remember the last (highest) element
      let lastSpanEl = null;
      formattedPrices.forEach((priceObj, index) => {
        const isLast = index === formattedPrices.length - 1;
        const priceElement = this.createPriceDisplayElement(priceObj, hasMultiplePrices);
        priceContainer.appendChild(priceElement);

        // keep discount deltas on each price
        this.addTooltip(priceElement, priceObj.price, formattedPrices);

        if (isLast) lastSpanEl = priceElement;
      });

      // Choose the HIGHEST price element for Min/Max: prefer "original", else the last rendered span
      const originalEl = priceContainer.querySelector(".alza-price-tracker-price-original");
      const highestEl = originalEl || lastSpanEl;

      // Attach Min/Max only to the highest price so we don't overwrite discount tooltips on lower prices
      const min = productData.minPrice;
      const max = productData.maxPrice;

      if (highestEl && min && typeof min.value === "number" && max && typeof max.value === "number") {
        highestEl.title = this.formatMinMaxText(min, max, " / ");
      }

      // Cena za kus u každé ceny – Alza ji počítá jen z jedné z nich (bez AlzaPlus+ a slevových kódů)
      const packCount = this.getStoredPackCount(productData);
      if (packCount) {
        priceContainer.querySelectorAll(".alza-price-tracker-price").forEach((element, index) => {
          const unitText = this.translate("unitPriceTooltip", this.formatUnitPrice(formattedPrices[index].price / packCount), packCount);
          this.appendTitle(element, unitText);
        });
      }

      // Množstevní slevy v tooltipu nejnižší ceny – na detailu je Alza ukáže až po rozkliknutí
      const quantityTiers = AlzaCore.getQuantityTiers(productData);
      const lowestElement = priceContainer.querySelector(".alza-price-tracker-price");
      if (quantityTiers && lowestElement) {
        const tiersText = this.translate("quantityTiers", this.formatQuantityTiers(quantityTiers));
        this.appendTitle(lowestElement, tiersText);
      }

      // Stejný produkt v jiném stavu (rozbalený, zánovní) levněji
      // Proti nejnižší ceně, kterou zaplatíte (i s AlzaPlus+ a benefitem) – jinak by „levnější“ stav často nebyl levnější
      const ownLowest = AlzaCore.getPlausibleMinPrice(Object.fromEntries(formattedPrices.map(({ type, price }) => [type, price])));
      const cheaperConditions = AlzaCore.getCheaperConditions(productData.conditions, ownLowest);
      if (cheaperConditions.length > 0 && lowestElement) {
        const conditionsText = this.getCheaperConditionsText(cheaperConditions);
        this.appendTitle(lowestElement, conditionsText);
      }

      // Klik na kteroukoli cenu otevře historii (stejně jako klik na dostupnost)
      const productInfo = this.getProductInfo(itemElement);
      priceContainer.querySelectorAll(".alza-price-tracker-price").forEach((element) =>
        this.attachHistoryTrigger(element, productInfo, productData)
      );

      const priceMap = Object.fromEntries(formattedPrices.map(({ type, price }) => [type, price]));
      const { oldLowestPrice: oldLowest, newLowestPrice: newLowest } = productData;
      this.state.itemData.set(itemElement, {
        url: productId,
        priceMap,
        change: typeof oldLowest === "number" && typeof newLowest === "number" ? newLowest - oldLowest : 0,
        packCount,
        quantityTiers,
        cheaperConditions,
      });
      this.updateTargetMarker(itemElement);
      this.scheduleListToolbar();
      this.updatePriceInsights(itemElement, productId, priceMap).catch((error) =>
        console.error(`Error evaluating price history for ${productId}:`, error)
      );

      this.evaluatePriceChange(itemElement, oldLowest || null, newLowest || null);
      this.showQuantityTotal(itemElement, priceContainer, priceMap, quantityTiers);

      this.scheduleAvailabilityText();
    } catch (error) {
      console.error("Error displaying prices:", error);
    }
  },

  // Více kusů: ceny zůstávají za kus, vlevo od nich (v prázdném místě řádku, mimo tok – nic neposune) sloupec
  // „3 ks celkem / částka“ k zaplacení i s množstevní slevou. Nativní „cena / ks“ Alzy se schová (CSS)
  // Volá se i při změně počtu kusů (restoreOverwrittenPrices) – předchozí součet a jeho řádek v tooltipu nahradí
  showQuantityTotal(itemElement, priceContainer, priceMap, quantityTiers) {
    const quantity = parseInt(itemElement.querySelector(this.selectors.quantityInput)?.value, 10) || 1;
    priceContainer.dataset.alzaPriceTrackerQuantity = String(quantity);
    itemElement.classList.toggle("alza-price-tracker-multi", quantity > 1);
    priceContainer.querySelector(".alza-price-tracker-quantity-total")?.remove();
    const lowestElement = priceContainer.querySelector(".alza-price-tracker-price");
    const previousText = lowestElement?.dataset.alzaPriceTrackerTotalText;
    if (previousText) {
      lowestElement.title = lowestElement.title.split("\n").filter((line) => line !== previousText).join("\n");
      delete lowestElement.dataset.alzaPriceTrackerTotalText;
    }
    if (quantity <= 1) return;
    const lowest = AlzaCore.getLowestPrice(priceMap);
    const payNow = AlzaCore.getPayNowPrice(priceMap) ?? lowest;
    if (!(payNow > 0)) return;
    const unitPrice = AlzaCore.getQuantityUnitPrice(quantityTiers, payNow, quantity);
    const total = this.formatPrice(unitPrice * quantity);
    // Skrytý, dokud fitQuantityTotals nezměří, že se vejde (jinak by krátce problikl)
    const element = this.createEl("span", "alza-price-tracker-quantity-total alza-price-tracker-quantity-total--hidden");
    element.append(
      this.createEl("span", "alza-price-tracker-quantity-total-label", this.translate("quantityTotal", quantity)),
      this.createEl("span", "alza-price-tracker-quantity-total-value", total)
    );
    element.title = this.translate("quantityTotalHint", quantity, this.formatPrice(unitPrice), total);
    // Do ukazatelů vlevo od cen (mimo tok – nic neposune), jako první: šipky ▼ ▲ a ikona změny zůstanou těsně
    // u ceny a sloupec se součtem se s nimi nepřekrývá
    this.getPriceIndicators(priceContainer).prepend(element);
    // Součet i v tooltipu nejnižší ceny – kdyby se sloupec do řádku nevešel
    if (lowestElement) {
      const totalText = this.translate("quantityTotalTooltip", quantity, total);
      this.appendTitle(lowestElement, totalText);
      lowestElement.dataset.alzaPriceTrackerTotalText = totalText;
    }
    if (!this.state.quantityTotalResize) {
      this.state.quantityTotalResize = true;
      window.addEventListener("resize", () => this.scheduleAvailabilityText());
    }
  },

  // Sloupec se součtem se musí vejít mezi dostupnost (nebo tlačítko +) a ceny; jinak se schová (zůstane v tooltipu
  // nejnižší ceny a v souhrnu nad seznamem). Měří se po vykreslení, při změně dostupnosti a velikosti okna
  fitQuantityTotals() {
    document.querySelectorAll(".alza-price-tracker-quantity-total").forEach((element) => {
      const itemElement = element.closest(this.selectors.listItem);
      if (!itemElement) return;
      const neighbours = [this.selectors.availability, '[data-testid="button-increase"]']
        .map((selector) => itemElement.querySelector(selector))
        .filter(Boolean)
        .map((neighbour) => neighbour.getBoundingClientRect().right);
      const limit = neighbours.length > 0 ? Math.max(...neighbours) : -Infinity;
      element.classList.toggle("alza-price-tracker-quantity-total--hidden", element.getBoundingClientRect().left < limit + 12);
    });
  },

  formatDateTime(ts) {
    return new Date(ts).toLocaleString(this.state.locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  },

  formatMinMaxText(min, max, separator) {
    return (
      `Min: ${this.formatPrice(min.value)} (${this.formatDateTime(min.timestamp)})` +
      `${separator}Max: ${this.formatPrice(max.value)} (${this.formatDateTime(max.timestamp)})`
    );
  },

  // Ikona akce z Alzy (relativní adresa vůči stránce); jiná adresa (např. z importované zálohy) → null
  createIconElement(iconSrc) {
    let src;
    try {
      src = new URL(iconSrc, window.location.href).href;
    } catch {
      return null;
    }
    if (!AlzaCore.isAlzaAssetUrl(src)) return null;
    const icon = document.createElement("img");
    icon.src = src;
    icon.alt = this.translate("promoIcon");
    icon.classList.add("alza-price-tracker-price-icon");
    return icon;
  },

  evaluatePriceChange(itemElement, oldLowestPrice, newLowestPrice) {
    // Zvýraznění z předchozího vykreslení – šipka zmizela s obsahem kontejneru, pozadí řádku by zůstalo
    itemElement.classList.remove("alza-price-tracker-price-increased", "alza-price-tracker-price-decreased");

    // Pokud existuje newLowestPrice, znamená to že se cena změnila
    if (oldLowestPrice !== null && newLowestPrice !== null && oldLowestPrice !== newLowestPrice) {
      // Přidat vhodnou třídu podle změny ceny
      if (newLowestPrice > oldLowestPrice) {
        itemElement.classList.add("alza-price-tracker-price-increased");
        this.showPriceChangeIcon(itemElement, oldLowestPrice, newLowestPrice, false);
      } else if (newLowestPrice < oldLowestPrice) {
        itemElement.classList.add("alza-price-tracker-price-decreased");
        this.showPriceChangeIcon(itemElement, oldLowestPrice, newLowestPrice, true);
      }
      // NEMAZAT newLowestPrice zde - zůstane až do příštího fetch cyklu
    }
  },

  // Ikona změny ceny (šipka) s tooltipem původní ceny
  showPriceChangeIcon(itemElement, oldPrice, newPrice, isDecrease) {
    const productId = itemElement.querySelector(this.selectors.productLink)?.href;
    if (!productId) return;

    // Získat nebo vytvořit kontejner pro ikonu změny ceny
    let priceChangeContainer = itemElement.querySelector(".alza-price-tracker-price-change-icon");
    if (!priceChangeContainer) {
      const priceContainer = itemElement.querySelector(this.selectors.priceContainer);
      if (!priceContainer) return;

      priceChangeContainer = document.createElement("span");
      priceChangeContainer.className = "alza-price-tracker-price-change-icon";
      priceContainer.insertBefore(priceChangeContainer, priceContainer.firstChild);
    }

    // Vytvořit ikonu a tooltip s informací o změně
    const icon = document.createElement("span");
    icon.className = "alza-price-tracker-price-change-marker";
    // Vlastní SVG (dřív Font Awesome 4 ze stránky Alzy – bez něj by šipka zmizela); bez innerHTML kvůli kontrole AMO
    const arrow = this.createArrowIcon(isDecrease);
    arrow.classList.add(isDecrease ? "alza-price-tracker-price-change-icon-decreased" : "alza-price-tracker-price-change-icon-increased");
    icon.appendChild(arrow);

    icon.title = this.getPriceChangeText(oldPrice, newPrice);

    // Vymazat existující ikonu a přidat novou
    priceChangeContainer.innerHTML = "";
    priceChangeContainer.appendChild(icon);
  },

  // Šipka v kroužku (dolů = zlevnění) v barvě textu (currentColor)
  createArrowIcon(down) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "alza-price-tracker-arrow");
    const circle = document.createElementNS(NS, "circle");
    Object.entries({ cx: 8, cy: 8, r: 8, fill: "currentColor" }).forEach(([name, value]) => circle.setAttribute(name, value));
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", down ? "M8 12.5 3.5 8h3V3.5h3V8h3z" : "M8 3.5 12.5 8h-3v4.5h-3V8h-3z");
    path.setAttribute("fill", "#fff");
    svg.append(circle, path);
    return svg;
  },

  // "Sníženo/Zvýšeno z: 62 484 Kč (-2 506 Kč / -4 %)"
  getPriceChangeText(oldPrice, newPrice) {
    const difference = this.formatPrice(Math.abs(newPrice - oldPrice));
    // Pod 1 % s desetinným místem jako v notifikacích ("-0,3 %" místo "-0 %")
    const percentChange = AlzaCore.formatPercent(Math.abs(((newPrice - oldPrice) / oldPrice) * 100), this.getAlzaDomain());
    return this.translate(newPrice < oldPrice ? "decreasedBy" : "increasedBy", this.formatPrice(oldPrice), difference, percentChange);
  },

  // Změny cen se dříve ukládaly i do `<storageKey>_changes`, ale nic je nečetlo
  // (šipky se počítají z oldLowestPrice/newLowestPrice). Starý klíč jen uklidíme – stejně jako
  // alzaProductInfo (názvy produktů krátce mimo historii, teď jsou v historii cen)
  async removeLegacyPriceChanges() {
    const legacyKeys = [`${AlzaCore.storagePrefixes.legacyPrices}${this.getAlzaDomain()}_changes`, "alzaProductInfo"];
    const data = await this.getStorageData(legacyKeys);
    const present = legacyKeys.filter((key) => data[key]);
    if (present.length > 0) await AlzaStore.run({ type: "remove", keys: present });
  },

  // Rozdíl proti další vyšší ceně: "-150 Kč (-5 %)"
  getDiscountText(nextPrice, currentPrice) {
    const discountAmount = nextPrice - currentPrice;
    const discountPercent = AlzaCore.formatPercent((discountAmount / nextPrice) * 100, this.getAlzaDomain());
    return `-${this.formatPrice(discountAmount)} (-${discountPercent} %)`;
  },

  addTooltip(priceElement, currentPrice, allPrices) {
    if (!allPrices || allPrices.length < 2) return;

    // Rozdíl proti dvěma nejbližším VYŠŠÍM cenám – dvě stejné ceny (AlzaPlus+ = kód) by daly „-0 Kč (-0 %)“
    const higherPrices = [...new Set(allPrices.map((p) => p.price))].filter((price) => price > currentPrice).sort((a, b) => a - b);
    const tooltipText = higherPrices
      .slice(0, 2)
      .map((price) => this.getDiscountText(price, currentPrice))
      .join(" / ");

    if (tooltipText) {
      priceElement.title = tooltipText;
    }
  },

  // Opakovaná volání během jednoho snímku (změny DOM, každá zobrazená položka) sloučí do jednoho průchodu
  scheduleFrame(key, task) {
    if (this.state.scheduledFrames.has(key)) return;
    this.state.scheduledFrames.add(key);
    requestAnimationFrame(() => {
      this.state.scheduledFrames.delete(key);
      task();
    });
  },

  scheduleAvailabilityText() {
    this.scheduleFrame("availability", () => this.processAvailabilityText());
  },

  // Dlouhý text dostupnosti ("Na objednávku – u dodavatele…") zkrátit, celý v tooltipu. Text stránky se
  // porovnává v jazyce domény, zkrácený se ukáže v jazyce zobrazení (volba v nastavení)
  processAvailabilityText() {
    const pageText = (key) => AlzaCore.translate(this.state.language || "cz", key);
    const rules = [
      { matches: (text) => text.startsWith(pageText("onOrder")), label: this.translate("onOrder") },
      { matches: (text) => text.startsWith(pageText("expected")), label: this.translate("expected") },
      { matches: (text) => text === pageText("currentlyUnavailable"), label: this.translate("notAvailable") },
    ];

    document.querySelectorAll(this.selectors.availability).forEach((element) => {
      if (element.classList.contains("alza-price-tracker-dotted-underline")) return; // už zpracovaný
      const originalText = element.textContent.trim();
      const rule = rules.find(({ matches }) => matches(originalText));
      if (!rule) return;
      element.setAttribute("title", originalText);
      element.textContent = rule.label;
      element.classList.add("alza-price-tracker-dotted-underline");
    });

    // Klik na dostupnost otevře historii – i u produktů bez ceny (prodej skončil, nedostupné…)
    document.querySelectorAll(this.selectors.availability).forEach((element) => {
      if (element.classList.contains("alza-price-tracker-history-trigger")) return;
      const itemElement = element.closest(this.selectors.listItem);
      const product = itemElement && this.getProductInfo(itemElement);
      if (product) this.attachHistoryTrigger(element, product, null);
    });

    this.fitQuantityTotals();
  },

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "getWatchState") {
        this.getWatchState().then(sendResponse, () => sendResponse(null));
        return true;
      } else if (message.action === "setWatch") {
        this.setListWatched(message.enabled).then(sendResponse, () => sendResponse(null));
        return true;
      }
    });
  },

  logExtensionInfo() {
    const manifest = chrome.runtime.getManifest();
    console.log(`${manifest.name} - Version: %c${manifest.version}`, "font-weight: 700");
  },
};
