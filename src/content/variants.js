// Content script (část AlzaPriceTracker): Velikosti balení na detailu produktu: cena za jednotku u voleb velikosti, počet kusů, množstevní slevy.
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Velikosti balení na detailu ===
  // Výběr velikosti ukazuje jen rozdíl ceny proti aktuálnímu balení. Po jeho otevření (možnosti vykreslí React
  // až tehdy) doplníme ke každé velikosti cenu za jednotku a nejvýhodnější zvýrazníme.

  setupVariantUnitPrices() {
    const annotate = () => {
      this.annotateVariantOptions();
      this.annotateSelectedVariants();
    };
    AlzaCore.createObserver(
      () => this.scheduleFrame("variants", annotate),
      { ignoreOwn: true }
    ).observe(document.body, { childList: true, subtree: true });
    annotate();
    setTimeout(() => this.probeVariantSelects().catch((error) => console.error("Error reading variants:", error)), 800);
  },

  // Alza vykreslí možnosti výběru až po jeho otevření a jinde je nemá (HTML stránky ani API). Aby nejvýhodnější /
  // nejdražší velikost ukázal hned i zavřený výběr, otevře se jednou neviditelně (CSS skryje rozbalený seznam),
  // přečte se a zavře. Jen výběry velikosti (ks, kg, l, m) a jen když je uživatel zrovna nemá otevřené
  async probeVariantSelects(attempt = 1) {
    const buttonSelector = '[data-testid="detailVariantSelectComponentOpenOptionsButton"]';
    const optionSelector = '[data-testid^="detailVariantOptionLabelText"]';
    const buttons = [...document.querySelectorAll(buttonSelector)].filter(
      (button) =>
        AlzaCore.parseVariantSize(button.querySelector('[data-testid="detailVariantOptionSelectedLabelText"]')?.textContent) &&
        !this.state.variantStats?.[this.getVariantSelectHeader(button)]
    );
    let missed = false;
    for (const button of buttons) {
      if (document.querySelector(`${buttonSelector}[aria-expanded="true"]`)) return;
      const hadFocus = document.activeElement === button;
      const root = document.documentElement;
      root.setAttribute("data-alza-price-tracker-variant-probe", ""); // Atribut, ne třída – <html> patří Alze
      try {
        button.click();
        if (await this.waitForCondition(() => document.querySelector(optionSelector), 1500)) this.annotateVariantOptions();
        else missed = true; // stránka ještě není interaktivní
      } finally {
        if (button.getAttribute("aria-expanded") === "true") button.click();
        if (!hadFocus) button.blur();
        await this.waitForCondition(() => !document.querySelector(optionSelector), 1000);
        root.removeAttribute("data-alza-price-tracker-variant-probe");
      }
    }
    this.annotateSelectedVariants();
    if (missed && attempt < 3) setTimeout(() => this.probeVariantSelects(attempt + 1).catch(() => {}), 2000);
  },

  // Počká, až podmínka platí (true), nebo vyprší čas (false)
  waitForCondition(check, timeout) {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (check()) resolve(true);
        else if (Date.now() - start > timeout) resolve(false);
        else setTimeout(tick, 16);
      };
      tick();
    });
  },

  // Nadpis výběru ("Velikost", "Délka kabelu") – klíč, pod kterým si pamatujeme nejvýhodnější / nejdražší cenu
  getVariantSelectHeader(button) {
    return button?.querySelector('[data-testid="detailVariantOptionSelectedLabelHeader"]')?.textContent.trim() || "";
  },

  annotateVariantOptions() {
    const labels = [...document.querySelectorAll('[data-testid^="detailVariantOptionLabelText"]')];
    const base = labels.length > 1 ? AlzaCore.getDocumentMainPrice(document) : null;
    if (!base) return;

    const options = labels
      .map((label) => {
        const size = AlzaCore.parseVariantSize(label.firstChild?.textContent);
        const diff = label.querySelector('[data-testid^="detailVariantOptionPriceDifference"]')?.textContent;
        const price = base + AlzaCore.parsePriceDifference(diff);
        return size && price > 0 ? { label, size, perUnit: price / size.amount } : null;
      })
      .filter(Boolean);
    // Porovnávat jen stejnou jednotku (ks, kg, l) – tu nejčastější
    const counts = {};
    options.forEach(({ size }) => (counts[size.unit] = (counts[size.unit] || 0) + 1));
    const unit = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const comparable = options.filter(({ size }) => size.unit === unit);
    if (comparable.length < 2) return;
    const perUnits = comparable.map(({ perUnit }) => perUnit);
    const stats = { unit, best: Math.min(...perUnits), worst: Math.max(...perUnits) };

    // Zapamatovat pro zavřený výběr – možnosti jsou v DOM jen při otevření
    const buttons = [...document.querySelectorAll('[data-testid="detailVariantSelectComponentOpenOptionsButton"]')];
    const openButton = buttons.find((button) => button.getAttribute("aria-expanded") === "true") || (buttons.length === 1 ? buttons[0] : null);
    if (openButton) this.state.variantStats = { ...this.state.variantStats, [this.getVariantSelectHeader(openButton)]: stats };

    comparable.forEach(({ label, perUnit }) => {
      // Sloupec u pravého okraje možnosti, ať jsou ceny pod sebou; bez kontejneru (jiné rozvržení) za popiskem
      const host = label.closest('[data-testid^="detailVariantOptionItemContainer"]') || label;
      const diffElement = label.querySelector('[data-testid^="detailVariantOptionPriceDifference"]');
      this.renderVariantUnit(host, unit, perUnit, stats, diffElement);
    });
  },

  // Zavřený výběr: cena za jednotku zvolené velikosti (cena stránky / množství) vpravo před šipkou. Nejvýhodnější /
  // nejdražší je známá až po prvním otevření výběru
  annotateSelectedVariants() {
    const labels = document.querySelectorAll('[data-testid="detailVariantOptionSelectedLabelText"]');
    const base = labels.length > 0 ? AlzaCore.getDocumentMainPrice(document) : null;
    if (!base) return;
    labels.forEach((label) => {
      const size = AlzaCore.parseVariantSize(label.textContent);
      const button = label.closest('[data-testid="detailVariantSelectComponentOpenOptionsButton"]');
      const host = button?.firstElementChild;
      if (!size || !host) return;
      const stats = this.state.variantStats?.[this.getVariantSelectHeader(button)];
      this.renderVariantUnit(host, size.unit, base / size.amount, stats?.unit === size.unit ? stats : null, null);
    });
  },

  // Štítek ceny za jednotku na konci hostitele; stats = { best, worst } výběru (null = neznámé, bez označení)
  renderVariantUnit(host, unit, perUnit, stats, fontSource) {
    const same = (value) => Math.abs(perUnit - value) <= value * 1e-9;
    const isBest = Boolean(stats) && same(stats.best);
    const isWorst = Boolean(stats) && !isBest && same(stats.worst);
    const unitLabel = unit === "ks" ? this.translate("pieceUnit") : unit;
    const tag = isBest ? this.translate("variantBest") : isWorst ? this.translate("variantWorst") : "";
    const text = `${tag ? `${tag} · ` : ""}${this.formatUnitPrice(perUnit)}/${unitLabel}`;
    let element = [...host.children].find((child) => child.classList.contains("alza-price-tracker-variant-unit"));
    // Idempotentní – vlastní změny DOM spouští observer znovu
    if (element?.textContent === text) return;
    if (!element) {
      element = this.createEl("span", "alza-price-tracker-variant-unit");
      // Stejně velké písmo jako rozdíl ceny v popisku
      const fontSize = fontSource && window.getComputedStyle?.(fontSource).fontSize;
      if (fontSize) element.style.fontSize = fontSize;
      host.appendChild(element);
    }
    element.textContent = text;
    element.classList.toggle("alza-price-tracker-variant-unit--best", isBest);
    element.classList.toggle("alza-price-tracker-variant-unit--worst", isWorst);
  },

  // Stupně množstevní slevy: "2 ks 116 Kč/ks · 3–4 ks 114 Kč/ks · 5+ ks 111 Kč/ks (-7 %)"; první stupeň je běžná cena
  formatQuantityTiers(tiers) {
    const unit = this.translate("pieceUnit");
    const steps = tiers.slice(1).map(([from, to, price]) => {
      const range = to >= 100000 ? `${from}+` : from === to ? `${from}` : `${from}–${to}`;
      return `${range} ${unit} ${this.formatPrice(price)}/${unit}`;
    });
    const percent = Math.round((1 - tiers[tiers.length - 1][2] / tiers[0][2]) * 100);
    return `${steps.join(" · ")} (-${percent} %)`;
  },

  // Tabulka stupňů množstevní slevy jako u Alzy (rozsah kusů | cena za kus), řádek s aktuálním počtem kusů
  // zvýrazněný. Na kartě detailu (Alza ji ukáže až po přidání do košíku) a v tooltipu v košíku
  createQuantityTiersTable(tiers, count = 1) {
    const unit = this.translate("pieceUnit");
    const table = this.createEl("div", "alza-price-tracker-tiers");
    table.appendChild(this.createEl("div", "alza-price-tracker-tiers-title", this.translate("quantityTiersTitle")));
    tiers.forEach(([from, to, price]) => {
      const range = to >= 100000 ? this.translate("quantityTierFrom", from, unit) : from === to ? `${from} ${unit}` : `${from}–${to} ${unit}`;
      const row = this.createEl("div", "alza-price-tracker-tiers-row");
      if (count >= from && count <= to) row.classList.add("alza-price-tracker-tiers-row--current");
      row.append(this.createEl("span", null, range), this.createEl("span", null, `${this.formatPrice(price)}/${unit}`));
      table.appendChild(row);
    });
    return table;
  },

  // Cena za kus na setiny jako u Alzy ("3,32 Kč")
  formatUnitPrice(price) {
    return AlzaCore.formatUnitPrice(price, this.getAlzaDomain());
  },

  // Počet kusů v balení z uloženého záznamu (i z importu – proto kontrola typu); null = neznámý
  getStoredPackCount(productData) {
    const count = productData?.packCount;
    return Number.isInteger(count) && count > 0 ? count : null;
  },

  // Počet kusů v balení: ze záznamu seznamu, na detailu produktu přímo ze stránky
  getProductPackCount(product, productData) {
    const stored = this.getStoredPackCount(productData);
    if (stored || product.url !== this.state.product?.url) return stored;
    return AlzaCore.getDocumentPackCount(document, this.getProductPagePrices());
  },
});
