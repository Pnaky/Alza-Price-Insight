// Content script (část AlzaPriceTracker): Detail produktu: panel pod cenou (historie, shrnutí, hlídání na pozadí).
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Detail produktu ===
  // Panel pod cenou: historie cen (dialog i s cílovou cenou), shrnutí a hlídání na pozadí. Cenový box je
  // klasické HTML (ne React) – panel se vkládá mezi box s cenou a řádek "Hlídat cenu / Přidat do seznamu".
  // Návštěva detailu se zapíše do historie, když se produkt už sleduje, nebo je zapnuté ukládání cen
  // z procházení (pak se produkt přidá i do přehledu procházených – browsing.js).

  getProductPageInfo() {
    const id = AlzaCore.getProductId(window.location.pathname + window.location.search);
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    const useCanonical = canonical && AlzaCore.isAlzaUrl(canonical) && AlzaCore.getProductId(canonical) === id;
    return {
      url: useCanonical ? canonical : `${window.location.origin}${window.location.pathname}${AlzaCore.getProductId(window.location.pathname) ? "" : `?dq=${id}`}`,
      name: AlzaCore.getProductName(document) || document.title,
      image: document.querySelector('meta[property="og:image"]')?.content || null,
    };
  },

  async setupProductPage() {
    const product = this.getProductPageInfo();
    this.state.product = product;

    // Záznam ceny (uložené min/max) – klíčem je číslo produktu, adresa ze seznamu může být jiná
    this.state.productData = await this.getPriceRecord(product.url);

    await this.recordProductPageVisit(false).catch((error) => console.error("Error recording product page:", error));
    await this.renderProductPanel().catch((error) => console.error("Error rendering product panel:", error));
    this.setupVariantUnitPrices();
    this.setupQuantityTiers();
    this.setupCashbackTerms();

    const keys = [
      AlzaCore.storageKeys.watchProducts,
      AlzaCore.storageKeys.watchLists,
      AlzaCore.storageKeys.targets,
      this.getHistoryKey(product.url),
    ];
    // Moje nákupy: záznam o koupi tohoto produktu – po načtení objednávek nebo přepnutí volby znovu
    const ownedKeys = [AlzaCore.storageKeys.owned, AlzaCore.storageKeys.settings];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (ownedKeys.some((key) => changes[key])) {
        this.loadOwnedProduct()
          .then(() => this.scheduleProductPanel())
          .catch((error) => console.error("Error loading owned product:", error));
      } else if (keys.some((key) => changes[key])) this.scheduleProductPanel();
    });
    await this.loadOwnedProduct().catch((error) => console.error("Error loading owned product:", error));
    if (this.state.ownedProduct) this.scheduleProductPanel();
    this.setupWarranty().catch((error) => console.error("Error saving warranty:", error));
  },

  // Moje nákupy: záruka z detailu produktu (AlzaCore.getDocumentWarranty) k záznamu ceny a ke koupeným kusům –
  // konec záruky se pak nepočítá z pevných 24 měsíců. Firemnímu účtu ji Alza dokreslí až po načtení stránky
  // („Pro firemní nákupy: Záruka 24 měsíců“), proto pár pokusů
  async setupWarranty() {
    if (!(await AlzaCore.getSettings()).ownedItems) return;
    for (const delay of [0, 2000, 4000, 8000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (!AlzaCore.isContextAlive()) return;
      const warranty = AlzaCore.getDocumentWarranty(document);
      if (!warranty) continue;
      await AlzaStore.run({ type: "setWarranty", domain: this.getAlzaDomain(), url: this.state.product.url, warranty });
      return;
    }
  },

  // Nákupy tohoto produktu z přehledu Moje nákupy (jen se zapnutou volbou ownedItems); null = nekoupeno / vypnuto
  async loadOwnedProduct() {
    const key = AlzaCore.storageKeys.owned;
    const settings = await AlzaCore.getSettings();
    const owned = settings.ownedItems ? (await chrome.storage.local.get(key))[key] : null;
    const productKey = this.getProductKey(this.state.product.url);
    const product = owned && typeof owned === "object" && Object.hasOwn(owned, productKey) ? owned[productKey] : null;
    this.state.ownedProduct = product && Array.isArray(product.buys) ? product : null;
  },

  // „Provoz 10 let: 8 400 Kč · s pořizovací cenou 16 790 Kč“ (volba energyCost) – výpočet v bublině; null = stránka
  // spotřebu neuvádí nebo je volba vypnutá. price = cena k zaplacení (null = produkt se neprodává)
  async createEnergyNote(price) {
    const energy = AlzaCore.getDocumentEnergy(document);
    if (!energy) return null;
    const domainKey = this.getAlzaDomain();
    const settings = AlzaCore.getEnergySettings(await AlzaCore.getSettings(), domainKey);
    if (!settings.enabled) return null;
    const { yearlyKwh, yearly, cost } = AlzaCore.getEnergyCost(energy, settings);
    const { locale, currency } = AlzaCore.domains[domainKey];
    const number = (value, digits = 0) => value.toLocaleString(locale, { maximumFractionDigits: digits });
    const plural = settings.years === 1 ? "One" : settings.years <= 4 ? "Few" : "Many";
    const parts = [this.translate(`productEnergy${plural}`, settings.years, this.formatPrice(cost))];
    if (price > 0) parts.push(this.translate("productEnergyTotal", this.formatPrice(price + cost)));
    const usage = {
      year: () => this.translate("productEnergyUseYear", number(energy.kwh, 1)),
      cycles: () => this.translate("productEnergyUseCycles", number(energy.kwh, 1), settings.cyclesPerWeek, number(yearlyKwh)),
      hours: () => this.translate("productEnergyUseHours", number(energy.kwh, 1), number(settings.hoursPerDay, 1), number(yearlyKwh)),
    }[energy.per]();
    const note = this.createEl("div", "alza-price-tracker-product-note", parts.join(" · "));
    note.title = `${usage} × ${number(settings.price, 2)} ${currency}/kWh × ${settings.years} = ${this.formatPrice(cost)}\n${this.translate("productEnergyHint", this.formatPrice(yearly))}`;
    return AlzaIcons.prepend(note, "bolt");
  },

  // „Koupili jste 12. 3. 2025 za 5 990 Kč · celkem 3× · záruka asi do 12. 3. 2027 · Objednávka“ – poslední nevrácený
  // nákup; null = produkt koupený není
  createOwnedNote() {
    const buys = (this.state.ownedProduct?.buys || []).filter((buy) => Number.isFinite(buy?.t) && !buy.ret);
    const last = buys.at(-1);
    if (!last) return null;
    const lang = this.state.uiLanguage || this.state.language || "cz";
    const date = (time) => AlzaCore.formatTextDate(time, lang, true);
    const parts = [last.p > 0 ? this.translate("productOwnedPrice", date(last.t), this.formatPrice(last.p)) : this.translate("productOwned", date(last.t))];
    if (buys.length > 1) parts.push(this.translate("productOwnedTimes", buys.length));
    const warranty = AlzaCore.getWarrantyState(last);
    if (warranty.state === "active" || warranty.state === "ending") parts.push(this.translate("productOwnedWarranty", date(warranty.until)));
    if (warranty.state === "extended") parts.push(this.translate("productOwnedClaimable"));
    const note = this.createEl("div", "alza-price-tracker-product-note", `${parts.join(" · ")} · `);
    const orderUrl = AlzaCore.getOrderUrl(this.getAlzaDomain(), last.o);
    if (orderUrl) {
      const link = this.createEl("a", "alza-price-tracker-product-order", this.translate("productOwnedOrder"));
      Object.assign(link, { href: orderUrl, target: "_blank", rel: "noopener" });
      note.appendChild(link);
    } else note.textContent = parts.join(" · ");
    return AlzaIcons.prepend(note, "bag");
  },

  // Cashback: pod Alzin řádek „Cena s CashBack“ (do jeho rámečku) termíny akce – konec nákupu a lhůta registrace
  // u výrobce. Název řádku už na stránku akce odkazuje, odkaz se neopakuje
  setupCashbackTerms() {
    const row = document.querySelector('.promo-action-prices__row[data-type="cashback"]');
    if (!row || row.querySelector(".alza-price-tracker-cashback-detail")) return;
    const promo = AlzaCore.getCashbackPromo(row);
    const url = AlzaCore.resolveCashbackTerms(promo.terms, this.getAlzaDomain());
    if (!url) return;
    this.requestCashbackTerms(url, promo.title).then((terms) => {
      const lines = this.getCashbackTermsLines(terms);
      if (lines.length === 0 || !row.isConnected || row.querySelector(".alza-price-tracker-cashback-detail")) return;
      const line = this.createEl("div", "alza-price-tracker-cashback-detail");
      lines.forEach(({ text, warn }, index) => {
        if (index > 0) line.append(" · ");
        line.appendChild(this.createEl("span", warn ? "alza-price-tracker-cashback-terms-line--warn" : null, text));
      });
      // Zarovnat pod název akce (za ikonou)
      const name = row.querySelector(".promo-action-prices__name");
      if (name) line.style.paddingLeft = `${Math.max(0, name.getBoundingClientRect().left - row.getBoundingClientRect().left - parseFloat(getComputedStyle(row).paddingLeft || 0))}px`;
      row.setAttribute("data-alza-price-tracker-cashback", "");
      row.appendChild(line);
    });
  },

  // Množstevní slevy: Alza tabulku stupňů ukáže až se zbožím v košíku – bublina nad tlačítkem košíku. Bez zboží
  // v košíku stejná bublina od nás, 1:1 (místo, rozměry, texty z Alziny skryté tabulky .quantityRepeater), ať se nic
  // neposune; banner „Kup víc, zaplať míň“ zůstává pod ní. Když Alza ukáže svou, naše zmizí
  setupQuantityTiers() {
    const selectors = this.quantityTiersSelectors;
    const rows = [...document.querySelectorAll(selectors.alzaRows)]
      .map((row) => ({
        label: row.querySelector(".colLabel")?.textContent.replace(/\s+/g, " ").trim(),
        value: row.querySelector(".colValue")?.textContent.replace(/\s+/g, " ").trim(),
        current: row.classList.contains("sel"),
      }))
      .filter(({ label, value }) => label && value);
    if (rows.length < 2 || !document.querySelector(selectors.anchor)) return;
    const saving = document.querySelector(selectors.alzaSaving)?.textContent.replace(/\s+/g, " ").trim() || null;

    let bubble = null;
    const build = () => {
      const box = this.createEl("div", "alza-price-tracker-tiers-bubble");
      box.setAttribute("role", "tooltip");
      rows.forEach(({ label, value, current }) => {
        const row = this.createEl("div", `alza-price-tracker-tiers-bubble-row${current ? " alza-price-tracker-tiers-bubble-row--current" : ""}`);
        row.append(this.createEl("span", null, label), this.createEl("span", null, value));
        box.appendChild(row);
      });
      if (saving) {
        const row = this.createEl("div", "alza-price-tracker-tiers-bubble-row alza-price-tracker-tiers-bubble-row--saving");
        row.append(this.createEl("span", null, this.translate("quantityTierTotalSaving")), this.createEl("span", null, saving));
        box.appendChild(row);
      }
      box.appendChild(this.createEl("span", "alza-price-tracker-tiers-bubble-arrow"));
      return box;
    };
    const sync = () => {
      const anchor = document.querySelector(selectors.anchor);
      const alzaShows = [...document.querySelectorAll(selectors.alzaPopup)].some((popup) => popup.getBoundingClientRect().width > 0);
      const banner = document.querySelector(selectors.banner);
      if (!anchor || alzaShows) {
        bubble?.remove();
        bubble = null;
        banner?.removeAttribute(this.quantityTiersAttribute);
        return;
      }
      // Text banneru pod bublinou jako u Alzy schovaný (místo zůstane – nic se neposune), ikona „Kup víc“ zůstává
      if (banner && !banner.hasAttribute(this.quantityTiersAttribute)) banner.setAttribute(this.quantityTiersAttribute, "");
      // V bloku ceny (posouvá se s ním, i když se stránka nad ním dočte), nad tlačítkem košíku, stejně široká
      const scope = document.querySelector(selectors.scope);
      if (!scope) return;
      if (getComputedStyle(scope).position === "static" && !scope.hasAttribute(this.quantityTiersScopeAttribute)) scope.setAttribute(this.quantityTiersScopeAttribute, "");
      if (!bubble) bubble = build();
      if (bubble.parentElement !== scope) scope.appendChild(bubble);
      const rect = anchor.getBoundingClientRect();
      const base = scope.getBoundingClientRect();
      const left = `${Math.round(rect.left - base.left) + this.quantityTiersOffsetX}px`;
      const width = `${Math.round(rect.width)}px`;
      const top = `${Math.round(rect.top - base.top - this.quantityTiersGap - bubble.offsetHeight)}px`;
      if (bubble.style.left !== left) bubble.style.left = left;
      if (bubble.style.width !== width) bubble.style.width = width;
      if (bubble.style.top !== top) bubble.style.top = top;
    };
    sync();
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };
    // Bublina Alzy se objeví v React části (tlačítka košíku); poloha se mění se šířkou okna
    new MutationObserver(schedule).observe(document.querySelector(selectors.scope) || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    window.addEventListener("resize", schedule, { passive: true });
  },

  quantityTiersSelectors: {
    scope: ".price-detail", // Cena, banner i tlačítka košíku
    anchor: ".price-detail__buy-actions .buy-button-placeholder", // Tlačítko košíku – bublina nad ním
    alzaRows: ".quantityRepeater .row[data-cntfrom]", // Alzina skrytá tabulka: „1 balení | 89,-/balení“
    alzaSaving: ".quantityRepeater .discountAmount",
    banner: ".quantityDiscountPromoCont", // „Kup víc, zaplať míň – Množstevní slevy – Sleva už od 2 balení“
    alzaPopup: ".price-detail__buy-actions .MuiTooltip-popper", // Alzina bublina se zbožím v košíku
  },
  quantityTiersAttribute: "data-alza-price-tracker-tiers", // Banner pod naší bublinou (main.css)
  quantityTiersScopeAttribute: "data-alza-price-tracker-tiers-scope", // Blok ceny jako základ polohy bubliny (main.css)
  quantityTiersGap: 14, // Mezera pro šipku mezi bublinou a tlačítkem (jako u Alzy)
  quantityTiersOffsetX: 1, // Alzina bublina je o 1 px vpravo od tlačítka

  scheduleProductPanel() {
    clearTimeout(this.state.productPanelTimeout);
    this.state.productPanelTimeout = setTimeout(
      () => this.renderProductPanel().catch((error) => console.error("Error rendering product panel:", error)),
      50
    );
  },

  // Hlídá se produkt? watched = interní seznam "Hlídané produkty", lists = názvy hlídaných seznamů s produktem
  async getProductWatchInfo() {
    const { watchProducts, watchLists } = AlzaCore.storageKeys;
    const data = await this.getStorageData([watchProducts, watchLists]);
    const { url } = this.state.product;
    const id = AlzaCore.getProductId(url);
    const domain = this.getAlzaDomain();
    return {
      watched: Boolean(data[watchProducts]?.[this.getProductKey(url)]),
      lists: Object.values(data[watchLists] || {})
        .filter((list) => list.domain === domain && Object.keys(list.products || {}).some((productUrl) => AlzaCore.getProductId(productUrl) === id))
        .map((list) => list.name),
    };
  },

  getProductPagePrices() {
    return AlzaCore.extractPricesFromDocument(document);
  },

  // force = právě zapnuté hlídání (první záznam historie)
  async recordProductPageVisit(force) {
    const { url } = this.state.product;
    if (!force) {
      const [entries, watch] = await Promise.all([this.getPriceHistory(url), this.getProductWatchInfo()]);
      const tracked = entries.length > 0 || watch.watched || watch.lists.length > 0 || this.state.targets[this.getProductKey(url)];
      if (!tracked && !this.state.saveBrowsing) return;
    }
    if (this.state.saveBrowsing && typeof AlzaBrowsing !== "undefined") AlzaBrowsing.rememberProduct(this.state.product);

    const prices = this.getProductPagePrices();
    // Nepřihlášen / ceny bez DPH – nic neukládat; důvod ukáže karta místo „Zatím bez historie“
    const problem = await AlzaCore.resolveSaveProblem(AlzaCore.getSaveProblem(document, prices), AlzaCore.isVatSignMissing(document), prices, this.getAlzaDomain(), url);
    if (problem !== this.state.productSaveProblem) {
      this.state.productSaveProblem = problem;
      this.scheduleProductPanel?.();
    }
    if (problem) return;
    const availability = this.classifyAvailability(AlzaCore.extractAvailabilityFromDocument(document));
    if (AlzaCore.getPriceEntries(prices).length === 0 && availability === null) return;

    // Bez názvu – nadpis živé stránky se může lišit od staženého HTML (seznam, služba na pozadí)
    // a název by se v historii střídal; název dodá seznam a kontrola na pozadí
    await this.recordPriceHistory(url, prices, availability, this.state.productData);
  },

  // Důvod, proč se ceny neukládají – text kontroly na pozadí bez dovětku „kontrola přerušena“ (na detailu nic neběží).
  // Text je ve slovníku jádra (AlzaCore.texts), jazyk rozhraní jako ostatní texty karty
  getSaveProblemNote(key) {
    return AlzaCore.translate(this.state.uiLanguage || this.state.language || "cz", key).replace(/,\s*(kontrola přerušena|kontrola prerušená|ellenőrzés megszakítva|check stopped)$/, "");
  },

  async setProductWatched(enabled) {
    const { url, name, image } = this.state.product;
    const key = this.getProductKey(url);
    await AlzaStore.run({
      type: "patchMap",
      key: AlzaCore.storageKeys.watchProducts,
      ...(enabled ? { set: { [key]: { url, domain: this.getAlzaDomain(), name, image, since: Date.now() } }, keep: ["since"] } : { remove: [key] }),
    });
    if (enabled) await this.recordProductPageVisit(true);
  },

  // Karta v levém sloupci pod fotkami (je tam volné místo a je víc vidět než pod cenou):
  // záhlaví s hlídáním, dlaždice, malý graf nejnižší ceny, upozornění a tlačítka do dialogu historie
  async renderProductPanel() {
    const product = this.state.product;
    const productData = this.state.productData;
    const [entries, watch] = await Promise.all([this.getDisplayHistory(product.url), this.getProductWatchInfo()]);
    const format = (price) => this.formatPrice(price);
    const openDialog = (focusTarget) => this.openHistoryDialog(product, productData, { focusTarget });

    // Aktuální ceny ze stránky – čerstvější než poslední záznam historie
    const priceMap = AlzaCore.toPriceMap(this.getProductPagePrices());
    const lowestNow = AlzaCore.getLowestPrice(priceMap);
    // Hodnocení ceny bez nesmyslně nízké ceny; ta se ukáže jako aktuální, ale s výstrahou
    const plausibleNow = AlzaCore.getPlausibleMinPrice(priceMap);
    const suspicious = AlzaCore.getSuspiciousPrices(entries, priceMap);
    const hasHistory = entries.some((entry) => Object.keys(entry.p).length > 0);
    const target = this.state.targets[this.getProductKey(product.url)];

    const card = this.createEl("div", "alza-price-tracker-product");

    const head = this.createEl("div", "alza-price-tracker-product-head");
    // Štítek na hraně karty stejný jako u lišt („Price Insight“), co karta ukazuje říká bublina
    const title = this.createEl("span", "alza-price-tracker-product-title", "Price Insight");
    title.title = this.translate("productHistory");
    head.appendChild(title);
    const watchButton = this.createEl("button", "alza-price-tracker-product-button alza-price-tracker-product-watch");
    watchButton.type = "button";
    if (watch.lists.length > 0) {
      watchButton.textContent = this.translate("productWatchedInList", watch.lists.join(", "));
      AlzaIcons.prepend(watchButton, "bell");
      watchButton.disabled = true;
    } else {
      watchButton.textContent = this.translate(watch.watched ? "productUnwatch" : "productWatch");
      AlzaIcons.prepend(watchButton, watch.watched ? "bell-off" : "bell");
      watchButton.title = this.translate("productWatchHint");
      watchButton.addEventListener("click", () => {
        watchButton.disabled = true;
        // Při chybě tlačítko znovu povolit (panel se jinak překreslí po změně ve storage)
        this.setProductWatched(!watch.watched).catch((error) => {
          console.error("Error toggling product watch:", error);
          watchButton.disabled = false;
        });
      });
    }
    head.append(this.createComparatorLinks(product.name), watchButton);
    card.appendChild(head);

    const stats = this.createEl("div", "alza-price-tracker-product-stats");
    const addStat = (label, value, sub, color, subColor) => this.appendStat(stats, "product", label, value, sub, color, subColor);
    const verdict = hasHistory ? AlzaCore.getPriceVerdict(entries, plausibleNow) : null;
    if (lowestNow !== null) {
      // Pod aktuální cenou hodnocení vůči obvyklé ceně (zeleně / červeně); podezřelá cena oranžově s ikonou výstrahy
      // Hodnocení se týká věrohodné ceny – pod nesmyslně nízkou by mátlo (zůstává v dlaždici Obvyklá cena)
      const lowestSuspicious = suspicious.find(({ price }) => price === lowestNow);
      const verdictText = verdict && lowestSuspicious?.reason !== "gap" && this.getVerdictText(verdict, plausibleNow);
      const stat = addStat(
        this.translate("productCurrent"),
        format(lowestNow),
        verdictText?.label,
        lowestSuspicious ? this.config.historyMilestoneColors.target : null,
        verdictText?.color
      );
      if (lowestSuspicious) AlzaIcons.prepend(stat.querySelector(".alza-price-tracker-product-stat-value"), "warning", { tone: true });
      if (verdictText) stat.title = verdictText.hint;
      if (lowestSuspicious) stat.title = [this.getSuspiciousText(lowestSuspicious), stat.title].filter(Boolean).join("\n");
    }

    // Skutečná cena za kus i bez historie – Alza ji na stránce počítá jen z ceny pro všechny
    const packCount = this.getProductPackCount(product, productData);
    if (packCount && lowestNow !== null) {
      const unit = (price) => `${this.formatUnitPrice(price / packCount)}/${this.translate("pieceUnit")}`;
      const stat = addStat(this.translate("statUnit"), unit(lowestNow), this.translate("statUnitSub", packCount));
      const perType = AlzaCore.getPriceEntries(priceMap).map(({ type, price }) => `${this.translate(`type_${type}`)}: ${unit(price)}`);
      stat.title = [this.translate("statUnitHint"), ...(perType.length > 1 ? ["", ...perType] : [])].join("\n");
    }

    if (hasHistory) {
      const warning = AlzaCore.getDiscountWarning(entries, priceMap);
      const strikethrough = AlzaCore.getStrikethroughWarning(entries, priceMap);
      const lowest30 = AlzaCore.getLowestInWindow(entries);
      const min = this.getHistoricExtreme(entries, productData?.minPrice, "min");
      if (verdict) addStat(this.translate("statTypical"), format(verdict.typical)).title = this.getVerdictText(verdict, plausibleNow).hint;
      if (lowest30) addStat(this.translate("statLowest30"), format(lowest30.value), this.formatDate(lowest30.at), warning ? this.config.historyMilestoneColors.target : null);
      if (min) addStat(this.translate("statMin"), format(min.value), this.formatDate(min.timestamp), this.config.historyMilestoneColors.min);
      card.appendChild(stats);

      const chart = this.createProductSparkline(entries, min, target);
      chart.title = this.translate("historyHint");
      chart.addEventListener("click", () => openDialog(false));
      card.appendChild(chart);

      if (warning) {
        const { label, hint } = this.getDiscountWarningText(warning);
        const note = this.createEl("div", "alza-price-tracker-product-note alza-price-tracker-product-note--warning", label);
        note.title = hint;
        card.appendChild(AlzaIcons.prepend(note, "warning", { tone: true }));
      }
      if (strikethrough) {
        const note = this.createEl("div", "alza-price-tracker-product-note alza-price-tracker-product-note--warning", this.getStrikethroughText(strikethrough));
        card.appendChild(AlzaIcons.prepend(note, "warning", { tone: true }));
      }
      const saleCycle = AlzaCore.getSaleCycle(entries, plausibleNow);
      if (saleCycle && verdict) {
        const { summary, advice } = this.getSaleCycleText(saleCycle, verdict.days);
        const note = this.createEl("div", "alza-price-tracker-product-note", advice ? `${summary}. ${advice}` : summary);
        if (saleCycle.wait) note.classList.add("alza-price-tracker-product-note--wait");
        card.appendChild(note);
      }
    } else {
      // Bez historie jen aktuální cena a cena za kus – samotná aktuální cena by jen opakovala stránku
      if (packCount && lowestNow !== null) card.appendChild(stats);
      card.appendChild(this.createEl("div", "alza-price-tracker-product-note", this.getNoPriceNote(entries) || (this.state.productSaveProblem ? this.getSaveProblemNote(this.state.productSaveProblem) : this.translate("productNoHistory"))));
    }

    // Podezřelá cena i bez historie (pod polovinou další ceny se pozná z jediného načtení)
    suspicious.forEach((item) => {
      const note = this.createEl("div", "alza-price-tracker-product-note alza-price-tracker-product-note--warning", this.getSuspiciousText(item));
      card.appendChild(AlzaIcons.prepend(note, "warning", { tone: true }));
    });

    // Stejný produkt levněji rozbalený / zánovní (přepínač stavu na stránce)
    const cheaperConditions = AlzaCore.getCheaperConditions(AlzaCore.getDocumentConditions(document, window.location.href), plausibleNow);
    if (cheaperConditions.length > 0) {
      card.appendChild(this.createEl("div", "alza-price-tracker-product-note", this.getCheaperConditionsText(cheaperConditions)));
    }

    // Cena provozu (lednice, pračky, sušičky, televize, monitory): spotřeba ze stránky × cena elektřiny z nastavení
    const energyNote = await this.createEnergyNote(AlzaCore.getPayNowPrice(priceMap));
    if (energyNote) card.appendChild(energyNote);

    // Moje nákupy: tento produkt už máte – kdy a za kolik, záruka, odkaz na objednávku
    const ownedNote = this.createOwnedNote();
    if (ownedNote) card.appendChild(ownedNote);


    if (target) {
      const status = this.getTargetStatus(target, lowestNow);
      const note = this.createEl("div", "alza-price-tracker-product-note", this.translate("productTarget", this.formatTargetValue(target.price, target), status));
      if (lowestNow !== null && lowestNow <= target.price) note.classList.add("alza-price-tracker-product-note--reached");
      card.appendChild(AlzaIcons.prepend(note, "target", { tone: true }));
    }

    const foot = this.createEl("div", "alza-price-tracker-product-foot");
    const historyButton = this.createEl("button", "alza-price-tracker-product-button", this.translate("productShowHistory"));
    historyButton.type = "button";
    historyButton.addEventListener("click", () => openDialog(false));
    const targetButton = this.createEl("button", "alza-price-tracker-product-button", this.translate(target ? "targetLabel" : "productSetTarget"));
    AlzaIcons.prepend(targetButton, "target");
    targetButton.type = "button";
    targetButton.addEventListener("click", () => openDialog(true));
    // Kopírovat nabídku – text pro chat / sociální sítě (název, ceny, kód, obvyklá cena, odkaz)
    const offerButton = this.createEl("button", "alza-price-tracker-product-button", this.translate("offerCopy"));
    offerButton.type = "button";
    offerButton.addEventListener("click", async () => {
      const verdictNow = hasHistory ? AlzaCore.getPriceVerdict(entries, plausibleNow) : null;
      const lowest30Now = hasHistory ? AlzaCore.getLowestInWindow(entries) : null;
      const copied = await this.copyText(this.buildOfferText(product, this.getProductPagePrices(), verdictNow, lowest30Now));
      offerButton.textContent = this.translate(copied ? "offerCopied" : "codeCopyFailed");
      setTimeout(() => (offerButton.textContent = this.translate("offerCopy")), 1800);
    });
    foot.append(historyButton, targetButton, offerButton);
    card.appendChild(foot);

    const existing = document.querySelector(".alza-price-tracker-product");
    if (existing) {
      existing.replaceWith(card);
      return;
    }
    // Levý sloupec je klasické HTML: galerie, promo doručení a dárky – karta na konec pod ně (do galerie
    // ani do React komponent se nevkládá); jiné rozvržení → pod cenu, jinak plovoucí
    const leftColumn = document.querySelector("#detailItem > .left-cnt");
    const priceDetail = document.querySelector(".price-detail");
    if (leftColumn) {
      leftColumn.appendChild(card);
    } else if (priceDetail) {
      priceDetail.after(card);
    } else {
      card.classList.add("alza-price-tracker-product--floating");
      document.body.appendChild(card);
    }
  },

  // Ikony srovnávačů v záhlaví karty – vyhledání produktu podle názvu v nové záložce
  createComparatorLinks(productName) {
    const wrap = this.createEl("span", "alza-price-tracker-product-compare");
    AlzaCore.getComparatorLinks(this.getAlzaDomain(), productName).forEach(({ id, name, url, icon }) => {
      const link = this.createEl("a", `alza-price-tracker-product-compare-link alza-price-tracker-product-compare-link--${id}`);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = this.translate("compareOn", name);
      // Favicona živě ze srovnávače (do rozšíření se nebalí – práva k logům); když se nenačte, zůstane název
      const label = this.createEl("span", "alza-price-tracker-product-compare-label", name);
      // Výsledek načtení si panel pamatuje – při překreslení (změna ve storage) by ikona jinak problikla textem
      const loaded = (this.state.comparatorIcons ||= {});
      link.appendChild(label);
      if (loaded[icon] !== false) {
        const img = document.createElement("img");
        img.className = "alza-price-tracker-product-compare-icon";
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        const showIcon = () => link.classList.add("alza-price-tracker-product-compare-link--icon");
        if (loaded[icon]) showIcon();
        img.addEventListener("load", () => ((loaded[icon] = true), showIcon()), { once: true });
        img.addEventListener("error", () => ((loaded[icon] = false), img.remove(), link.classList.remove("alza-price-tracker-product-compare-link--icon")), { once: true });
        img.src = icon;
        link.prepend(img);
      }
      wrap.appendChild(link);
    });
    return wrap;
  },

  // Text nabídky ke sdílení: název, cena bez podmínek, ceny s kódem / AlzaPlus+ / cashbackem, obvyklá cena
  // a nejnižší za 30 dní (z historie), odkaz na produkt
  buildOfferText(product, prices, verdict, lowest30) {
    const entries = AlzaCore.getPriceEntries(prices || {});
    const conditional = this.conditionalPriceTypes; // list-toolbar.js
    const regular = entries.filter(({ type }) => !conditional.includes(type));
    const lines = [product.name];
    if (regular.length > 0) lines.push(this.translate("offerPrice", this.formatPrice(regular[0].price)));
    entries
      .filter(({ type }) => conditional.includes(type))
      .forEach(({ type, price, code }) => {
        lines.push(code ? this.translate("offerWithCode", code, this.formatPrice(price)) : `${this.translate(`type_${type}`)}: ${this.formatPrice(price)}`);
      });
    if (verdict) lines.push(this.translate("offerTypical", this.formatPrice(verdict.typical)));
    if (lowest30) lines.push(this.translate("offerLowest30", this.formatPrice(lowest30.value)));
    lines.push(product.url);
    return lines.join("\n");
  },

  // Malý schodový graf nejnižší (prodejní) ceny s minimem a cílem – jen orientační, detail je v dialogu
  createProductSparkline(entries, min, target) {
    const W = 560;
    const H = 110;
    const m = { l: 4, r: 4, t: 18, b: 18 };
    const points = entries
      .map((entry, index) => ({ t: entry.t, end: entries[index + 1]?.t ?? entry.s, v: AlzaCore.getPlausibleMinPrice(entry.p) }))
      .filter((point) => point.v !== null);
    // Žádný záznam s cenou (poškozená data) – prázdný graf, ne pád celého panelu
    if (points.length === 0) return document.createElement("div");

    let t0 = points[0].t;
    let t1 = points[points.length - 1].end;
    if (t1 - t0 < 60 * 60 * 1000) {
      t0 -= 12 * 60 * 60 * 1000;
      t1 += 12 * 60 * 60 * 1000;
    }
    // Minimum může být starší než historie (uložené ze seznamu) – i tak musí být v rozsahu grafu
    const values = [...points.map((point) => point.v), ...(target ? [target.price] : []), ...(min ? [min.value] : [])];
    const vMin = Math.min(...values);
    const vMax = Math.max(...values);
    const pad = (vMax - vMin) * 0.1 || vMax * 0.05 || 1;
    const x = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
    const y = (v) => m.t + ((vMax + pad - v) / (vMax - vMin + 2 * pad)) * (H - m.t - m.b);

    const svg = this.createSvgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.t)},${y(point.v)}H${x(point.end)}`).join("");
    const first = points[0];
    const last = points[points.length - 1];
    svg.appendChild(
      this.createSvgEl("path", {
        d: `${line}V${H - m.b}H${x(first.t)}Z`,
        class: "alza-price-tracker-product-spark-area",
      })
    );
    svg.appendChild(this.createSvgEl("path", { d: line, class: "alza-price-tracker-product-spark-line" }));

    const addLevel = (value, color, label, anchorEnd) => {
      svg.appendChild(this.createSvgEl("line", { x1: m.l, x2: W - m.r, y1: y(value), y2: y(value), stroke: color, class: "alza-price-tracker-history-milestone" }));
      const text = this.createSvgEl("text", { x: anchorEnd ? W - m.r : m.l, y: y(value) - 4, "text-anchor": anchorEnd ? "end" : "start", class: "alza-price-tracker-history-milestone-label" });
      text.style.fill = color;
      text.textContent = label;
      svg.appendChild(text);
    };
    if (min) addLevel(min.value, this.config.historyMilestoneColors.min, `Min ${this.formatPrice(min.value)}`, false);
    if (target) addLevel(target.price, this.config.historyMilestoneColors.target, `${this.translate("milestoneTarget")} ${this.formatPrice(target.price)}`, true);

    [first.t, last.end].forEach((t, index) => {
      const label = this.createSvgEl("text", { x: index === 0 ? m.l : W - m.r, y: H - 4, "text-anchor": index === 0 ? "start" : "end" });
      label.textContent = this.formatDate(t);
      svg.appendChild(label);
    });

    const wrap = this.createEl("div", "alza-price-tracker-product-spark");
    wrap.appendChild(svg);
    return wrap;
  },
});
