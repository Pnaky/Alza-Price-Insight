// Stránka produktu pro stránku na pozadí v Safari: stejně jako Firefox má DOMParser, fetchProductPage
// (shared/product-page.js) proto běží přímo – bez offscreen dokumentu.
//
// Safari (WebKit) uspí nestálou stránku na pozadí po 30 s bez události. Volání API doplňku (trik z Firefoxu
// s getPlatformInfo) odpočet neprodlouží – runtime.sendMessage ano: WebKit kvůli doručení zprávy „probudí“
// stránku na pozadí a odpočet spustí znovu (WebExtensionContext::wakeUpBackgroundContentIfNecessary).
// Dokud ProductPages někdo používá, pošle proto každých 10 s zprávu, kterou nikdo nezpracuje. Po uvolnění
// ještě minutu – na konci běhu se stahují obrázky do notifikací a termíny cashbacku.
const SAFARI_KEEP_ALIVE_INTERVAL_MS = 10000;
const SAFARI_KEEP_ALIVE_LINGER_MS = 60000;
let safariKeepAliveTimer = null;
let safariKeepAliveStop = null;

function safariKeepAlivePing() {
  // Žádný posluchač na zprávu neodpoví (akci nikdo nezná) – odmítnutí nevadí
  chrome.runtime.sendMessage({ action: "safariKeepAlive" }).catch(() => {});
}

const ProductPages = {
  async open() {
    clearTimeout(safariKeepAliveStop);
    safariKeepAliveStop = null;
    if (safariKeepAliveTimer) return;
    safariKeepAlivePing();
    safariKeepAliveTimer = setInterval(safariKeepAlivePing, SAFARI_KEEP_ALIVE_INTERVAL_MS);
  },
  fetch: (url) => fetchProductPage(url),
  terms: (url) => fetchTermsPage(url), // Stránka akce s cashbackem jako text
  async close() {
    clearTimeout(safariKeepAliveStop);
    safariKeepAliveStop = setTimeout(() => {
      clearInterval(safariKeepAliveTimer);
      safariKeepAliveTimer = null;
      safariKeepAliveStop = null;
    }, SAFARI_KEEP_ALIVE_LINGER_MS);
  },
};
