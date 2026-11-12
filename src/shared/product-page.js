// Kontrola produktu na pozadí: stáhne stránku produktu (s cookies přihlášeného uživatele) a vytáhne
// z ní ceny a dostupnost stejným parserem jako content script. Potřebuje DOMParser – v Chromu proto
// běží v offscreen dokumentu (src/chrome/offscreen/), ve Firefoxu přímo na stránce na pozadí.
const PRODUCT_FETCH_TIMEOUT_MS = 20000;

// Nikdy nevyhodí chybu – výsledek je vždy { ok, … } nebo { ok: false, error, status, offsite? } (status 0 = síť /
// timeout; AlzaCore.isRetryableFetchError rozhodne o opakování). Používá kontrola na pozadí i seznam
// (content.js – zprávou fetchProductPage, ať se HTML neparsuje na hlavním vlákně stránky)
async function fetchProductPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PRODUCT_FETCH_TIMEOUT_MS);

  try {
    // Cookies přihlášeného uživatele se smí poslat jen Alze (i po přesměrování)
    if (!AlzaCore.isAlzaUrl(url)) return { ok: false, status: 0, offsite: true, error: "URL mimo Alzu" };
    const response = await fetch(url, { credentials: "include", signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    if (!AlzaCore.isAlzaUrl(response.url)) return { ok: false, status: 0, offsite: true, error: "přesměrováno mimo Alzu" };

    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const prices = AlzaCore.extractPricesFromDocument(doc);
    return {
      ok: true,
      saveProblem: AlzaCore.getSaveProblem(doc, prices), // nepřihlášen / ceny bez DPH → nic neukládat
      vatSignMissing: AlzaCore.isVatSignMissing(doc), // Zboží bez DPH (knihy) – volající dořeší AlzaCore.resolveSaveProblem
      isProduct: AlzaCore.isProductDocument(doc),
      name: AlzaCore.getProductName(doc),
      image: AlzaCore.getProductImage(doc),
      prices,
      availability: AlzaCore.extractAvailabilityFromDocument(doc),
      // Metaúdaje záznamu ceny pro seznam (cena za kus, množstevní slevy, jiný stav produktu)
      packCount: AlzaCore.getDocumentPackCount(doc, prices),
      quantityTiers: AlzaCore.getDocumentQuantityTiers(doc),
      conditions: AlzaCore.getDocumentConditions(doc, url),
    };
  } catch (error) {
    return { ok: false, status: 0, error: error?.name === "AbortError" ? "timeout" : String(error?.message || error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Stránka akce s cashbackem (článek Alzy) jako prostý text – termíny akce čte AlzaCore.readCashbackTerms.
// Text po textových uzlech s mezerou, ať se sousední prvky neslepí („31. 01. 2027Canon“). Nikdy nevyhodí chybu
async function fetchTermsPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PRODUCT_FETCH_TIMEOUT_MS);
  try {
    if (!AlzaCore.isAlzaUrl(url)) return { ok: false, status: 0, offsite: true, error: "URL mimo Alzu" };
    const response = await fetch(url, { credentials: "include", signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    if (!AlzaCore.isAlzaUrl(response.url)) return { ok: false, status: 0, offsite: true, error: "přesměrováno mimo Alzu" };
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    // Jen skripty a styly – článek akce bývá i uvnitř <header> (AEG: header.or-header), hlavičku webu nechat.
    // Na začátek popis stránky – bývá v něm platnost akce („Akce platí od 2. 11. 2026 do 3. 1. 2027“)
    doc.querySelectorAll("script, style, noscript, template").forEach((element) => element.remove());
    const parts = [doc.querySelector('meta[name="description"]')?.getAttribute("content") || ""];
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
    return { ok: true, text: parts.join(" ").replace(/\s+/g, " ").slice(0, 200000) };
  } catch (error) {
    return { ok: false, status: 0, error: error?.name === "AbortError" ? "timeout" : String(error?.message || error) };
  } finally {
    clearTimeout(timeoutId);
  }
}
