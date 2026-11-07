// Content script (část AlzaPriceTracker): Cílová cena: uložení, sekce v dialogu historie, značky v seznamu.
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Cílová cena ===
  // Ukládá se do alzaTargets podle čísla produktu; služba na pozadí takový produkt hlídá, i když není
  // v hlídaném seznamu, a jednou ohlásí pokles na cílovou cenu (stav below viz AlzaCore.evaluateTarget)

  getProductKey(productUrl) {
    return AlzaCore.getProductKey(this.getAlzaDomain(), productUrl);
  },

  setupTargets() {
    const key = AlzaCore.storageKeys.targets;
    this.getStorageData(key)
      .then((data) => {
        this.state.targets = data[key] || {};
        this.updateTargetMarkers();
        if (this.state.product) this.scheduleProductPanel();
      })
      .catch((error) => console.error("Error loading target prices:", error));

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[key]) return;
      this.state.targets = changes[key].newValue || {};
      this.updateTargetMarkers();
    });
  },

  // Aktuální ceny: uložený záznam seznamu, jinak poslední záznam historie (produkt mimo seznamy),
  // na detailu dosud nesledovaného produktu ceny ze stránky
  getCurrentPriceMap(entries, productData) {
    const stored = productData ? AlzaCore.toPriceMap(productData) : {};
    if (Object.keys(stored).length > 0) return stored;
    if (entries.length === 0 && this.state.product) return AlzaCore.toPriceMap(this.getProductPagePrices());
    return entries[entries.length - 1]?.p || {};
  },

  // Cílová cena / cena k ní: u cíle za kus "2,50 Kč/ks (900 Kč)"
  formatTargetValue(price, target) {
    return AlzaCore.formatTargetValue(price, target, this.getAlzaDomain(), this.state.uiLanguage || this.state.language);
  },

  // "Dosaženo – aktuálně …" / "Aktuálně …, chybí … (-x %)"; u cíle za kus v cenách za kus
  getTargetStatus(target, lowest) {
    if (lowest === null) return "";
    if (lowest <= target.price) return this.translate("targetReached", this.formatTargetValue(lowest, target));
    const missing = lowest - target.price;
    const packCount = AlzaCore.getTargetPackCount(target);
    const missingText = packCount ? `${this.formatUnitPrice(missing / packCount)}/${this.translate("pieceUnit")}` : this.formatPrice(missing);
    return this.translate("targetMissing", this.formatTargetValue(lowest, target), missingText, Math.ceil((missing / lowest) * 100));
  },

  // packCount = cíl za kus (price je i tak celková cena balení), null = cíl na celou cenu
  async saveTarget(product, price, lowest, packCount = null) {
    const key = this.getProductKey(product.url);
    const target = price !== null && {
      price,
      below: lowest !== null && lowest <= price, // už teď pod cílem → neohlašovat, až znovu klesne
      url: product.url,
      domain: this.getAlzaDomain(),
      name: product.name,
      image: product.image,
      since: Date.now(), // u změny cíle zůstane původní (keep)
      ...(packCount && { unit: true, packCount }),
    };
    this.state.targets = await AlzaStore.run({
      type: "patchMap",
      key: AlzaCore.storageKeys.targets,
      ...(target ? { set: { [key]: target }, keep: ["since"] } : { remove: [key] }),
    });
  },

  createTargetSection(product, entries, productData) {
    const target = this.state.targets[this.getProductKey(product.url)];
    const lowest = AlzaCore.getLowestPrice(this.getCurrentPriceMap(entries, productData));
    const currency = this.state.currencySymbol;
    // Cíl za kus jde zadat, jen když známe počet kusů v balení
    const packCount = AlzaCore.getTargetPackCount(target) || this.getProductPackCount(product, productData);
    const unitMode = () => Boolean(packCount) && unitSelect.value === "unit";

    const section = this.createEl("div", "alza-price-tracker-history-target");
    const form = this.createEl("div", "alza-price-tracker-history-target-form");
    const label = this.createEl("label", "alza-price-tracker-history-target-label", `🎯 ${this.translate("targetLabel")}`);
    const input = this.createEl("input", "alza-price-tracker-history-target-input");
    input.id = "alza-price-tracker-target-input";
    input.type = "number";
    input.min = "0";
    input.step = "any";
    input.inputMode = "decimal";
    label.htmlFor = input.id;

    // Jednotka cíle: celá cena / cena za kus; při přepnutí se zadaná hodnota přepočítá
    const unitSelect = this.createEl("select", "alza-price-tracker-history-target-currency");
    [["total", currency], ["unit", `${currency}/${this.translate("pieceUnit")}`]].forEach(([value, text]) => {
      const option = this.createEl("option", null, text);
      option.value = value;
      unitSelect.appendChild(option);
    });
    unitSelect.value = AlzaCore.getTargetPackCount(target) ? "unit" : "total";
    const toInputValue = (total) => (unitMode() ? String(Math.round((total / packCount) * 100) / 100) : String(total));
    const setPlaceholder = () => {
      input.placeholder = lowest !== null ? toInputValue(unitMode() ? Math.floor(lowest * 90) / 100 : Math.floor(lowest * 0.9)) : "";
    };
    unitSelect.addEventListener("change", () => {
      const value = AlzaCore.toNumber(input.value);
      if (value > 0) input.value = unitMode() ? toInputValue(value) : String(Math.round(value * packCount * 100) / 100);
      setPlaceholder();
      if (!target) status.textContent = this.translate(unitMode() ? "targetUnitHint" : "targetHint");
    });
    if (target) input.value = toInputValue(target.price);
    setPlaceholder();

    const status = this.createEl("div", "alza-price-tracker-history-target-status");
    if (target && lowest !== null) {
      status.textContent = this.getTargetStatus(target, lowest);
      if (lowest <= target.price) status.classList.add("alza-price-tracker-history-target-status--reached");
    } else {
      status.textContent = this.translate(unitMode() ? "targetUnitHint" : "targetHint");
    }

    const reopen = () => this.openHistoryDialog(product, productData);
    const save = async () => {
      const value = AlzaCore.toNumber(input.value);
      if (!(value > 0)) {
        status.textContent = this.translate("targetInvalid");
        status.classList.add("alza-price-tracker-history-target-status--error");
        input.focus();
        return;
      }
      if (unitMode()) await this.saveTarget(product, value * packCount, lowest, packCount);
      else await this.saveTarget(product, value, lowest);
      reopen();
    };

    const saveButton = this.createEl("button", "alza-price-tracker-history-target-button", this.translate("targetSave"));
    saveButton.type = "button";
    saveButton.addEventListener("click", () => save().catch((error) => console.error("Error saving target price:", error)));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") saveButton.click();
    });

    form.append(label, input, packCount ? unitSelect : this.createEl("span", "alza-price-tracker-history-target-currency", currency), saveButton);

    if (target) {
      const removeButton = this.createEl(
        "button",
        "alza-price-tracker-history-target-button alza-price-tracker-history-target-button--secondary",
        this.translate("targetRemove")
      );
      removeButton.type = "button";
      removeButton.addEventListener("click", () =>
        this.saveTarget(product, null, lowest)
          .then(reopen)
          .catch((error) => console.error("Error removing target price:", error))
      );
      form.appendChild(removeButton);
    }

    section.append(form, status);
    return section;
  },

  // Ikony u ceny v seznamu (cílová cena). Jsou absolutně vlevo od cen v mezeře za
  // dostupností – nesmí měnit šířku sloupce s cenou, jinak se řádek Alzy zalamuje
  getPriceIndicators(priceContainer) {
    let indicators = priceContainer.querySelector(".alza-price-tracker-indicators");
    if (!indicators) {
      priceContainer.classList.add("alza-price-tracker-price-container");
      indicators = this.createEl("span", "alza-price-tracker-indicators");
      // Na začátek – poslední cena musí zůstat :last-child (bez pravého okraje), jinak se řádek posune
      priceContainer.prepend(indicators);
    }
    return indicators;
  },

  // Ikona cílové ceny – zelená, když je cíl dosažen; cena a rozdíl v tooltipu
  updateTargetMarker(itemElement) {
    const data = this.getItemData(itemElement);
    const priceContainer = itemElement.querySelector(this.selectors.priceContainer);
    if (!data || !priceContainer) return;

    priceContainer.querySelector(".alza-price-tracker-target-marker")?.remove();
    // Terč posouvá sloupec se součtem více kusů – po vykreslení znovu změřit, jestli se vejde
    this.scheduleFrame("fitQuantityTotals", () => this.fitQuantityTotals());
    const target = this.state.targets[this.getProductKey(data.url)];
    if (!target) return;

    const lowest = AlzaCore.getLowestPrice(data.priceMap);
    const marker = this.createEl("span", "alza-price-tracker-target-marker alza-price-tracker-target-marker--icon", "🎯");
    marker.title = `${this.translate("targetLabel")}: ${this.formatTargetValue(target.price, target)}`;
    if (lowest !== null) marker.title += `\n${this.getTargetStatus(target, lowest)}`;
    if (lowest !== null && lowest <= target.price) marker.classList.add("alza-price-tracker-target-marker--reached");
    // Terč vlevo, šipka hodnocení vždy těsně u ceny – ať jsou šipky v seznamu pod sebou; součet více kusů
    // (showQuantityTotal) zůstává úplně vlevo
    const indicators = this.getPriceIndicators(priceContainer);
    const total = indicators.querySelector(":scope > .alza-price-tracker-quantity-total");
    if (total) total.after(marker);
    else indicators.prepend(marker);
  },

  updateTargetMarkers() {
    document.querySelectorAll(this.selectors.listItem).forEach((item) => this.updateTargetMarker(item));
    if (this.state.toolbarElement) this.scheduleListToolbar();
  },

  isTargetReached(data) {
    const target = data && this.state.targets[this.getProductKey(data.url)];
    const lowest = data && AlzaCore.getLowestPrice(data.priceMap);
    return Boolean(target) && lowest !== null && lowest <= target.price;
  },
});
