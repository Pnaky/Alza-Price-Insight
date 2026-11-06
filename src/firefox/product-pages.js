// Stránka produktu pro stránku na pozadí ve Firefoxu: má DOMParser, fetchProductPage
// (shared/product-page.js) proto běží přímo – bez offscreen dokumentu, který Firefox nemá.
//
// Firefox uspí stránku na pozadí po 30 s bez volání API doplňku a zápisy do storage.local, fetch ani
// setTimeout se nepočítají (ověřeno pokusem) – kontrola všech produktů by skončila uprostřed bez logu
// a notifikací. Dokud běží, proto každých 10 s zavolá neškodné API, které uspání odloží.
const KEEP_ALIVE_INTERVAL_MS = 10000;
let keepAliveTimer = null;

const ProductPages = {
  async open() {
    keepAliveTimer ??= setInterval(() => chrome.runtime.getPlatformInfo(), KEEP_ALIVE_INTERVAL_MS);
  },
  fetch: (url) => fetchProductPage(url),
  async close() {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  },
};
