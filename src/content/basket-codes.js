// Content script (část AlzaPriceTracker): Záchranná brzda v košíku – slevový kód, o kterém víme, ale v košíku
// není uplatněný. Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Košík (Order1.htm, krok 1) ===
  // Položka košíku, ke které máme z detailu produktu cenu se slevovým kódem (záznam ceny: discount.code), a
  // poukazy v košíku nepokryjí očekávanou slevu → klik na „Pokračovat“ / „Do AlzaBoxu“ zastaví upozornění:
  // kód s tlačítky Kopírovat a Vložit kód (vyplní Alzino pole a klikne na „Vložit“), nebo Pokračovat bez kódu.
  // Kód se po vložení změní na poukaz s jiným označením, proto se porovnává částka slevy, ne kód. Procentní kód
  // Alza ukáže přímo v řádku (box „Slevový kód -5 %“ s cenou za všechny kusy); kód s pevnou částkou je poukaz
  // v seznamu pod košíkem a platí jednou za objednávku (limit), cena v řádku zůstane.
  basketSelectors: {
    item: ".items .productContainer .tr", // Řádek zboží; nabídky příslušenství pole počtu nemají
    count: ".countInput input",
    price: ".c5", // Cena řádku: text „31 490 Kč“, nebo cenový box s uplatněným procentním kódem
    priceBox: ".ads-pb, .js-price-box",
    priceValue: ".js-price-box__primary-price__value, .ads-pb__price-value",
    discountBox: ".ads-pb--discount",
    link: 'a[href*="-d"][href$=".htm"]',
    voucherRow: "#discountContainerDiscountCode tr", // Uplatněné poukazy: kód | částka | platnost | podmínka | ×
    codeInput: "#txtDiscountCode",
    codeToggle: "#discountContainerDiscountCode .insertItemTitle",
    codeButton: "#discountContainerDiscountCode .insertItemBtn",
    continueButton: ".js-button-order-continue, #btnFastCheckout",
  },

  isBasketPage() {
    return Boolean(document.querySelector(this.basketSelectors.codeInput) && document.querySelector(this.basketSelectors.continueButton));
  },

  setupBasketCodes() {
    if (this.state.basketCodesReady || !this.isBasketPage()) return;
    this.state.basketCodesReady = true;
    this.state.basketMissing = null;
    const refresh = () => this.updateBasketCodes().catch((error) => console.error("Alza Price Tracker – kódy v košíku:", error));
    refresh();
    // Počet kusů, poukazy a položky Alza překresluje bez načtení stránky
    let timer = null;
    AlzaCore.createObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    }, { ignoreOwn: true }).observe(document.body, { childList: true, subtree: true });

    // Zachytávací fáze – dřív než Alzin posluchač; rozhoduje se z předem spočítaného stavu (čtení storage by
    // bylo pozdě, výchozí akci jde zrušit jen synchronně)
    document.addEventListener(
      "click",
      (event) => {
        if (this.state.basketCodesBypass) return;
        const button = event.target.closest?.(this.basketSelectors.continueButton);
        if (!button || !this.state.basketMissing) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.showBasketCodeWarning(button, this.state.basketMissing);
      },
      true
    );
  },

  // Položky košíku s cenou se slevovým kódem a kolik slevy chybí; null = vše v pořádku
  async updateBasketCodes() {
    const s = this.basketSelectors;
    const items = [...document.querySelectorAll(s.item)]
      .map((row) => {
        // První odkaz v řádku je obrázek bez textu – název je v odkazu s textem
        const links = [...row.querySelectorAll(s.link)];
        const link = links.find((a) => a.textContent.trim()) || links[0];
        const countInput = row.querySelector(s.count);
        if (!link || !countInput) return null;
        const count = parseInt(countInput.value, 10) || 1;
        // Uplatněný procentní kód: cenový box v řádku („Slevový kód -5 %“, cena s kódem, přeškrtnutá); bez něj jen text
        // „31 490 Kč“. Z boxu jen hlavní cena – celý text by slepil obě čísla do jednoho
        const cell = row.querySelector(s.price);
        const box = cell?.querySelector(s.priceBox);
        const value = AlzaCore.parsePositivePrice((cell?.querySelector(s.priceValue) || cell)?.textContent || "");
        return { url: new URL(link.getAttribute("href"), window.location.origin).href, name: link.textContent.replace(/\s+/g, " ").trim(), count, value, discounted: Boolean(box?.matches(s.discountBox)) };
      })
      .filter((item) => item && item.value);
    if (items.length === 0) {
      this.state.basketMissing = null;
      return;
    }

    const records = await this.getPriceRecords(items.map(({ url }) => url));
    const coded = items
      .map((item) => {
        const entry = records[item.url] && AlzaCore.getPriceEntries(records[item.url]).find(({ type, code }) => type === "discount" && code);
        if (!entry) return null;
        // Kód v řádku už platí: cena (za kus, nebo za všechny kusy) je na úrovni ceny s kódem
        if (item.discounted && (item.value <= entry.price + 1 || item.value <= entry.price * item.count + 1)) return null;
        // Sleva za jeden kus: procentní kód by se ukázal v řádku (výš), poukaz s pevnou částkou platí jednou za
        // objednávku bez ohledu na počet kusů (kód OPPO: 3 ks → jeden poukaz 5 000 Kč)
        const unit = item.value / item.count;
        const saving = Math.round(unit - entry.price);
        return saving > 0 ? { ...item, unit, code: entry.code, price: entry.price, saving } : null;
      })
      .filter(Boolean);
    // Poukaz s pevnou částkou (kód OPPO → 5 000 Kč) cenu v řádku nemění – pokryje zbylé položky z celkové slevy.
    // Procentní poukazy („5%“) se projeví v řádku, do součtu se nepočítají
    // Alza vložený kód přejmenuje (OPPOX10256GB → ZE48MKDYSQ), podle kódu poukaz k položce nepřiřadí. Poukaz se
    // stejnou částkou jako sleva položky patří jí (ta je vyřízená); zbylé poukazy (dárkové, jiné částky) pokryjí
    // ostatní položky z celkové slevy. Ve varování pak jen položky, kterým kód opravdu chybí
    const remaining = [...coded];
    let unmatched = 0;
    [...document.querySelectorAll(s.voucherRow)]
      .map((row) => row.querySelectorAll("td")[1]?.textContent || "")
      .filter((amount) => !amount.includes("%"))
      .map((amount) => AlzaCore.parsePositivePrice(amount) || 0)
      .forEach((amount) => {
        const index = remaining.findIndex(({ saving }) => Math.abs(saving - amount) <= 1);
        if (index >= 0) remaining.splice(index, 1);
        else unmatched += amount;
      });
    const expected = remaining.reduce((sum, { saving }) => sum + saving, 0);
    this.state.basketMissing = remaining.length > 0 && unmatched + 1 < expected ? { coded: remaining, missing: expected - unmatched } : null;
  },

  showBasketCodeWarning(button, { coded, missing }) {
    this.state.closeCartWarning?.();
    const box = this.createEl("div", "alza-price-tracker-cart-warning");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", this.translate("basketCodeTitle"));

    const header = this.createEl("div", "alza-price-tracker-cart-warning-header");
    const closeIcon = AlzaIcons.prepend(this.createEl("button", "alza-price-tracker-cart-warning-x"), "close");
    closeIcon.type = "button";
    closeIcon.setAttribute("aria-label", this.translate("cartWarningClose"));
    header.append(
      AlzaIcons.prepend(this.createEl("span", "alza-price-tracker-cart-warning-icon"), "warning", { tone: true }),
      this.createEl("span", "alza-price-tracker-cart-warning-title", this.translate("basketCodeTitle")),
      closeIcon
    );
    box.appendChild(header);

    const close = () => {
      box.remove();
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      this.state.closeCartWarning = null;
    };
    const onOutside = (event) => {
      if (!box.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };

    const list = this.createEl("ul", "alza-price-tracker-cart-warning-list");
    coded.forEach(({ url, name, unit, code, price, saving }) => {
      const row = this.createEl("li", "alza-price-tracker-cart-warning-item");
      // Název = odkaz na detail v nové kartě – košík zůstane otevřený
      const nameLink = this.createEl("a", "alza-price-tracker-cart-warning-name", name);
      nameLink.href = url;
      nameLink.target = "_blank";
      nameLink.rel = "noopener";
      row.appendChild(nameLink);
      // „S kódem 26 490 Kč · místo 31 490 Kč (−5 000 Kč)“ – cena za kus, rozdíl za všechny kusy
      const prices = this.createEl("div", "alza-price-tracker-cart-warning-prices");
      const chip = this.createEl("span", "alza-price-tracker-cart-warning-chip");
      const dot = this.createEl("span", "alza-price-tracker-cart-warning-dot");
      dot.style.background = "#c51718";
      chip.append(dot, this.translate("basketCodePrice", this.formatPrice(price)));
      prices.append(chip, this.createEl("span", "alza-price-tracker-cart-warning-regular", this.translate("basketCodeInstead", this.formatPrice(unit), this.formatPrice(saving))));
      row.appendChild(prices);
      const codeRow = this.createCodeRow(code);
      const insert = this.createEl("button", "alza-price-tracker-code-insert", this.translate("basketCodeInsert"));
      insert.type = "button";
      insert.addEventListener("click", () => {
        close();
        this.insertBasketCode(code);
      });
      codeRow.appendChild(insert);
      row.appendChild(codeRow);
      list.appendChild(row);
    });
    box.appendChild(list);
    box.appendChild(this.createEl("div", "alza-price-tracker-cart-warning-text alza-price-tracker-basket-missing", this.translate("basketCodeMissing", this.formatPrice(missing))));

    const actions = this.createEl("div", "alza-price-tracker-cart-warning-actions");
    const skipButton = this.createEl("button", "alza-price-tracker-cart-warning-close", this.translate("basketCodeSkip"));
    const backButton = this.createEl("button", "alza-price-tracker-cart-warning-proceed", this.translate("basketCodeBack"));
    skipButton.type = backButton.type = "button";
    actions.append(skipButton, backButton);
    box.appendChild(actions);

    this.state.closeCartWarning = close;
    closeIcon.addEventListener("click", close);
    backButton.addEventListener("click", close);
    skipButton.addEventListener("click", () => {
      close();
      this.state.basketCodesBypass = true;
      try {
        button.click();
      } finally {
        this.state.basketCodesBypass = false;
      }
    });
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);

    this.placePopover(box, button);
    backButton.focus();
  },

  // Vloží kód Alzinou cestou: otevře „Využít slevový / dárkový poukaz“, vyplní pole a klikne na „Vložit“
  insertBasketCode(code) {
    const s = this.basketSelectors;
    const input = document.querySelector(s.codeInput);
    if (!input) return;
    if (!input.offsetParent) document.querySelector(s.codeToggle)?.click();
    input.focus();
    input.value = code;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector(s.codeButton)?.click();
  },
});
