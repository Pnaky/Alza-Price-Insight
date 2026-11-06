// Kontrola produktu na pozadí: stáhne stránku produktu (s cookies přihlášeného uživatele) a vytáhne
// z ní ceny a dostupnost stejným parserem jako content script. Potřebuje DOMParser – v Chromu proto
// běží v offscreen dokumentu (src/chrome/offscreen/), ve Firefoxu přímo na stránce na pozadí.
const PRODUCT_FETCH_TIMEOUT_MS = 20000;

// Nikdy nevyhodí chybu – výsledek je vždy { ok, … } nebo { ok: false, error, status } (status 0 = síť /
// timeout; AlzaCore.isRetryableFetchError rozhodne o opakování). Používá kontrola na pozadí i seznam
// (content.js – zprávou fetchProductPage, ať se HTML neparsuje na hlavním vlákně stránky)
async function fetchProductPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PRODUCT_FETCH_TIMEOUT_MS);

  try {
    // Cookies přihlášeného uživatele se smí poslat jen Alze (i po přesměrování)
    if (!AlzaCore.isAlzaUrl(url)) return { ok: false, status: 0, error: "URL mimo Alzu" };
    const response = await fetch(url, { credentials: "include", signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    if (!AlzaCore.isAlzaUrl(response.url)) return { ok: false, status: 0, error: "přesměrováno mimo Alzu" };

    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const prices = AlzaCore.extractPricesFromDocument(doc);
    return {
      ok: true,
      saveProblem: AlzaCore.getSaveProblem(doc, prices), // nepřihlášen / ceny bez DPH → nic neukládat
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
