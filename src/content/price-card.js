// Content script (část AlzaPriceTracker): Tooltipy rozšíření – karta při najetí myší (seznam, košík, detail).
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Tooltipy ===
  // Místo systémového tooltipu (nejde vyfotit ani z něj kopírovat) vlastní karta jako tooltipy Alzy: bílá,
  // se stínem a šipkou na prvek, nad prvkem (když se nahoru nevejde, pod ním). U ceny bohatá karta (název typu
  // ceny, tabulka rozdílů, min/max, cena za kus, kód s kopírováním), u ostatních našich prvků s title text
  // (víc řádků → první tučně). Title se po dobu zobrazení schová, ať se neukáže i systémový tooltip.
  priceCardHideDelayMs: 200, // Čas na přejetí myší z prvku na kartu (tlačítko Kopírovat)
  // Naše prvky s nápovědou: ceny, šipky hodnocení, terč, ⏳, dostupnost, tlačítka v liště, karta na detailu…
  // (ne uvnitř karty a upozornění – tam je title jen popisek tlačítka)
  tooltipSelector: '.alza-price-tracker-price, [class*="alza-price-tracker"][title]',
  tooltipIgnore: ".alza-price-tracker-price-card, .alza-price-tracker-cart-warning, .alza-price-tracker-history",
  tooltipRightSide: ".alza-price-tracker-filter-block", // Tooltipy vpravo od prvku (levý panel filtrů)

  setupPriceCards() {
    if (this.state.priceCardsReady) return;
    this.state.priceCardsReady = true;
    document.addEventListener("mouseover", (event) => {
      const anchor = event.target.closest?.(this.tooltipSelector);
      if (anchor && !anchor.closest(this.tooltipIgnore)) this.showPriceCard(anchor);
    });
    // Karta má pevnou polohu vůči oknu – při posunu stránky by ujela od prvku
    window.addEventListener("scroll", () => this.hidePriceCard(), { passive: true, capture: true });
  },

  showPriceCard(price) {
    const current = this.state.priceCard;
    clearTimeout(this.state.priceCardHideTimer);
    if (current?.anchor === price) return;
    this.hidePriceCard();

    let text = price.title || "";
    const code = price.dataset.code || null;
    if (!text && !code) return;
    price.removeAttribute("title");

    const isPrice = price.matches(".alza-price-tracker-price");
    const box = price.dataset.tiers ? this.buildTiersCard(price) : isPrice ? this.buildPriceCard(price, text, code) : this.buildTextCard(text);
    document.body.appendChild(box);

    // Nad prvkem, šipka na jeho střed, celá v okně; když se nahoru nevejde, pod něj (šipka nahoru). V levém panelu
    // filtrů vpravo od prvku (šipka doleva) – nahoře by zakryla filtry a vyjela přes okraj stránky
    const arrow = this.createEl("span", "alza-price-tracker-price-card-arrow");
    box.appendChild(arrow);
    const place = () => {
      const rect = this.getTooltipAnchorRect(price);
      const { offsetWidth: width, offsetHeight: height } = box;
      box.classList.remove("alza-price-tracker-price-card--right", "alza-price-tracker-price-card--above", "alza-price-tracker-price-card--below");
      // Vpravo až za okrajem bloku – jinak by zakryla sousední filtry
      const side = price.closest(this.tooltipRightSide);
      const sideX = side ? Math.max(rect.right, side.getBoundingClientRect().right) + 12 : 0;
      const right = Boolean(side) && sideX + width <= window.innerWidth - 8;
      if (right) {
        const middle = rect.top + rect.height / 2;
        const top = Math.max(8, Math.min(middle - height / 2, window.innerHeight - height - 8));
        box.style.left = `${sideX}px`;
        box.style.top = `${top}px`;
        box.classList.add("alza-price-tracker-price-card--right");
        arrow.style.top = `${Math.max(14, Math.min(middle - top, height - 14))}px`;
      } else {
        const center = rect.left + rect.width / 2;
        const left = Math.max(8, Math.min(center - width / 2, window.innerWidth - width - 8));
        const above = rect.top - 12 - height >= 8;
        box.style.left = `${left}px`;
        box.style.top = `${above ? rect.top - 12 - height : rect.bottom + 12}px`;
        box.classList.add(above ? "alza-price-tracker-price-card--above" : "alza-price-tracker-price-card--below");
        arrow.style.left = `${Math.max(14, Math.min(center - left, width - 14))}px`;
      }
    };
    place();
    // Obsah dočtený později (termíny akce s cashbackem) kartu zvětší – nad prvkem by pak zakryla prvek
    const resizeWatch = new ResizeObserver(() => place());
    resizeWatch.observe(box);

    const scheduleHide = () => {
      clearTimeout(this.state.priceCardHideTimer);
      this.state.priceCardHideTimer = setTimeout(() => this.hidePriceCard(), this.priceCardHideDelayMs);
    };
    const keep = () => clearTimeout(this.state.priceCardHideTimer);
    price.addEventListener("mouseleave", scheduleHide);
    box.addEventListener("mouseenter", keep);
    box.addEventListener("mouseleave", scheduleHide);

    // Překreslení našeho prvku (lišta, záložka, košík se obnovují při každé změně stránky) title vrátí – pak by
    // vedle karty vyskakoval i systémový tooltip a při pohybu myši mizel a objevoval se. Nový text si karta
    // vezme a title hned zase schová
    const titleWatch = new MutationObserver(() => {
      if (!price.title) return;
      text = price.title;
      price.removeAttribute("title");
    });
    titleWatch.observe(price, { attributes: true, attributeFilter: ["title"] });

    this.state.priceCard = {
      anchor: price,
      box,
      restore: () => {
        price.removeEventListener("mouseleave", scheduleHide);
        titleWatch.disconnect();
        resizeWatch.disconnect();
        if (text && !price.title) price.title = text;
      },
    };
  },

  // Kam míří karta: blokový prvek přes celou šířku (souhrn v liště, poznámka na kartě detailu) má text jen vlevo –
  // karta pak míří na text (obdélník jeho obsahu), ne doprostřed prázdného řádku
  getTooltipAnchorRect(element) {
    const rect = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const content = range.getBoundingClientRect();
    return content.width > 0 && content.width < rect.width - 1 ? content : rect;
  },

  // Obsah karty: název ceny, tabulka (rozdíl proti dražším cenám položky, minimum, maximum, cena za kus)
  // a zbylé řádky title jako poznámky (hodnocení, výstrahy, množstevní sleva…); „Klikněte pro historii“ ne –
  // klik na cenu historii otevře i bez návodu
  buildPriceCard(price, text, code) {
    const box = this.createEl("div", "alza-price-tracker-price-card");
    box.setAttribute("role", "tooltip");
    const type = price.dataset.priceType;
    const typeKey = `type_${type}`;
    const typeLabel = this.translate(typeKey);
    box.appendChild(this.createEl("div", "alza-price-tracker-price-card-title", typeLabel !== typeKey ? typeLabel : ""));

    const rows = this.createEl("div", "alza-price-tracker-price-card-rows");
    const addRow = (label, value, extra) => {
      rows.append(
        this.createEl("span", "alza-price-tracker-price-card-label", label),
        this.createEl("span", "alza-price-tracker-price-card-value", value),
        this.createEl("span", "alza-price-tracker-price-card-extra", extra || "")
      );
    };

    // Rozdíl proti dvěma nejbližším dražším cenám položky – s názvem a částkou té ceny
    const own = AlzaCore.parsePrice(price.textContent);
    const siblings = [...(price.parentElement?.querySelectorAll(".alza-price-tracker-price[data-price-type]") || [])]
      .map((element) => ({ type: element.dataset.priceType, value: AlzaCore.parsePrice(element.textContent) }))
      .filter(({ value }) => Number.isFinite(value) && value > own);
    const higher = [...new Map(siblings.sort((a, b) => a.value - b.value).map((entry) => [entry.value, entry])).values()].slice(0, 2);
    higher.forEach(({ type: otherType, value }) => {
      const percent = AlzaCore.formatPercent(((value - own) / value) * 100, this.getAlzaDomain());
      addRow(this.translate("cardVs", this.translate(`type_${otherType}`), this.formatPrice(value)), `−${this.formatPrice(value - own)}`, `−${percent} %`);
    });

    const dropTime = (date) => date.replace(/\s+\d{1,2}:\d{2}$/, "");
    const notes = [];
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line !== typeLabel && line !== this.translate("historyHint"))
      .forEach((line) => {
        const minMax = line.match(/^Min: (.+?) \((.+?)\) \/ Max: (.+?) \((.+?)\)$/);
        const unit = line.match(/^(\S.*?\/\S+) \((.+)\)$/);
        if (minMax) {
          addRow(this.translate("cardMin"), minMax[1], dropTime(minMax[2]));
          addRow(this.translate("cardMax"), minMax[3], dropTime(minMax[4]));
        } else if (/^-\S.*\(-[\d,.\s]+ ?%\)/.test(line)) {
          // Rozdíl z title – tabulka ho má výš i s názvem ceny
        } else if (unit && !/%/.test(line)) {
          addRow(this.translate("statUnit"), unit[1], unit[2]);
        } else {
          notes.push(line);
        }
      });
    if (rows.childElementCount > 0) box.appendChild(rows);
    notes.forEach((line) => box.appendChild(this.createEl("div", "alza-price-tracker-price-card-note", line)));
    if (code) box.appendChild(this.createCodeRow(code));
    if (price.dataset.cashbackTerms) box.appendChild(this.createCashbackTermsBlock(price.dataset.cashbackTerms, price.dataset.cashbackTitle || null));
    return box;
  },

  // === Termíny akce s cashbackem ===
  // Konec nákupu a lhůta registrace u výrobce ze stránky akce (načte a uloží služba na pozadí – getCashbackTerms).
  // Jeden dotaz na akci za načtení stránky; výsledek i rozpracovaný dotaz se sdílí
  requestCashbackTerms(url, title) {
    const key = AlzaCore.getCashbackTermsKey(url, title);
    this.state.cashbackTerms ??= new Map();
    if (!this.state.cashbackTerms.has(key)) {
      const request = Promise.resolve(chrome.runtime.sendMessage({ action: "cashbackTerms", url, title }))
        .catch(() => null)
        .then((terms) => {
          this.state.cashbackTermsDone ??= new Map();
          this.state.cashbackTermsDone.set(key, terms);
          return terms;
        });
      this.state.cashbackTerms.set(key, request);
    }
    return this.state.cashbackTerms.get(key);
  },

  // Řádky termínů: [{ text, warn }] – „Nákup do 31. 12. 2026“ (warn: nákup podle podmínek už skončil) a
  // „Registrace u výrobce: nejdříve 30 dní po nákupu, do 15. 1. 2027“; [] = termíny nepoznáme
  getCashbackTermsLines(terms, time) {
    if (!terms?.ok) return [];
    const now = time ?? Date.now();
    const dates = AlzaCore.getCashbackDates(terms, now);
    const lines = [];
    if (dates.purchaseUntil) lines.push({ text: this.translate("cashbackPurchaseUntil", this.formatDate(dates.purchaseUntil)), warn: false });
    else if (dates.purchaseEnded) lines.push({ text: this.translate("cashbackPurchaseEnded", this.formatDate(dates.purchaseEnded)), warn: true });
    const today = new Date(now).setHours(0, 0, 0, 0);
    const fixed = (Array.isArray(terms.registerEnds) ? terms.registerEnds : []).filter((entry) => entry?.until >= today).sort((a, b) => a.until - b.until)[0];
    const parts = [];
    if (terms.waitDays > 0) parts.push(this.translate("cashbackRegisterWait", this.formatDays(terms.waitDays)));
    else if (fixed?.from > now) parts.push(this.translate("cashbackRegisterFrom", this.formatDate(fixed.from)));
    if (fixed) parts.push(this.translate("cashbackRegisterUntil", this.formatDate(fixed.until)));
    else if (terms.registerDays > 0) parts.push(this.translate("cashbackRegisterDays", this.formatDays(terms.registerDays)));
    if (parts.length > 0) lines.push({ text: this.translate("cashbackRegister", parts.join(", ")), warn: false });
    return lines;
  },

  // Blok do karty ceny s cashbackem: termíny (dočtou se, dokud je karta otevřená) a odkaz na podmínky akce
  createCashbackTermsBlock(url, title) {
    const block = this.createEl("div", "alza-price-tracker-cashback-terms");
    const lines = this.createEl("div", "alza-price-tracker-cashback-terms-lines");
    const link = this.createEl("a", "alza-price-tracker-cashback-terms-link", this.translate("cashbackTermsLink"));
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.addEventListener("click", (event) => event.stopPropagation()); // Klik nesmí otevřít historii ceny
    block.append(lines, link);
    const fill = (terms) => {
      lines.replaceChildren(
        ...this.getCashbackTermsLines(terms).map(({ text, warn }) =>
          this.createEl("div", `alza-price-tracker-cashback-terms-line${warn ? " alza-price-tracker-cashback-terms-line--warn" : ""}`, text)
        )
      );
    };
    const key = AlzaCore.getCashbackTermsKey(url, title);
    if (this.state.cashbackTermsDone?.has(key)) {
      fill(this.state.cashbackTermsDone.get(key));
    } else {
      lines.appendChild(this.createEl("div", "alza-price-tracker-cashback-terms-line alza-price-tracker-cashback-terms-line--muted", this.translate("cashbackTermsLoading")));
      this.requestCashbackTerms(url, title).then(fill);
    }
    return block;
  },

  // Tooltip jiného prvku než ceny: řádky title, u víc řádků první jako nadpis
  buildTextCard(text) {
    const box = this.createEl("div", "alza-price-tracker-price-card alza-price-tracker-price-card--text");
    box.setAttribute("role", "tooltip");
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    lines.forEach((line, index) => {
      const heading = index === 0 && lines.length > 1;
      box.appendChild(this.createEl("div", heading ? "alza-price-tracker-price-card-title" : "alza-price-tracker-price-card-text", line));
    });
    return box;
  },

  // Množstevní sleva (chip v košíku): tabulka stupňů jako u Alzy a kolik ušetříte
  buildTiersCard(element) {
    const box = this.createEl("div", "alza-price-tracker-price-card alza-price-tracker-price-card--tiers");
    box.setAttribute("role", "tooltip");
    let tiers = [];
    try {
      tiers = JSON.parse(element.dataset.tiers);
    } catch {
      tiers = [];
    }
    box.appendChild(this.createQuantityTiersTable(tiers, Number(element.dataset.count) || 1));
    if (element.dataset.saving) box.appendChild(this.createEl("div", "alza-price-tracker-tiers-saving", element.dataset.saving));
    return box;
  },

  hidePriceCard() {
    const card = this.state.priceCard;
    if (!card) return;
    clearTimeout(this.state.priceCardHideTimer);
    card.restore();
    card.box.remove();
    this.state.priceCard = null;
  },

  // Řádek „Kód: XYZ [ikona kopírování]“ – karta ceny, upozornění u košíku v seznamu i v košíku. Po zkopírování
  // se ikona na chvíli změní na fajfku (popis v title / aria-label)
  createCodeRow(code) {
    const row = this.createEl("div", "alza-price-tracker-code");
    const value = this.createEl("code", "alza-price-tracker-code-value", code);
    const copy = this.createEl("button", "alza-price-tracker-code-copy");
    copy.type = "button";
    const setLabel = (key) => {
      copy.title = this.translate(key);
      copy.setAttribute("aria-label", copy.title);
    };
    setLabel("codeCopy");
    copy.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation(); // Klik na kartu nesmí otevřít historii ani zavřít upozornění
      const copied = await this.copyText(code);
      copy.classList.toggle("alza-price-tracker-code-copy--done", copied);
      setLabel(copied ? "codeCopied" : "codeCopyFailed");
      setTimeout(() => {
        copy.classList.remove("alza-price-tracker-code-copy--done");
        setLabel("codeCopy");
      }, 1500);
    });
    row.append(this.createEl("span", "alza-price-tracker-code-label", this.translate("codeLabel")), value, copy);
    return row;
  },

  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Starší cesta (schránka bez oprávnění stránky) – dočasné pole mimo obrazovku
      const field = document.createElement("textarea");
      field.value = text;
      field.style.cssText = "position:fixed;left:-9999px;opacity:0";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      return copied;
    }
  },
});
