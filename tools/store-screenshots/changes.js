// Přehled změn pro popup a notifikace – texty skládá jádro rozšíření, takže odpovídají skutečným notifikacím
(() => {
  const now = Date.now();
  const M = window.MARKET;
  const c = M.conv;
  const P = window.__products;
  const lang = AlzaCore.getDisplayLanguage(window.__store.alzaSettings, AlzaCore.domains[M.domain].lang);
  const fmt = (price) => AlzaCore.formatPrice(price, M.domain);
  const t = (key, ...params) => AlzaCore.translate(lang, key, ...params);
  const drop = (type, from, to) => AlzaCore.formatPriceDrop(lang, t(`type_${type}`), from, to, M.domain);

  const lines = {
    headphones: [drop("applus", c(2799), c(2399)), t("notifyNewPrice", t("type_special"), fmt(c(2499)))],
    watch: [t("notifyTargetReached", fmt(c(3990)), fmt(c(3890))), drop("special", c(4190), c(3890))],
    keyboard: [t("notifyAvailability", AlzaCore.getAvailabilityLabel("order", lang), AlzaCore.getAvailabilityLabel("in", lang))],
  };
  const prices = { headphones: c(2399), watch: c(3890), keyboard: c(2199) };
  const minutes = { headphones: 8, watch: 8, keyboard: 190 };
  const key = (p) => AlzaCore.getProductKey(M.domain, p.url);
  const listUrl = `https://${M.host}/Order1.htm?listId=1`;

  window.__changes = lines;
  window.__store.alzaWatchState = {
    lastRunStart: now - 9 * 60000, lastRunEnd: now - 8 * 60000, checked: 7, changes: [1, 2, 3], problems: [],
    unseen: [key(P.headphones), key(P.watch)],
    recent: Object.keys(lines).map((k) => ({
      key: key(P[k]), at: now - minutes[k] * 60000, name: P[k].name, url: P[k].url, image: null,
      price: fmt(prices[k]), listName: M.lists[0], listUrl, lines: lines[k],
    })),
  };
})();
