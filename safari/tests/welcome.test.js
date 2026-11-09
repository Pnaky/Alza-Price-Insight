// Průvodce nastavením v Safari: načtení bez chyby, výzva k povolení přístupu na Alzu, texty pro Safari a macOS,
// stav notifikací z aplikace (safari/notifications.js)
(async () => {
  const { check, finish, fail, mock } = window.__test;
  const text = (selector) => document.querySelector(selector)?.textContent.trim() || "";
  const status = (name) => text(`#checks [data-check="${name}"] .check-status`);
  const help = (name) => text(`#checks [data-check="${name}"] .check-help`);

  try {
    await mock.until(() => text('[data-w="safariAccessTitle"]') !== "");
    check("průvodce se načetl bez chyby", mock.errors.length === 0, mock.errors.join("\n    "));
    check("náhrada chrome.notifications je i v průvodci", chrome.notifications?.safariNativeBridge === true);

    // === Výzva k povolení přístupu na Alzu ===
    const title = document.querySelector('[data-w="safariAccessTitle"]');
    const box = title?.closest(".summary");
    await mock.until(() => box && !box.hidden);
    check("bez přístupu na Alzu je nahoře výzva", box && !box.hidden && title.textContent === "Povolte rozšíření přístup na Alzu", title?.textContent);
    check("výzva je nad první kartou průvodce", box?.parentElement?.matches("main.card") && box.parentElement.firstElementChild === box);
    box.querySelector("button").click();
    await mock.until(() => box.hidden);
    const requested = mock.permissionRequests[0]?.origins || [];
    check("tlačítko požádá o všechny weby z manifestu", requested.length === 6 && requested.includes("https://www.alza.cz/*") && requested.includes("https://image.alza.hu/*"), JSON.stringify(requested));
    check("po povolení výzva zmizí", box.hidden);

    // Zamítnutí → nápověda, kde přístup povolit ručně
    mock.permissionsGranted = false;
    mock.permissionsRequestResult = false;
    chrome.permissions.onRemoved.listeners.forEach((listener) => listener({ origins: requested }));
    await mock.until(() => !box.hidden);
    box.querySelector("button").click();
    const denied = box.querySelector('[data-w="safariAccessDenied"]');
    await mock.until(() => denied && !denied.hidden);
    check("po zamítnutí nápověda k ručnímu povolení", denied && !denied.hidden && denied.textContent.includes("Upravit webové stránky"), denied?.textContent);

    // === Ověření (krok 1): notifikace a ikona na liště podle Safari ===
    mock.nativeReply = (message) => (message.type === "permission" ? { ok: true, level: "granted" } : { ok: true });
    document.querySelector('[data-go="check"]')?.click();
    document.getElementById("runCheck").click();
    await mock.until(() => status("notifications") && status("notifications") !== "Ověřuji…" && status("pin") !== "Ověřuji…", 400);
    check("notifikace: stav z aplikace", status("notifications") === "Notifikace jsou v macOS povolené", status("notifications"));
    check("notifikace: nápověda pro macOS", help("notifications").includes("Nastavení systému → Oznámení → Alza Price Insight"), help("notifications"));
    check("ikona na liště: tip pro Safari", status("pin") === "Tip: mějte ikonu na liště Safari", status("pin"));
    check("ikona na liště: bez dílku skládačky z Chrome", help("pin").includes("Upravit nástrojový panel") && !help("pin").includes("skládačky"), help("pin"));

    mock.nativeReply = (message) => (message.type === "permission" ? { ok: true, level: "denied" } : { ok: true });
    document.getElementById("runCheck").click();
    await mock.until(() => status("notifications") === "Notifikace jsou zakázané", 400);
    check("zakázané notifikace v macOS průvodce pozná", status("notifications") === "Notifikace jsou zakázané", status("notifications"));

    // Jiný jazyk průvodce – texty pro Safari i výzva v angličtině
    const language = document.getElementById("language");
    language.value = "en";
    language.dispatchEvent(new Event("change", { bubbles: true }));
    await mock.until(() => title.textContent === "Allow the extension to access Alza");
    check("výzva se přeloží s průvodcem", title.textContent === "Allow the extension to access Alza", title.textContent);

    await mock.settle(10);
    check("žádné chyby během testu", mock.errors.length === 0, mock.errors.join("\n    "));
    finish();
  } catch (error) {
    fail(error);
  }
})();
