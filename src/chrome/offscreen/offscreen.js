// Offscreen dokument pro službu na pozadí v Chromu: service worker nemá DOMParser, stránku produktu
// proto stáhne a rozebere tento dokument (fetchProductPage ze shared/product-page.js).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen" || message.action !== "checkProduct") return;

  fetchProductPage(message.url).then(sendResponse);
  return true; // odpověď přijde asynchronně
});
