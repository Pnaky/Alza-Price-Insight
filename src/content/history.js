// Content script (část AlzaPriceTracker): Historie cen: čtení a zápis historie, dialog historie s dlaždicemi a legendou.
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Historie cen ===
  // Každý produkt má vlastní klíč, takže běžné zobrazení seznamu historii vůbec nečte
  // a hlavní záznam cen nebobtná. Ukládá se jen změna cen/dostupnosti (záznam { t, s, p, a }):
  //   t = kdy byl stav poprvé zjištěn, s = poslední kontrola se stejným stavem,
  //   p = { typ: cena }, a = kód dostupnosti (in/order/expected/out, jinak text, null = neznámá)

  getHistoryKey(productUrl) {
    return AlzaCore.getHistoryKey(this.getAlzaDomain(), productUrl);
  },

  async getPriceHistory(productUrl) {
    const key = this.getHistoryKey(productUrl);
    const data = await this.getStorageData(key);
    return AlzaCore.normalizeHistory(data[key], this.state.language);
  },

  // Pro zobrazení – bez záznamů, které se liší jen názvem produktu (nezapisovat zpět)
  async getDisplayHistory(productUrl) {
    return AlzaCore.getPriceChangeHistory(await this.getPriceHistory(productUrl));
  },

  getAvailabilityCode(itemElement) {
    const element = itemElement.querySelector(this.selectors.availability);
    if (!element) return null;

    // processAvailabilityText zkracuje text, původní znění je pak v title (na 1. řádku, za ním je nápověda historie)
    const raw = (
      element.classList.contains("alza-price-tracker-dotted-underline")
        ? element.getAttribute("title")?.split("\n")[0]
        : element.textContent
    )?.trim();
    return this.classifyAvailability(raw || null);
  },

  // Text dostupnosti → kód (in/order/expected/out/ended); neznámý text se uloží zkrácený
  classifyAvailability(raw) {
    return AlzaCore.classifyAvailability(raw, this.state.language);
  },

  getAvailabilityLabel(code) {
    return AlzaCore.getAvailabilityLabel(code, this.state.uiLanguage || this.state.language);
  },

  getAvailabilityColor(code) {
    const colors = this.config.historyAvailabilityColors;
    return colors[code] || colors.other;
  },

  // name = nadpis stránky produktu – v historii se uloží jen při změně
  recordPriceHistory(productUrl, prices, availability, previousRecord, name = null) {
    return AlzaStore.run({
      type: "appendHistory",
      domain: this.getAlzaDomain(),
      lang: this.state.language,
      url: productUrl,
      prices,
      availability,
      previousRecord,
      name,
    });
  },

  // Typy cen vzestupně podle poslední známé ceny – stejné pořadí jako ceny v seznamu
  getHistoryTypes(entries) {
    const lastValues = {};
    entries.forEach((entry) => Object.assign(lastValues, entry.p));
    return Object.keys(lastValues).sort((a, b) => lastValues[a] - lastValues[b]);
  },

  getHistoryColor(type) {
    return this.config.historyTypes[type] || "#757575";
  },

  createEl(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  },

  createSvgEl(tag, attrs = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
    return element;
  },

  getProductInfo(itemElement) {
    const link = itemElement.querySelector(this.selectors.productLink);
    if (!link?.href) return null;
    const imageEl = itemElement.querySelector(this.selectors.image);
    const img = imageEl?.tagName === "IMG" ? imageEl : imageEl?.querySelector("img");
    return {
      url: link.href,
      name: link.textContent.trim(),
      image: img?.currentSrc || img?.src || null,
    };
  },

  // product = { url, name, image }; productData = uložený záznam (null → načte se až při kliknutí)
  attachHistoryTrigger(element, product, productData) {
    // Třídu může React přepsat (className dostupnosti) – podle ní by se listener přidal podruhé
    if (this.state.historyTriggers.has(element)) return;
    this.state.historyTriggers.add(element);
    element.classList.add("alza-price-tracker-history-trigger");
    const hint = this.translate("historyHint");
    this.appendTitle(element, hint);
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openHistoryDialog(product, productData);
    });
  },

  // Volá se z posluchačů kliknutí – chyba vykreslení se zapíše do logu, ne jako nezachycená výjimka
  openHistoryDialog(product, productData, options = {}) {
    return this.renderHistoryDialog(product, productData, options).catch((error) => console.error("Error opening price history:", error));
  },

  async renderHistoryDialog(product, productData, { focusTarget = false } = {}) {
    let entries = [];
    try {
      entries = await this.getDisplayHistory(product.url);
      productData ??= await this.getPriceRecord(product.url);
    } catch (error) {
      console.error("Error loading price history:", error);
    }

    document.querySelector(".alza-price-tracker-history")?.remove();

    // Padding je až na vnitřním boxu, takže klik přímo na <dialog> je klik na backdrop
    const dialog = this.createEl("dialog", "alza-price-tracker-history");
    const body = this.createEl("div", "alza-price-tracker-history-body");
    dialog.appendChild(body);

    // Záhlaví: obrázek + název produktu (odkaz), nad ním drobný štítek "Historie cen"
    const header = this.createEl("div", "alza-price-tracker-history-header");
    if (product.image) {
      const image = this.createEl("img", "alza-price-tracker-history-image");
      image.src = product.image;
      image.alt = "";
      header.appendChild(image);
    }
    const heading = this.createEl("div", "alza-price-tracker-history-heading");
    const productLink = this.createEl("a", "alza-price-tracker-history-product", product.name);
    productLink.href = product.url;
    productLink.target = "_blank";
    productLink.rel = "noopener";
    heading.append(this.createEl("div", "alza-price-tracker-history-eyebrow", this.translate("historyTitle")), productLink);
    const closeButton = this.createEl("button", "alza-price-tracker-history-close", "×");
    closeButton.type = "button";
    closeButton.title = this.translate("close");
    closeButton.setAttribute("aria-label", this.translate("close"));
    closeButton.addEventListener("click", () => dialog.close());
    header.append(heading, closeButton);

    body.append(
      header,
      this.createHistoryStats(entries, productData),
      ...this.createPriceNotices(entries, productData),
      this.createTargetSection(product, entries, productData)
    );

    if (entries.some((entry) => Object.keys(entry.p).length > 0)) {
      body.append(
        this.createHistoryLegend(entries),
        this.createHistoryChart(entries, productData, this.state.targets[this.getProductKey(product.url)]),
        this.createHistoryTable(entries)
      );
    } else {
      body.append(this.createEl("p", "alza-price-tracker-history-empty", this.getNoPriceNote(entries) || this.translate("historyEmpty")));
    }

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => dialog.remove());

    document.body.appendChild(dialog);
    dialog.showModal();
    if (focusTarget) dialog.querySelector(".alza-price-tracker-history-target-input")?.focus();
  },

  // Historie bez jediné ceny (typicky "Prodej skončil" nebo dlouhodobě nedostupné): místo "zatím žádná
  // historie" říct, od kdy trvá poslední stav dostupnosti. null = žádné záznamy nebo neznámá dostupnost
  getNoPriceNote(entries) {
    const last = entries[entries.length - 1];
    if (!last || last.a === null || last.a === undefined) return null;
    let since = last.t;
    for (let i = entries.length - 1; i >= 0 && entries[i].a === last.a; i--) since = entries[i].t;
    return this.translate("historyNoPrices", this.formatDate(since), this.getAvailabilityLabel(last.a));
  },

  // Prodejní maximum = nejvyšší z nejnižších cen. Uložené maxLowestPrice se sleduje až od jeho zavedení,
  // proto ho doplníme i z historie (vč. prvního záznamu převzatého z dřívějších cen).
  getSellingMax(entries, productData) {
    return this.getHistoricExtreme(entries, productData?.maxLowestPrice, "sellingMax");
  },

  // Historické minimum / ceníkové maximum: uložené v záznamu seznamu, doplněné z historie (produkty mimo
  // seznamy záznam nemají a kontroly z detailu produktu nebo na pozadí se do něj nepromítají)
  // kind: min = nejnižší prodejní cena, max = nejvyšší cena vůbec (ceníková), sellingMax = nejvyšší prodejní cena
  getHistoricExtreme(entries, stored, kind) {
    const isBetter = (value, best) => (kind === "min" ? value < best : value > best);
    let best = typeof stored?.value === "number" ? stored : null;
    entries.forEach((entry) => {
      const values = Object.values(entry.p);
      if (values.length === 0) return;
      const value = kind === "max" ? Math.max(...values) : AlzaCore.getPlausibleLowest(values);
      if (!best || isBetter(value, best.value)) best = { value, timestamp: entry.t };
    });
    return best;
  },

  // Další řádek tooltipu (first = na začátek)
  appendTitle(element, text, { first = false } = {}) {
    if (!text) return;
    element.title = element.title ? (first ? `${text}\n${element.title}` : `${element.title}\n${text}`) : text;
  },

  // Dlaždice s popiskem, hodnotou a podtitulkem (dialog historie: prefix "history", panel produktu: "product").
  // color = barva hodnoty, subColor = barva podtitulku (jen když podtitulek je)
  appendStat(container, prefix, label, value, sub, color = null, subColor = null) {
    const stat = this.createEl("div", `alza-price-tracker-${prefix}-stat`);
    const valueEl = this.createEl("div", `alza-price-tracker-${prefix}-stat-value`, value);
    if (color) valueEl.style.color = color;
    stat.append(this.createEl("div", `alza-price-tracker-${prefix}-stat-label`, label), valueEl);
    if (sub) {
      const subEl = this.createEl("div", `alza-price-tracker-${prefix}-stat-sub`, sub);
      if (subColor) subEl.style.color = subColor;
      stat.appendChild(subEl);
    }
    container.appendChild(stat);
    return stat;
  },

  // Dlaždice: minimum, prodejní a ceníkové maximum, začátek sledování, poslední kontrola
  createHistoryStats(entries, productData) {
    const stats = this.createEl("div", "alza-price-tracker-history-stats");
    const addStat = (label, value, sub, color, subColor) => this.appendStat(stats, "history", label, value, sub, color, subColor);

    const colors = this.config.historyMilestoneColors;
    [
      { label: "statMin", data: this.getHistoricExtreme(entries, productData?.minPrice, "min"), color: colors.min },
      { label: "statSellingMax", data: this.getSellingMax(entries, productData), color: colors.max, hint: "statSellingMaxHint" },
      { label: "statListMax", data: this.getHistoricExtreme(entries, productData?.maxPrice, "max") },
    ].forEach(({ label, data, color, hint }) => {
      if (typeof data?.value !== "number") return;
      const stat = addStat(
        this.translate(label),
        this.formatPrice(data.value),
        this.formatDateTime(data.timestamp),
        color
      );
      if (hint) stat.title = this.translate(hint);
    });

    // Nejnižší cena za 30 dní – oranžově, když je aktuální sleva podezřelá
    const priceMap = this.getCurrentPriceMap(entries, productData);
    const lowest30 = AlzaCore.getLowestInWindow(entries);
    if (lowest30) {
      const warning = AlzaCore.getDiscountWarning(entries, priceMap);
      const sub = lowest30.complete
        ? this.formatDate(lowest30.at)
        : `${this.formatDate(lowest30.at)} · ${this.translate("discountPartial", this.formatDays(Math.max(1, lowest30.days)))}`;
      const stat = addStat(
        this.translate("statLowest30"),
        this.formatPrice(lowest30.value),
        sub,
        warning ? this.config.historyMilestoneColors.target : null
      );
      if (warning) stat.title = this.getDiscountWarningText(warning).hint;
    }

    // Obvyklá cena – v podtitulku hodnocení aktuální ceny (bez nesmyslně nízké ceny)
    const current = AlzaCore.getPlausibleMinPrice(priceMap);
    const verdict = AlzaCore.getPriceVerdict(entries, current);
    if (verdict) {
      const { label, hint, color } = this.getVerdictText(verdict, current);
      const stat = addStat(this.translate("statTypical"), this.formatPrice(verdict.typical), label, null, color);
      stat.title = hint;
    }

    // Jen datum, ať se všechny dlaždice vejdou do jednoho řádku (čas je v podtitulku / title)
    if (entries.length > 0) {
      const since = addStat(
        this.translate("trackedSince"),
        this.formatDate(entries[0].t),
        this.translate("changesCount", entries.length - 1)
      );
      since.title = this.formatDateTime(entries[0].t);
      const lastCheck = entries[entries.length - 1].s;
      addStat(
        this.translate("lastCheck"),
        this.formatDate(lastCheck),
        new Date(lastCheck).toLocaleTimeString(this.state.locale, { hour: "2-digit", minute: "2-digit" })
      );
    }

    return stats;
  },

  createHistoryLegend(entries) {
    const legend = this.createEl("div", "alza-price-tracker-history-legend");

    this.getHistoryTypes(entries).forEach((type) => {
      const item = this.createEl("span", "alza-price-tracker-history-legend-item");
      const swatch = this.createEl("span", "alza-price-tracker-history-swatch");
      swatch.style.background = this.getHistoryColor(type);
      item.append(swatch, this.translate(`type_${type}`));
      legend.appendChild(item);
    });

    [...new Set(entries.map((entry) => entry.a).filter((code) => code !== null))].forEach((code) => {
      const item = this.createEl("span", "alza-price-tracker-history-legend-item");
      const swatch = this.createEl("span", "alza-price-tracker-history-swatch alza-price-tracker-history-swatch-band");
      swatch.style.background = this.getAvailabilityColor(code);
      item.append(swatch, this.getAvailabilityLabel(code));
      legend.appendChild(item);
    });

    return legend;
  },
});
