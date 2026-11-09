// Content script (část AlzaPriceTracker): Hodnocení cen přímo v košíku – pod názvem každé položky.
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Košík: hodnocení u položek ===
  // Co umí seznam, ukáže i košík (kde se rozhoduje): ▼▲ proti obvyklé ceně, vyplatí se počkat (rytmus akcí),
  // podezřelá sleva / vymyšlená přeškrtnutá cena, levněji v jiném stavu a blízký stupeň množstevní slevy
  // („Přidejte 1 ks → 489 Kč/ks“). Data ze záznamu ceny a historie (detail, seznam, kontrola na pozadí);
  // podrobnosti v tooltipu (price-card.js). Pod řádkem položky: množstevní sleva pod počtem kusů, zbytek pod cenou.
  basketInsightClass: "alza-price-tracker-basket-insights",

  setupBasketInsights() {
    if (this.state.basketInsightsReady || !this.isBasketPage()) return;
    this.state.basketInsightsReady = true;
    this.state.basketChips = new Map(); // Adresa produktu → poslední spočítané chipy (vrácení bez čekání)
    const refresh = () => this.updateBasketInsights().catch((error) => console.error("Alza Price Tracker – hodnocení v košíku:", error));
    refresh();
    // Počet kusů a položky Alza překresluje bez načtení stránky a vložený řádek zmizí. Vrátit ho hned z paměti
    // (observer běží před vykreslením – neproblikne), přepočítat až po chvíli
    let timer = null;
    AlzaCore.createObserver(() => {
      this.paintBasketInsights(this.getBasketRows());
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    }, { ignoreOwn: true }).observe(document.body, { childList: true, subtree: true });
  },

  getBasketRows() {
    const s = this.basketSelectors;
    return [...document.querySelectorAll(s.item)]
      .map((row) => {
        const links = [...row.querySelectorAll(s.link)];
        const link = links.find((a) => a.textContent.trim()) || links[0];
        const countInput = row.querySelector(s.count);
        if (!link || !countInput) return null;
        return { row, link, url: new URL(link.getAttribute("href"), window.location.origin).href, count: parseInt(countInput.value, 10) || 1 };
      })
      .filter(Boolean);
  },

  async updateBasketInsights() {
    const rows = this.getBasketRows();
    if (rows.length === 0) return;
    const records = await this.getPriceRecords(rows.map(({ url }) => url));
    const histories = await Promise.all(rows.map(({ url }) => (records[url] ? this.getDisplayHistory(url) : [])));
    rows.forEach((item, index) => this.state.basketChips.set(item.url, this.getBasketInsightChips(records[item.url], histories[index], item.count)));
    this.paintBasketInsights(this.getBasketRows());
  },

  // Pod řádkem položky dvě místa podle toho, k čemu se chip vztahuje: množstevní sleva pod počtem kusů (jako
  // tlačítko, které kusy přidá), hodnocení ceny a výstrahy pod cenou vpravo. Beze změny se DOM nepřepisuje,
  // jen se dorovná poloha (sloupce Alzy se mění se šířkou okna)
  basketCells: { count: ".c2", price: ".c5" },

  paintBasketInsights(rows) {
    rows.forEach(({ row, url }) => {
      const chips = this.state.basketChips?.get(url) || [];
      const signature = JSON.stringify(chips);
      let strip = row.nextElementSibling?.classList.contains(this.basketInsightClass) ? row.nextElementSibling : null;
      if (strip?.dataset.signature !== signature) {
        strip?.remove();
        strip = null;
        if (chips.length === 0) return;
        strip = this.createEl("div", this.basketInsightClass);
        strip.dataset.signature = signature;
        const countSlot = this.createEl("div", `${this.basketInsightClass}-count`);
        const priceSlot = this.createEl("div", `${this.basketInsightClass}-price`);
        chips.forEach((chip) => (chip.slot === "count" ? countSlot : priceSlot).appendChild(this.createBasketChip(row, chip)));
        strip.append(countSlot, priceSlot);
        row.after(strip);
      }
      if (strip) this.alignBasketInsights(row, strip);
    });
  },

  createBasketChip(row, { tone, icon, text, hint, add, tiers, count, saving }) {
    const className = `alza-price-tracker-basket-chip alza-price-tracker-basket-chip--${tone}`;
    const chip = this.createEl(add ? "button" : "span", className, text);
    if (icon) AlzaIcons.prepend(chip, icon, { tone: true });
    if (hint) chip.title = hint;
    // Tooltip s tabulkou stupňů (price-card.js)
    if (tiers) Object.assign(chip.dataset, { tiers: JSON.stringify(tiers), count: String(count || 1), saving: saving || "" });
    if (add) {
      // „+1 ks → 83 Kč/ks“: kusy přidá Alzino tlačítko + (přepočet košíku i ceny dělá Alza)
      chip.type = "button";
      chip.addEventListener("click", async () => {
        chip.disabled = true;
        for (let i = 0; i < add; i++) {
          const plus = row.isConnected ? row.querySelector(this.basketQuantityPlus) : null;
          if (!plus) break;
          plus.click();
          if (i < add - 1) await new Promise((resolve) => setTimeout(resolve, 600));
        }
        // Po přepočtu Alza řádek překreslí a chip se nahradí; kdyby ne, znovu povolit
        setTimeout(() => (chip.disabled = false), 3000);
      });
    }
    return chip;
  },

  basketQuantityPlus: ".countPlus",

  alignBasketInsights(row, strip) {
    const rowRect = row.getBoundingClientRect();
    const count = row.querySelector(this.basketCells.count)?.getBoundingClientRect();
    const price = row.querySelector(this.basketCells.price)?.getBoundingClientRect();
    const [countSlot, priceSlot] = strip.children;
    const set = (element, property, value) => element.style[property] !== value && (element.style[property] = value);
    if (count?.width) {
      set(countSlot, "marginLeft", `${Math.round(count.left - rowRect.left)}px`);
      set(countSlot, "width", `${Math.round(count.width)}px`);
    }
    if (price?.width) set(priceSlot, "marginRight", `${Math.max(0, Math.round(rowRect.right - price.right))}px`);
  },

  // [{ tone: good|high|wait|warn|info, icon, text, hint, slot?: "count", add? }] pro jednu položku košíku
  getBasketInsightChips(record, entries, count) {
    if (!record) return [];
    const priceMap = AlzaCore.toPriceMap(record);
    const current = AlzaCore.getPlausibleMinPrice(priceMap);
    if (!(current > 0)) return [];
    const chips = [];

    const verdict = entries.length > 0 ? AlzaCore.getPriceVerdict(entries, current) : null;
    const cycle = entries.length > 0 ? AlzaCore.getSaleCycle(entries, current) : null;
    const cycleText = cycle ? this.getSaleCycleText(cycle, verdict?.days || 0) : null;
    const cycleLines = cycleText ? [cycleText.summary, cycleText.advice].filter(Boolean) : [];
    if (verdict && verdict.level !== "usual") {
      const { label, hint } = this.getVerdictText(verdict, current);
      const high = verdict.level === "high";
      chips.push({
        tone: high ? "high" : "good",
        text: `${high ? "▲" : "▼"} ${label}`,
        hint: [label, `${this.translate("statTypical")}: ${this.formatPrice(verdict.typical)}`, hint, ...cycleLines].join("\n"),
      });
    }
    if (cycle?.wait) chips.push({ tone: "wait", icon: "hourglass", text: this.translate("filterWait"), hint: cycleLines.join("\n") });

    const discountWarning = entries.length > 0 ? AlzaCore.getDiscountWarning(entries, priceMap) : null;
    if (discountWarning) {
      const { label, hint } = this.getDiscountWarningText(discountWarning);
      chips.push({ tone: "warn", icon: "warning", text: label.replace(/^⚠️\s*/, ""), hint });
    }
    const strikethrough = entries.length > 0 ? AlzaCore.getStrikethroughWarning(entries, priceMap) : null;
    if (strikethrough) chips.push({ tone: "warn", icon: "warning", text: this.translate("basketStrikethrough"), hint: this.getStrikethroughText(strikethrough).replace(/^⚠️\s*/, "") });

    const cheaper = AlzaCore.getCheaperConditions(record.conditions, current);
    if (cheaper.length > 0) {
      const best = cheaper[0];
      chips.push({
        tone: "info",
        text: this.translate("basketCheaperCondition", this.translate(`condition${best.condition[0].toUpperCase()}${best.condition.slice(1)}`).toLowerCase(), this.formatPrice(best.price)),
        hint: this.getCheaperConditionsText(cheaper),
      });
    }

    const next = AlzaCore.getNextQuantityTier(AlzaCore.getQuantityTiers(record), AlzaCore.getPayNowPrice(priceMap) ?? current, count);
    if (next) {
      chips.push({
        tone: "info",
        slot: "count",
        add: next.add,
        tiers: AlzaCore.getQuantityTiers(record),
        count,
        saving: this.translate("quantityTierSaving", next.from, this.translate("pieceUnit"), this.formatPrice(next.saving)),
        text: this.translate("basketQuantityHint", next.add, this.formatPrice(next.unit)),
        hint: this.translate("basketQuantityHintDetail", next.from, this.formatPrice(next.unit), this.formatPrice(next.current), this.formatPrice(next.saving)),
      });
    }
    return chips;
  },
});
