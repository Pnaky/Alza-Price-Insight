// Content script (část AlzaPriceTracker): Hodnocení cen: podezřelá sleva a přeškrtnutá cena, obvyklá cena, rytmus akcí, podezřelá cena.
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Podezřelá sleva ===
  // Produkt ve slevě, který byl za posledních 30 dní levnější (AlzaCore.getDiscountWarning), nebo
  // s přeškrtnutou cenou, za kterou se neprodával (AlzaCore.getStrikethroughWarning)

  formatDays(count) {
    const [one, few, many] = this.translate("days");
    const form = count === 1 ? one : count >= 2 && count <= 4 ? few : many;
    return `${count} ${form}`;
  },

  formatDate(ts) {
    return new Date(ts).toLocaleDateString(this.state.locale);
  },

  getDiscountWarningText(warning) {
    const price = this.formatPrice(warning.value);
    const partial = warning.complete ? "" : ` · ${this.translate("discountPartial", this.formatDays(Math.max(1, warning.days)))}`;
    return {
      label: `${this.translate("discountWarning", price)}${partial}`,
      hint: this.translate("discountWarningHint", price, this.formatDate(warning.at)),
    };
  },

  getStrikethroughText(warning) {
    const claimed = this.formatPrice(warning.claimed);
    if (warning.never) return this.translate("strikeNever", claimed, this.formatDays(warning.days), this.formatPrice(warning.highest.value));
    return this.translate("strikeStale", claimed, this.formatDate(warning.at), this.formatDays(Math.floor((Date.now() - warning.at) / AlzaCore.dayMs)));
  },

  // Pruhy v dialogu historie (podezřelá sleva, vymyšlená přeškrtnutá cena) – v seznamu je jen filtr,
  // tady se ukáže proč
  createPriceNotices(entries, productData) {
    const priceMap = this.getCurrentPriceMap(entries, productData);
    const notices = [];

    AlzaCore.getSuspiciousPrices(entries, priceMap).forEach((item) =>
      notices.push(this.createEl("div", "alza-price-tracker-history-warning", this.getSuspiciousText(item)))
    );

    const warning = AlzaCore.getDiscountWarning(entries, priceMap);
    if (warning) {
      const current = AlzaCore.getPlausibleMinPrice(priceMap);
      let text = this.translate(
        "discountWarningDetail",
        this.formatPrice(current),
        this.formatPrice(warning.value),
        this.formatDate(warning.at),
        this.formatPrice(current - warning.value)
      );
      // Věta končí tečkou – „údaj za X dní“ za ni bez tečky navíc: „… levněji) · údaj za 5 dní“
      if (!warning.complete) text = `${text.replace(/\.$/, "")} · ${this.translate("discountPartial", this.formatDays(Math.max(1, warning.days)))}`;
      notices.push(this.createEl("div", "alza-price-tracker-history-warning", text));
    }

    const strikethrough = AlzaCore.getStrikethroughWarning(entries, priceMap);
    if (strikethrough) notices.push(this.createEl("div", "alza-price-tracker-history-warning", this.getStrikethroughText(strikethrough)));

    notices.forEach((notice) => AlzaIcons.prepend(notice, "warning", { tone: true }));
    return notices;
  },

  // "Rozbalený 6 619 Kč (o 71 Kč levněji) · Zánovní 6 459 Kč (o 231 Kč levněji)" s úvodem
  getCheaperConditionsText(cheaper) {
    const conditionKey = (condition) => `condition${condition[0].toUpperCase()}${condition.slice(1)}`;
    const items = cheaper.map(({ condition, price, diff }) =>
      this.translate("cheaperConditionItem", this.translate(conditionKey(condition)), this.formatPrice(price), this.formatPrice(diff))
    );
    return this.translate("cheaperConditions", items.join(" · "));
  },

  // Doba: do dvou týdnů ve dnech, jinak v týdnech ("6 týdnů")
  formatPeriod(days) {
    if (days < 14) return this.formatDays(Math.max(1, Math.round(days)));
    const weeks = Math.round(days / 7);
    const [one, few, many] = this.translate("weeks");
    return `${weeks} ${weeks === 1 ? one : weeks >= 2 && weeks <= 4 ? few : many}`;
  },

  // Rytmus akcí (AlzaCore.getSaleCycle): { summary, advice } – advice prázdné, když není co radit
  getSaleCycleText(cycle, verdictDays) {
    const depth = Math.round(cycle.depth * 100);
    const summary = cycle.regular
      ? this.translate("cycleRegular", this.formatPeriod(cycle.interval), depth, this.formatPeriod(cycle.duration))
      : this.translate("cycleIrregular", cycle.count, this.formatDays(verdictDays), depth);
    let advice = "";
    if (cycle.onSale) advice = this.translate("cycleOnSale", this.formatDate(cycle.lastStart), this.formatPeriod(cycle.duration));
    else if (cycle.nextAt !== null && cycle.nextAt <= Date.now()) advice = this.translate("cycleOverdue", this.formatDate(cycle.lastStart));
    else if (cycle.nextAt !== null) {
      advice = this.translate(cycle.wait ? "cycleWait" : "cycleLater", this.formatDate(cycle.lastStart), this.formatDate(cycle.nextAt));
    }
    return { summary, advice };
  },

  // === Obvyklá cena ===
  // Hodnocení aktuální ceny vůči obvyklé (AlzaCore.getPriceVerdict): { label, hint, color }

  getVerdictText(verdict, current) {
    const percent = Math.round((Math.abs(current - verdict.typical) / verdict.typical) * 100);
    const label = {
      lowest: this.translate("verdictLowest", this.formatDays(verdict.days), percent),
      good: this.translate("verdictGood", percent),
      usual: this.translate("verdictUsual"),
      high: this.translate("verdictHigh", percent),
    }[verdict.level];

    const hint = [this.translate("typicalHint", this.formatDays(verdict.days))];
    if (verdict.sales.count > 0) {
      hint.push(this.translate("typicalSales", verdict.sales.count, this.formatDays(Math.max(1, Math.round(verdict.sales.days)))));
    }
    return { label, hint: hint.join("\n"), color: this.config.verdictColors[verdict.level] };
  },

  // Šipka u ceny v seznamu: ▼ pod obvyklou cenou, ▲ nad ní; obvyklá cena značku nemá (řádek by byl přeplácaný)
  updateVerdictMarker(itemElement) {
    const data = this.getItemData(itemElement);
    const priceContainer = itemElement.querySelector(this.selectors.priceContainer);
    if (!data || !priceContainer) return;

    priceContainer.querySelectorAll(".alza-price-tracker-verdict-marker").forEach((marker) => marker.remove());
    // Šipky posouvají sloupec se součtem více kusů – po vykreslení znovu změřit, jestli se vejde
    this.scheduleFrame("fitQuantityTotals", () => this.fitQuantityTotals());
    const cycleText = data.saleCycle ? this.getSaleCycleText(data.saleCycle, data.verdict?.days || 0) : null;
    const cycleLines = cycleText ? [cycleText.summary, cycleText.advice].filter(Boolean) : [];

    // Vyplatí se počkat: další akce se čeká brzy – značka i u obvyklé ceny
    if (data.saleCycle?.wait) {
      const waitMarker = AlzaIcons.prepend(this.createEl("span", "alza-price-tracker-verdict-marker alza-price-tracker-verdict-marker--wait"), "hourglass", { tone: true });
      waitMarker.title = cycleLines.join("\n");
      this.getPriceIndicators(priceContainer).appendChild(waitMarker);
    }
    if (!data.verdict || data.verdict.level === "usual") return;

    const high = data.verdict.level === "high";
    const { label, hint } = this.getVerdictText(data.verdict, AlzaCore.getPlausibleMinPrice(data.priceMap));
    const marker = this.createEl(
      "span",
      `alza-price-tracker-verdict-marker alza-price-tracker-verdict-marker--${high ? "high" : "good"}`,
      high ? "▲" : "▼"
    );
    marker.title = [`${label}`, `${this.translate("statTypical")}: ${this.formatPrice(data.verdict.typical)}`, hint, ...cycleLines].join("\n");
    this.getPriceIndicators(priceContainer).appendChild(marker);
  },

  // Podezřelá sleva, přeškrtnutá cena a obvyklá cena z historie položky – pro filtry, řazení a šipku u ceny
  async updatePriceInsights(itemElement, productUrl, priceMap) {
    const entries = await this.getDisplayHistory(productUrl);
    // Položka se mezitím mohla překreslit s jiným produktem nebo cenami
    const data = this.getItemData(itemElement);
    if (data?.priceMap !== priceMap) return;

    // Varování se v seznamu nezobrazují (řádek by byl přeplácaný) – slouží filtru v liště, detail je v dialogu
    data.discountWarning = AlzaCore.getDiscountWarning(entries, priceMap);
    data.strikethroughWarning = AlzaCore.getStrikethroughWarning(entries, priceMap);
    data.verdict = AlzaCore.getPriceVerdict(entries, AlzaCore.getPlausibleMinPrice(priceMap));
    data.saleCycle = AlzaCore.getSaleCycle(entries, AlzaCore.getPlausibleMinPrice(priceMap));
    this.updateVerdictMarker(itemElement);
    const priceContainer = itemElement.querySelector(this.selectors.priceContainer);
    if (priceContainer) this.markSuspiciousPrices(priceContainer, AlzaCore.getSuspiciousPrices(entries, priceMap));
    this.scheduleListToolbar();
  },

  // === Podezřelá cena ===
  // Možná chyba čtení (AlzaCore.getSuspiciousPrices) – cena se ukáže, ale s výstrahou

  getSuspiciousText(item) {
    const key = item.reason === "gap" ? "suspiciousGap" : "suspiciousJump";
    return this.translate(key, this.translate(`type_${item.type}`), this.formatPrice(item.price), this.formatPrice(item.reference));
  },

  // Ceny v řádku seznamu: výstraha před cenou a vysvětlení v title (nad případnou cenou za kus)
  markSuspiciousPrices(priceContainer, suspicious) {
    priceContainer.querySelectorAll(".alza-price-tracker-price").forEach((element) => {
      const item = suspicious.find(({ type }) => type === element.dataset.priceType);
      if (!item || element.classList.contains("alza-price-tracker-price--suspicious")) return;
      element.classList.add("alza-price-tracker-price--suspicious");
      const text = this.getSuspiciousText(item);
      this.appendTitle(element, text, { first: true });
    });
  },
});
