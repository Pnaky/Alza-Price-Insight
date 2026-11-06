// Content script (část AlzaPriceTracker): Lišta nad nákupním seznamem: souhrn, filtry, řazení.
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Lišta nad seznamem: souhrn, filtry, řazení ===
  // Položky ani jejich pořadí v DOM se nemění (React by je překreslil) – filtr řádky jen skrývá třídou
  // a řazení je CSS order. Lišta stojí před společným rodičem položek; když ji React odstraní,
  // observer v observePageChanges ji vrátí. Vykreslení musí být idempotentní (jinak by se observer zacyklil).

  listFilters: ["all", "dropped", "discounted", "good", "wait", "bulk", "condition", "inStock", "target", "suspicious"],
  conditionalPriceTypes: ["discount", "applus", "cashback", "scrappage"], // Cena jen za podmínky (kód, členství, vrácení po nákupu)
  listSorts: ["default", "cheapest", "unit", "expensive", "discount", "typical", "drop"],

  matchesListFilter(filter, item, data) {
    const lowest = data ? AlzaCore.getLowestPrice(data.priceMap) : null;
    switch (filter) {
      case "dropped":
        return data?.change < 0;
      case "discounted":
        return lowest !== null && lowest < Math.max(...Object.values(data.priceMap));
      case "inStock":
        return this.getAvailabilityCode(item) === "in";
      case "good":
        return data?.verdict?.level === "lowest" || data?.verdict?.level === "good";
      case "target":
        return this.isTargetReached(data);
      case "suspicious":
        return Boolean(data?.discountWarning || data?.strikethroughWarning);
      case "bulk":
        return Boolean(data?.quantityTiers);
      case "condition":
        return Boolean(data?.cheaperConditions?.length);
      case "wait":
        return Boolean(data?.saleCycle?.wait);
      default:
        return true;
    }
  },

  // Hodnota pro řazení vzestupně; null = na konec
  getListSortValue(sort, data) {
    const lowest = data ? AlzaCore.getLowestPrice(data.priceMap) : null;
    if (lowest === null) return null;
    const highest = Math.max(...Object.values(data.priceMap));
    switch (sort) {
      case "cheapest":
        return lowest;
      case "unit":
        return data.packCount ? lowest / data.packCount : null; // bez počtu kusů na konec
      case "expensive":
        return -lowest;
      case "discount":
        return -(highest - lowest) / highest;
      case "typical":
        return data.verdict ? (lowest - data.verdict.typical) / data.verdict.typical : null; // bez historie na konec
      case "drop":
        return data.change < 0 ? data.change : null;
      default:
        return 0;
    }
  },

  scheduleListToolbar() {
    this.scheduleFrame("toolbar", () => this.renderListToolbar());
  },

  // Společný rodič všech položek a jeho přímí potomci obsahující jednotlivé položky
  getListLayout() {
    const items = [...document.querySelectorAll(this.selectors.listItem)];
    if (items.length === 0) return null;

    let container = items[0].parentElement;
    while (container && !items.every((item) => container.contains(item))) container = container.parentElement;
    if (!container || container === document.body) return null;

    const rows = items.map((item) => {
      let row = item;
      while (row.parentElement !== container) row = row.parentElement;
      return row;
    });
    return { container, items, rows, sortable: new Set(rows).size === rows.length };
  },

  renderListToolbar() {
    const layout = this.getListLayout();
    if (!layout) {
      this.state.toolbarElement?.remove();
      return;
    }

    this.state.toolbarElement ??= this.createListToolbar();
    const toolbar = this.state.toolbarElement;
    if (toolbar.nextElementSibling !== layout.container) layout.container.before(toolbar);

    this.updateListSummary(toolbar, layout);
    this.applyListView(layout);
  },

  createListToolbar() {
    const toolbar = this.createEl("div", "alza-price-tracker-toolbar");
    const summary = this.createEl("div", "alza-price-tracker-toolbar-summary");
    const controls = this.createEl("div", "alza-price-tracker-toolbar-controls");
    const filters = this.createEl("div", "alza-price-tracker-toolbar-filters");

    this.listFilters.forEach((filter) => {
      const chip = this.createEl("button", "alza-price-tracker-toolbar-chip");
      chip.type = "button";
      chip.dataset.filter = filter;
      chip.addEventListener("click", () => {
        this.state.listView.filter = filter;
        this.renderListToolbar();
      });
      filters.appendChild(chip);
    });

    const sortLabel = this.createEl("label", "alza-price-tracker-toolbar-sort", this.translate("sortLabel"));
    const select = this.createEl("select");
    this.listSorts.forEach((sort) => {
      const option = this.createEl("option", null, this.translate(`sort${sort[0].toUpperCase()}${sort.slice(1)}`));
      option.value = sort;
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      this.state.listView.sort = select.value;
      this.renderListToolbar();
    });
    sortLabel.appendChild(select);

    controls.append(filters, sortLabel);
    toolbar.append(summary, controls);
    return toolbar;
  },

  setTextIfChanged(element, text) {
    if (element.textContent !== text) element.textContent = text;
  },

  updateListSummary(toolbar, layout) {
    const format = (price) => this.formatPrice(price);
    let total = 0; // K zaplacení: podle počtu kusů, i s množstevní slevou
    let afterRefund = 0; // Po vrácení cashbacku a výkupu
    let quantitySaving = 0;
    let listTotal = 0;
    let priced = 0;
    let dropped = 0;
    let raised = 0;

    layout.items.forEach((item) => {
      const data = this.state.itemData.get(item);
      const lowest = data ? AlzaCore.getLowestPrice(data.priceMap) : null;
      if (lowest === null) return;
      const quantity = parseInt(item.querySelector(this.selectors.quantityInput)?.value, 10) || 1;
      const payNow = AlzaCore.getPayNowPrice(data.priceMap) ?? lowest;
      const unitNow = AlzaCore.getQuantityUnitPrice(data.quantityTiers, payNow, quantity);
      priced++;
      total += unitNow * quantity;
      afterRefund += (unitNow - (payNow - lowest)) * quantity; // cashback / výkup na kus
      quantitySaving += (payNow - unitNow) * quantity;
      listTotal += Math.max(...Object.values(data.priceMap)) * quantity;
      if (data.change < 0) dropped++;
      if (data.change > 0) raised++;
    });

    const totalText = this.translate("summaryTotal", format(total));
    const parts = [
      this.translate("summaryItems", layout.items.length),
      afterRefund < total ? `${totalText} (${this.translate("summaryAfterRefund", format(afterRefund))})` : totalText,
    ];
    if (listTotal > total) parts.push(this.translate("summarySaving", format(listTotal - total)));
    if (quantitySaving > 0) parts.push(this.translate("summaryQuantity", format(quantitySaving)));
    if (dropped || raised) parts.push(this.translate("summaryChanges", dropped, raised));
    const summary = toolbar.querySelector(".alza-price-tracker-toolbar-summary");
    this.setTextIfChanged(summary, priced > 0 ? parts.join(" · ") : this.translate("summaryItems", layout.items.length));
    const hint = this.translate("summaryTotalHint", format(listTotal));
    if (summary.title !== hint) summary.title = hint;

    toolbar.querySelectorAll(".alza-price-tracker-toolbar-chip").forEach((chip) => {
      const { filter } = chip.dataset;
      const label = this.translate(`filter${filter[0].toUpperCase()}${filter.slice(1)}`);
      const count = layout.items.filter((item) => this.matchesListFilter(filter, item, this.state.itemData.get(item))).length;
      this.setTextIfChanged(chip, filter === "all" ? label : `${label} (${count})`);
      // Prázdný filtr skrýt (kromě aktivního, ať jde vypnout)
      this.setTabClass(chip, "alza-price-tracker-hidden", filter !== "all" && count === 0 && this.state.listView.filter !== filter);
      this.setTabClass(chip, "alza-price-tracker-toolbar-chip--active", this.state.listView.filter === filter);
    });

    const select = toolbar.querySelector("select");
    if (select.value !== this.state.listView.sort) select.value = this.state.listView.sort;
  },

  applyListView(layout) {
    const { filter, sort } = this.state.listView;
    const dataOf = (index) => this.state.itemData.get(layout.items[index]);

    layout.rows.forEach((row, index) => {
      this.setTabClass(row, "alza-price-tracker-hidden", !this.matchesListFilter(filter, layout.items[index], dataOf(index)));
    });

    const sorted = sort !== "default" && layout.sortable;
    this.setTabClass(layout.container, "alza-price-tracker-sorted", sorted);
    const order = new Map();
    if (sorted) {
      layout.rows
        .map((row, index) => ({ row, index, value: this.getListSortValue(sort, dataOf(index)) }))
        .sort((a, b) => (a.value === null) - (b.value === null) || a.value - b.value || a.index - b.index)
        .forEach(({ row }, rank) => order.set(row, String(rank + 1)));

      // Ostatní potomci rodiče (patička se součtem a tlačítky…) zůstanou před / za položkami
      const rows = new Set(layout.rows);
      let beforeItems = true;
      [...layout.container.children].forEach((child) => {
        if (rows.has(child)) beforeItems = false;
        else order.set(child, beforeItems ? "0" : "100000");
      });
    }
    [...layout.container.children].forEach((child) => {
      const value = order.get(child) || "";
      if (child.style.order !== value) child.style.order = value;
    });
  },
});
