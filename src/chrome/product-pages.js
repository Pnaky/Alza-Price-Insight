// Stránka produktu pro službu na pozadí v Chromu: service worker nemá DOMParser, stránku proto stáhne
// a rozebere offscreen dokument (offscreen/, fetchProductPage ze shared/product-page.js).
const ProductPages = {
  async open() {
    // Dokument už existuje (např. z přerušeného běhu)
    const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (existing.length > 0) return;
    try {
      await chrome.offscreen.createDocument({
        url: "src/chrome/offscreen/offscreen.html",
        reasons: ["DOM_PARSER"],
        justification: "Parsování stránky produktu Alza při kontrole cen na pozadí",
      });
    } catch (error) {
      // Souběžné vytvoření – druhý pokus skončí touto chybou
      if (!String(error?.message).includes("single offscreen")) throw error;
    }
  },

  fetch(url) {
    return chrome.runtime.sendMessage({ target: "offscreen", action: "checkProduct", url });
  },

  // Stránka akce s cashbackem jako text (fetchTermsPage)
  terms(url) {
    return chrome.runtime.sendMessage({ target: "offscreen", action: "termsPage", url });
  },

  async close() {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // nebyl otevřený
    }
  },
};
