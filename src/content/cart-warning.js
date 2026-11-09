// Content script (část AlzaPriceTracker): Upozornění před vložením do košíku ze seznamu, když nejnižší cena platí jen za podmínky.
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Upozornění při vložení do košíku ze seznamu ===
  // Nejnižší cena se slevovým kódem, s AlzaPlus+ nebo po cashbacku / výkupu platí jen za podmínky akce –
  // vložením ze seznamu se nemusí uplatnit. Před vložením upozornit a nechat volbu.

  // { type, price, regular } podmíněné nejnižší ceny (regular = nejnižší cena bez podmínky, null = není);
  // null = nejnižší cena platí bez podmínek
  getConditionalLowest(priceMap) {
    const entries = Object.entries(priceMap || {}).filter(([, price]) => price > 0);
    if (entries.length === 0) return null;
    const [type, price] = entries.reduce((lowest, entry) => (entry[1] < lowest[1] ? entry : lowest));
    if (!this.conditionalPriceTypes.includes(type)) return null;
    const regular = entries.filter(([other]) => !this.conditionalPriceTypes.includes(other)).map(([, value]) => value);
    return { type, price, regular: regular.length > 0 ? Math.min(...regular) : null };
  },

  setupCartWarnings() {
    if (this.state.cartWarningsReady) return;
    this.state.cartWarningsReady = true;
    // Zachytávací fáze na dokumentu – dřív než posluchač Reactu na kořeni stránky
    document.addEventListener(
      "click",
      (event) => {
        if (this.state.cartWarningBypass) return;
        const button = event.target.closest?.(`${this.selectors.addToCartButton}, ${this.selectors.buyAllButton}`);
        if (!button) return;
        const items = button.matches(this.selectors.buyAllButton)
          ? [...document.querySelectorAll(this.selectors.listItem)]
          : [button.closest(this.selectors.listItem)].filter(Boolean);
        const conditional = items
          .map((item) => {
            const data = this.getItemData(item);
            return { item, condition: this.getConditionalLowest(data?.priceMap), code: data?.discountCode || null };
          })
          .filter(({ condition }) => condition);
        if (conditional.length === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.showCartWarning(button, conditional);
      },
      true
    );
  },

  showCartWarning(button, conditional) {
    this.state.closeCartWarning?.();
    const box = this.createEl("div", "alza-price-tracker-cart-warning");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", this.translate("cartWarningTitle"));

    const header = this.createEl("div", "alza-price-tracker-cart-warning-header");
    const closeIcon = AlzaIcons.prepend(this.createEl("button", "alza-price-tracker-cart-warning-x"), "close");
    closeIcon.type = "button";
    closeIcon.setAttribute("aria-label", this.translate("cartWarningClose"));
    header.append(
      AlzaIcons.prepend(this.createEl("span", "alza-price-tracker-cart-warning-icon"), "warning", { tone: true }),
      this.createEl("span", "alza-price-tracker-cart-warning-title", this.translate("cartWarningTitle")),
      closeIcon
    );
    box.appendChild(header);

    const list = this.createEl("ul", "alza-price-tracker-cart-warning-list");
    conditional.forEach(({ item, condition, code }) => {
      const hasCode = condition.type === "discount" && code;
      const productLink = item.querySelector(this.selectors.productLink);
      const row = this.createEl("li", "alza-price-tracker-cart-warning-item");
      row.appendChild(this.createEl("div", "alza-price-tracker-cart-warning-name", productLink?.textContent.trim() || ""));

      const prices = this.createEl("div", "alza-price-tracker-cart-warning-prices");
      const chip = this.createEl("span", "alza-price-tracker-cart-warning-chip");
      const dot = this.createEl("span", "alza-price-tracker-cart-warning-dot");
      dot.style.background = this.getHistoryColor(condition.type);
      chip.append(dot, `${this.translate(`type_${condition.type}`)} · ${this.formatPrice(condition.price)}`);
      prices.appendChild(chip);
      if (condition.regular) {
        prices.appendChild(this.createEl("span", "alza-price-tracker-cart-warning-regular", this.translate("cartWarningRegular", this.formatPrice(condition.regular))));
      }
      row.appendChild(prices);
      if (hasCode) row.appendChild(this.createCodeRow(code));
      row.appendChild(this.createEl("div", "alza-price-tracker-cart-warning-text", this.translate(hasCode ? "cartCondition_discountCode" : `cartCondition_${condition.type}`)));
      if (productLink?.href) {
        const detail = this.createEl("a", "alza-price-tracker-cart-warning-detail", `${this.translate("cartWarningDetail")} ↗`);
        detail.href = productLink.href;
        detail.target = "_blank";
        detail.rel = "noopener";
        row.appendChild(detail);
      }
      list.appendChild(row);
    });
    box.appendChild(list);

    // Jedna položka se slevovým kódem (ne „Přidat vše“): vložit rovnou s kódem jako Alzino „Koupit s kódem“
    const single = conditional.length === 1 && !button.matches(this.selectors.buyAllButton);
    const withCode = single && conditional[0].condition.type === "discount" && conditional[0].code ? conditional[0] : null;

    const actions = this.createEl("div", "alza-price-tracker-cart-warning-actions");
    const closeButton = this.createEl("button", "alza-price-tracker-cart-warning-close", this.translate(withCode ? "cartWithoutCode" : "cartWarningClose"));
    const proceedButton = this.createEl("button", "alza-price-tracker-cart-warning-proceed", this.translate(withCode ? "cartWithCode" : "cartWarningProceed"));
    closeButton.type = proceedButton.type = "button";
    actions.append(closeButton, proceedButton);
    box.appendChild(actions);

    const onOutside = (event) => {
      if (!box.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    const close = () => {
      box.remove();
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      this.state.closeCartWarning = null;
    };
    this.state.closeCartWarning = close;
    // Vložení Alzinou cestou (původní tlačítko) – bez kódu
    const addPlain = () => {
      close();
      this.state.cartWarningBypass = true;
      try {
        button.click();
      } finally {
        this.state.cartWarningBypass = false;
      }
    };
    closeIcon.addEventListener("click", close);
    if (!withCode) {
      closeButton.addEventListener("click", close);
      proceedButton.addEventListener("click", addPlain);
    } else {
      closeButton.addEventListener("click", addPlain);
      proceedButton.addEventListener("click", async () => {
        proceedButton.disabled = closeButton.disabled = true;
        proceedButton.textContent = this.translate("cartAdding");
        box.querySelector(".alza-price-tracker-cart-warning-error")?.remove();
        try {
          await this.addToCartWithCode(withCode.item, withCode.code);
          this.showCartAdded(box, header, list, actions, withCode.code, close);
        } catch (error) {
          console.error("Alza Price Tracker – vložení do košíku s kódem:", error);
          list.after(this.createEl("div", "alza-price-tracker-cart-warning-error", this.translate("cartAddFailed", error.message)));
          proceedButton.textContent = this.translate("cartWithCode");
          proceedButton.disabled = closeButton.disabled = false;
        }
      });
    }
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);

    this.placePopover(box, button);
    proceedButton.focus();
  },

  // Upozornění u tlačítka: pod ním (nad ním, když se dolů nevejde), celé v okně, šipka míří na tlačítko.
  // Souřadnice stránky – okno se posouvá spolu se stránkou (i upozornění v košíku, basket-codes.js)
  placePopover(box, button) {
    const arrow = this.createEl("span", "alza-price-tracker-cart-warning-arrow");
    box.appendChild(arrow);
    document.body.appendChild(box);
    const rect = button.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = box;
    const left = Math.max(8, Math.min(rect.right + 12 - width, window.innerWidth - width - 8));
    const below = rect.bottom + 12 + height <= window.innerHeight;
    const top = below ? rect.bottom + 12 : Math.max(8, rect.top - height - 12);
    const origin = getComputedStyle(document.body).position === "static" ? { left: -window.scrollX, top: -window.scrollY } : document.body.getBoundingClientRect();
    box.style.left = `${left - origin.left}px`;
    box.style.top = `${top - origin.top}px`;
    box.classList.add(below ? "alza-price-tracker-cart-warning--below" : "alza-price-tracker-cart-warning--above");
    arrow.style.left = `${Math.max(16, Math.min(rect.left + rect.width / 2 - left - 7, width - 30))}px`;
  },

  // Vloží položku seznamu do košíku i se slevovým kódem – stejný požadavek jako tlačítko „Koupit s kódem“ na
  // detailu produktu (Alza z kódu udělá v košíku slevový poukaz). Počet kusů podle seznamu. Chyba → výjimka
  async addToCartWithCode(item, code) {
    const href = item.querySelector(this.selectors.productLink)?.href || "";
    const id = Number(AlzaCore.getProductId(href));
    if (!id) throw new Error("?");
    const count = parseInt(item.querySelector(this.selectors.quantityInput)?.value, 10) || 1;
    const body = {
      id,
      count,
      warranty: null,
      insurance: null,
      replacement: null,
      hooks: [],
      src: 0,
      url: href,
      referrer: "",
      accessories: [],
      barem: null,
      tretinka: false,
      discountCode: code,
      isBuyOnInstallments: false,
      pageType: 0,
      pageId: id,
      referrerPageType: -1,
      referrerPageId: null,
      addFreeAccessories: false,
    };
    // Firefox: content.fetch posílá požadavek jako stránka Alzy (původ, cookies); Chrome to dělá i obyčejný fetch
    const pageFetch = typeof content !== "undefined" && typeof content?.fetch === "function" ? content.fetch.bind(content) : fetch;
    const response = await pageFetch(`${window.location.origin}/Services/EShopService.svc/OrderCommodity`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json; charset=UTF-8", Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => null))?.d;
    if (!response.ok || !result || result.ErrorLevel > 0 || !(result.Id || result.ItemsCount)) {
      throw new Error(result?.Message || `HTTP ${response.status}`);
    }
    return result;
  },

  // Upozornění po vložení s kódem: potvrzení a odkaz do košíku (počet v hlavičce Alzy se ukáže po načtení stránky)
  showCartAdded(box, header, list, actions, code, close) {
    const icon = header.querySelector(".alza-price-tracker-cart-warning-icon");
    AlzaIcons.prepend(icon, "check-circle", { tone: true });
    icon.classList.add("alza-price-tracker-cart-warning-icon--done");
    header.querySelector(".alza-price-tracker-cart-warning-title").textContent = this.translate("cartAddedTitle");
    list.replaceChildren(this.createEl("li", "alza-price-tracker-cart-warning-item", this.translate("cartAddedText", code)));
    const closeButton = this.createEl("button", "alza-price-tracker-cart-warning-close", this.translate("cartWarningClose"));
    closeButton.type = "button";
    closeButton.addEventListener("click", close);
    const cartLink = this.createEl("a", "alza-price-tracker-cart-warning-proceed", this.translate("cartGoToCart"));
    cartLink.href = `${window.location.origin}/Order1.htm`;
    actions.replaceChildren(closeButton, cartLink);
    box.querySelector(".alza-price-tracker-cart-warning-error")?.remove();
    cartLink.focus();
  },
});
