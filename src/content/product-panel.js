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

    const keys = [
      AlzaCore.storageKeys.watchProducts,
      AlzaCore.storageKeys.watchLists,
      AlzaCore.storageKeys.targets,
      this.getHistoryKey(product.url),
    ];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && keys.some((key) => changes[key])) this.scheduleProductPanel();
    });
  },

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
    if (AlzaCore.getSaveProblem(document, prices)) return; // nepřihlášen / ceny bez DPH – nic neukládat
    const availability = this.classifyAvailability(AlzaCore.extractAvailabilityFromDocument(document));
    if (AlzaCore.getPriceEntries(prices).length === 0 && availability === null) return;

    // Bez názvu – nadpis živé stránky se může lišit od staženého HTML (seznam, služba na pozadí)
    // a název by se v historii střídal; název dodá seznam a kontrola na pozadí
    await this.recordPriceHistory(url, prices, availability, this.state.productData);
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
    head.appendChild(this.createEl("span", "alza-price-tracker-product-title", this.translate("productHistory")));
    const watchButton = this.createEl("button", "alza-price-tracker-product-button alza-price-tracker-product-watch");
    watchButton.type = "button";
    if (watch.lists.length > 0) {
      watchButton.textContent = this.translate("productWatchedInList", watch.lists.join(", "));
      watchButton.disabled = true;
    } else {
      watchButton.textContent = this.translate(watch.watched ? "productUnwatch" : "productWatch");
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
    head.appendChild(watchButton);
    card.appendChild(head);

    const stats = this.createEl("div", "alza-price-tracker-product-stats");
    const addStat = (label, value, sub, color, subColor) => this.appendStat(stats, "product", label, value, sub, color, subColor);
    const verdict = hasHistory ? AlzaCore.getPriceVerdict(entries, plausibleNow) : null;
    if (lowestNow !== null) {
      // Pod aktuální cenou hodnocení vůči obvyklé ceně (zeleně / červeně); podezřelá cena oranžově s ⚠
      // Hodnocení se týká věrohodné ceny – pod nesmyslně nízkou by mátlo (zůstává v dlaždici Obvyklá cena)
      const lowestSuspicious = suspicious.find(({ price }) => price === lowestNow);
      const verdictText = verdict && lowestSuspicious?.reason !== "gap" && this.getVerdictText(verdict, plausibleNow);
      const stat = addStat(
        this.translate("productCurrent"),
        `${lowestSuspicious ? "⚠️ " : ""}${format(lowestNow)}`,
        verdictText?.label,
        lowestSuspicious ? this.config.historyMilestoneColors.target : null,
        verdictText?.color
      );
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
        card.appendChild(note);
      }
      if (strikethrough) {
        card.appendChild(this.createEl("div", "alza-price-tracker-product-note alza-price-tracker-product-note--warning", this.getStrikethroughText(strikethrough)));
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
      card.appendChild(this.createEl("div", "alza-price-tracker-product-note", this.getNoPriceNote(entries) || this.translate("productNoHistory")));
    }

    // Podezřelá cena i bez historie (pod polovinou další ceny se pozná z jediného načtení)
    suspicious.forEach((item) =>
      card.appendChild(this.createEl("div", "alza-price-tracker-product-note alza-price-tracker-product-note--warning", this.getSuspiciousText(item)))
    );

    // Stejný produkt levněji rozbalený / zánovní (přepínač stavu na stránce)
    const cheaperConditions = AlzaCore.getCheaperConditions(AlzaCore.getDocumentConditions(document, window.location.href), plausibleNow);
    if (cheaperConditions.length > 0) {
      card.appendChild(this.createEl("div", "alza-price-tracker-product-note", this.getCheaperConditionsText(cheaperConditions)));
    }

    // Množstevní slevy ze stránky – Alza ukáže jednotlivé stupně až po rozkliknutí
    const quantityTiers = AlzaCore.getDocumentQuantityTiers(document);
    if (quantityTiers) {
      card.appendChild(this.createEl("div", "alza-price-tracker-product-note", this.translate("quantityTiers", this.formatQuantityTiers(quantityTiers))));
    }

    if (target) {
      const status = this.getTargetStatus(target, lowestNow);
      const note = this.createEl("div", "alza-price-tracker-product-note", this.translate("productTarget", this.formatTargetValue(target.price, target), status));
      if (lowestNow !== null && lowestNow <= target.price) note.classList.add("alza-price-tracker-product-note--reached");
      card.appendChild(note);
    }

    const foot = this.createEl("div", "alza-price-tracker-product-foot");
    const historyButton = this.createEl("button", "alza-price-tracker-product-button", this.translate("productShowHistory"));
    historyButton.type = "button";
    historyButton.addEventListener("click", () => openDialog(false));
    const targetButton = this.createEl("button", "alza-price-tracker-product-button", target ? `🎯 ${this.translate("targetLabel")}` : this.translate("productSetTarget"));
    targetButton.type = "button";
    targetButton.addEventListener("click", () => openDialog(true));
    foot.append(historyButton, targetButton);
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
    if (target) addLevel(target.price, this.config.historyMilestoneColors.target, `🎯 ${this.formatPrice(target.price)}`, true);

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
