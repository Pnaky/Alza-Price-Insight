// Content script (část AlzaPriceTracker): Graf a tabulka historie cen (dialog historie).
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // Schodový graf: cena platí až do další zjištěné změny (skok se kreslí v čase kontroly, která ji zachytila).
  // Historické minimum a prodejní maximum se kreslí jako vodorovné milníky přes celý graf
  // (ceníkové maximum ne – to je obvykle samotná čára původní ceny), stejně tak cílová cena.
  createHistoryChart(entries, productData, target) {
    const W = 800;
    const H = 300;
    const m = { l: 76, r: 16, t: 12, b: 28 };
    const bandH = 8;
    const plotBottom = H - m.b - bandH - 8;
    const bandY = plotBottom + 6;
    const plotW = W - m.l - m.r;
    const types = this.getHistoryTypes(entries);

    let t0 = entries[0].t;
    let t1 = entries[entries.length - 1].s;
    if (t1 - t0 < 60 * 60 * 1000) {
      t0 -= 12 * 60 * 60 * 1000;
      t1 += 12 * 60 * 60 * 1000;
    }

    const milestones = [
      { key: "min", label: "Min", data: this.getHistoricExtreme(entries, productData?.minPrice, "min") },
      { key: "max", label: this.translate("milestoneSellingMax"), data: this.getSellingMax(entries, productData) },
    ].filter(({ data }) => typeof data?.value === "number");

    const values = [
      ...entries.flatMap((entry) => Object.values(entry.p)),
      ...milestones.map(({ data }) => data.value),
      ...(target ? [target.price] : []),
    ];
    const vMin = Math.min(...values);
    const vMax = Math.max(...values);
    const span = vMax - vMin || vMax * 0.1 || 1;
    const rough = span / 4;
    const pow = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].find((f) => f * pow >= rough) * pow;
    // Dole víc místa – popisek Min je pod čarou
    const yLo = Math.max(0, Math.floor((vMin - span * 0.1) / step) * step);
    const yHi = Math.ceil((vMax + span * 0.05) / step) * step;

    const x = (t) => m.l + ((t - t0) / (t1 - t0)) * plotW;
    const y = (v) => m.t + ((yHi - v) / (yHi - yLo)) * (plotBottom - m.t);

    const svg = this.createSvgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });

    // Osa Y – mřížka a popisky
    const axisDigits = step < 1 ? 2 : 0;
    for (let v = yLo; v <= yHi + step / 2; v += step) {
      svg.appendChild(
        this.createSvgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "alza-price-tracker-history-grid" })
      );
      const label = this.createSvgEl("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" });
      label.textContent = `${v.toLocaleString(this.state.locale, {
        minimumFractionDigits: axisDigits,
        maximumFractionDigits: axisDigits,
      })} ${this.state.currencySymbol}`;
      svg.appendChild(label);
    }

    // Osa X – 5 popisků, u krátkého rozsahu i s časem
    const dateFormat =
      t1 - t0 > 3 * 24 * 60 * 60 * 1000
        ? { day: "numeric", month: "numeric" }
        : { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" };
    for (let i = 0; i <= 4; i++) {
      const t = t0 + ((t1 - t0) * i) / 4;
      const anchor = i === 0 ? "start" : i === 4 ? "end" : "middle";
      const label = this.createSvgEl("text", { x: x(t), y: H - 6, "text-anchor": anchor });
      label.textContent = new Date(t).toLocaleString(this.state.locale, dateFormat);
      svg.appendChild(label);
    }

    // Milníky Min/Max – popisek vlevo (vpravo přibývají nové hodnoty), Max nad čarou, Min pod ní
    milestones.forEach(({ key, label, data }) => {
      const color = this.config.historyMilestoneColors[key];
      svg.appendChild(
        this.createSvgEl("line", {
          x1: m.l,
          x2: W - m.r,
          y1: y(data.value),
          y2: y(data.value),
          stroke: color,
          class: "alza-price-tracker-history-milestone",
        })
      );
      const text = this.createSvgEl("text", {
        x: m.l + 4,
        y: y(data.value) + (key === "min" ? 14 : -5),
        "text-anchor": "start",
        class: "alza-price-tracker-history-milestone-label",
      });
      text.style.fill = color;
      const date = new Date(data.timestamp).toLocaleDateString(this.state.locale);
      text.textContent = `${label} ${this.formatPrice(data.value)} (${date})`;
      svg.appendChild(text);
    });

    if (target) {
      const color = this.config.historyMilestoneColors.target;
      svg.appendChild(
        this.createSvgEl("line", {
          x1: m.l,
          x2: W - m.r,
          y1: y(target.price),
          y2: y(target.price),
          stroke: color,
          class: "alza-price-tracker-history-milestone",
        })
      );
      const text = this.createSvgEl("text", {
        x: m.l + 4,
        y: y(target.price) - 5,
        "text-anchor": "start",
        class: "alza-price-tracker-history-milestone-label",
      });
      text.style.fill = color;
      text.textContent = `🎯 ${this.translate("milestoneTarget")} ${this.formatPrice(target.price)}`;
      svg.appendChild(text);
    }

    // Pás dostupnosti pod grafem
    entries.forEach((entry, i) => {
      if (entry.a === null) return;
      const x1 = x(entry.t);
      const x2 = x(entries[i + 1]?.t ?? entry.s);
      svg.appendChild(
        this.createSvgEl("rect", {
          x: x1,
          y: bandY,
          width: Math.max(2, x2 - x1),
          height: bandH,
          rx: 2,
          fill: this.getAvailabilityColor(entry.a),
        })
      );
    });

    // Čáry jednotlivých typů cen
    types.forEach((type) => {
      const color = this.getHistoryColor(type);
      const path = [];

      entries.forEach((entry, i) => {
        const v = entry.p[type];
        if (v === undefined) return;
        const next = entries[i + 1];
        const nextV = next?.p[type];
        path.push(`M${x(entry.t)},${y(v)}H${x(next ? next.t : entry.s)}`);
        if (nextV !== undefined) path.push(`V${y(nextV)}`);
      });

      svg.appendChild(this.createSvgEl("path", { d: path.join(""), stroke: color, class: "alza-price-tracker-history-line" }));

      // Body v místech změny
      entries.forEach((entry, i) => {
        const v = entry.p[type];
        if (v === undefined || (i > 0 && entries[i - 1].p[type] === v)) return;
        svg.appendChild(this.createSvgEl("circle", { cx: x(entry.t), cy: y(v), r: 3, fill: color }));
      });
    });

    // Hover – svislá čára + tooltip se stavem v daném okamžiku
    const cursor = this.createSvgEl("line", {
      y1: m.t,
      y2: bandY + bandH,
      class: "alza-price-tracker-history-cursor",
      visibility: "hidden",
    });
    const overlay = this.createSvgEl("rect", {
      x: m.l,
      y: m.t,
      width: plotW,
      height: bandY + bandH - m.t,
      fill: "transparent",
    });
    svg.append(cursor, overlay);

    const wrap = this.createEl("div", "alza-price-tracker-history-chart");
    const tooltip = this.createEl("div", "alza-price-tracker-history-tooltip");
    wrap.append(svg, tooltip);

    overlay.addEventListener("mousemove", (event) => {
      const svgRect = svg.getBoundingClientRect();
      const px = ((event.clientX - svgRect.left) / svgRect.width) * W;
      const t = t0 + ((px - m.l) / plotW) * (t1 - t0);
      let index = 0;
      entries.forEach((entry, i) => {
        if (entry.t <= t) index = i;
      });

      cursor.setAttribute("x1", px);
      cursor.setAttribute("x2", px);
      cursor.setAttribute("visibility", "visible");

      this.fillHistoryTooltip(tooltip, entries[index], types);
      tooltip.style.display = "block";
      const wrapRect = wrap.getBoundingClientRect();
      let left = event.clientX - wrapRect.left + 14;
      if (left + tooltip.offsetWidth > wrapRect.width) left -= tooltip.offsetWidth + 28;
      tooltip.style.left = `${Math.max(0, left)}px`;
    });
    overlay.addEventListener("mouseleave", () => {
      cursor.setAttribute("visibility", "hidden");
      tooltip.style.display = "none";
    });

    return wrap;
  },

  fillHistoryTooltip(tooltip, entry, types) {
    tooltip.textContent = "";
    const range =
      entry.t === entry.s
        ? this.formatDateTime(entry.t)
        : `${this.formatDateTime(entry.t)} – ${this.formatDateTime(entry.s)}`;
    tooltip.appendChild(this.createEl("div", "alza-price-tracker-history-tooltip-date", range));

    types.forEach((type) => {
      if (entry.p[type] === undefined) return;
      const row = this.createEl("div", "alza-price-tracker-history-tooltip-row");
      const swatch = this.createEl("span", "alza-price-tracker-history-swatch");
      swatch.style.background = this.getHistoryColor(type);
      row.append(
        swatch,
        this.createEl("span", null, this.translate(`type_${type}`)),
        this.createEl("strong", null, this.formatPrice(entry.p[type]))
      );
      tooltip.appendChild(row);
    });

    if (entry.a !== null) {
      const row = this.createEl("div", "alza-price-tracker-history-tooltip-row");
      const swatch = this.createEl("span", "alza-price-tracker-history-swatch alza-price-tracker-history-swatch-band");
      swatch.style.background = this.getAvailabilityColor(entry.a);
      row.append(swatch, this.createEl("span", null, this.getAvailabilityLabel(entry.a)));
      tooltip.appendChild(row);
    }
  },

  // Tabulka změn – nejnovější nahoře, změněné hodnoty zvýrazněné šipkou
  createHistoryTable(entries) {
    const types = this.getHistoryTypes(entries);
    const wrap = this.createEl("div", "alza-price-tracker-history-table-wrap");
    const table = this.createEl("table", "alza-price-tracker-history-table");

    const headRow = document.createElement("tr");
    [
      this.translate("colFrom"),
      this.translate("colTo"),
      ...types.map((type) => this.translate(`type_${type}`)),
      this.translate("colAvailability"),
    ].forEach((label) => headRow.appendChild(this.createEl("th", null, label)));
    table.createTHead().appendChild(headRow);

    const tbody = table.createTBody();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const prev = entries[i - 1];
      const row = tbody.insertRow();

      row.appendChild(this.createEl("td", null, this.formatDateTime(entry.t)));
      row.appendChild(this.createEl("td", null, this.formatDateTime(entry.s)));

      types.forEach((type) => {
        const v = entry.p[type];
        const prevV = prev?.p[type];
        const cell = this.createEl("td");
        if (v === undefined) {
          cell.textContent = "–";
        } else {
          let prefix = "";
          const tooltip = [];
          if (prevV !== undefined && v !== prevV) {
            cell.className = v > prevV ? "alza-price-tracker-history-up" : "alza-price-tracker-history-down";
            prefix = v > prevV ? "▲ " : "▼ ";
            tooltip.push(this.getPriceChangeText(prevV, v));
          }
          // Sleva oproti vyšším cenám ve stejném řádku (jako tooltip v přehledu)
          types
            .filter((other) => entry.p[other] > v)
            .forEach((other) =>
              tooltip.push(`${this.translate(`type_${other}`)}: ${this.getDiscountText(entry.p[other], v)}`)
            );
          if (tooltip.length > 0) cell.title = tooltip.join("\n");
          cell.textContent = `${prefix}${this.formatPrice(v)}`;
        }
        row.appendChild(cell);
      });

      const availabilityCell = this.createEl("td", null, this.getAvailabilityLabel(entry.a));
      if (prev && prev.a !== null && entry.a !== null && prev.a !== entry.a) {
        availabilityCell.title = this.translate("availabilityChangedFrom", this.getAvailabilityLabel(prev.a));
      }
      row.appendChild(availabilityCell);
    }

    wrap.appendChild(table);
    return wrap;
  },
});
