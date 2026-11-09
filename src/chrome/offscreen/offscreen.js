// Offscreen dokument pro službu na pozadí v Chromu: service worker nemá DOMParser, stránku produktu
// proto stáhne a rozebere tento dokument (fetchProductPage ze shared/product-page.js).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") return;
  // Stránka akce s cashbackem – lhůty registrace (fetchTermsPage)
  if (message.action === "termsPage") {
    fetchTermsPage(message.url).then(sendResponse);
    return true;
  }
  if (message.action !== "checkProduct") return;

  fetchProductPage(message.url).then(sendResponse);
  return true; // odpověď přijde asynchronně
});
