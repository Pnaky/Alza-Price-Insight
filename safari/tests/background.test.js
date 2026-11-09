// Stránka na pozadí pro Safari (skripty z manifestu v jeho pořadí, bez chrome.notifications):
// načtení bez chyby, notifikace přes nativní aplikaci, udržení při kontrole, stav povolení notifikací
(async () => {
  const { check, finish, fail, mock } = window.__test;
  const notifies = () => mock.native.filter((message) => message.type === "notify");

  try {
    await mock.advance(1000);
    check("skripty na pozadí se načetly bez chyby", mock.errors.length === 0, mock.errors.join("\n    "));
    check("chrome.notifications nahrazené mostem do aplikace", chrome.notifications?.safariNativeBridge === true);
    check("background.js se přihlásil k onClicked / onClosed (bez pádu)", chrome.notifications.onClicked.hasListeners() && chrome.notifications.onClosed.hasListeners());
    await mock.until(() => mock.alarms.has("alzaWatchRun"));
    check("naplánovaná kontrola cen (alarm alzaWatchRun)", mock.alarms.has("alzaWatchRun"), JSON.stringify([...mock.alarms.keys()]));
    check("ikona rozšíření nastavená (titulek, číslo)", mock.badge.some((entry) => entry.title === "Alza Price Insight"), JSON.stringify(mock.badge));

    // === Zkušební notifikace (tlačítko v průvodci a v nastavení) ===
    mock.native.length = 0;
    mock.dispatchMessage({ action: "watchTestNotifications" });
    await mock.until(() => notifies().length >= 3, 400);
    let sent = notifies();
    check("3 zkušební notifikace došly do aplikace", sent.length === 3, JSON.stringify(sent.map((message) => message.title)));
    check("každá má cíl kliknutí na Alze", sent.length > 0 && sent.every((message) => message.url === "https://www.alza.cz"), sent.map((message) => message.url).join(", "));
    check("notifikace má titulek a text", sent.length > 0 && sent.every((message) => message.title && message.message));
    check("první má náhled produktu (PNG jako data URL)", String(sent[0]?.image).startsWith("data:image/png;base64,"), String(sent[0]?.image).slice(0, 48));
    check("souhrn a problém jsou bez náhledu", sent.length === 3 && !sent[1].image && !sent[2].image);
    await mock.advance(500);
    check("cíle kliknutí se ze storage.session uklidily", Object.keys(mock.session).length === 0, Object.keys(mock.session).join(", "));

    // === Aplikace náhled odmítne → background.js zkusí notifikaci znovu bez obrázku, s cílem kliknutí ===
    mock.native.length = 0;
    mock.nativeReply = (message) => (message.type === "notify" && message.image ? { ok: false, error: "test: image rejected" } : { ok: true });
    mock.dispatchMessage({ action: "watchTestNotifications" });
    await mock.until(() => notifies().length >= 4, 400);
    sent = notifies();
    check("po odmítnutí náhledu druhý pokus bez něj", Boolean(sent[0]?.image) && !sent[1]?.image && sent[1]?.title === sent[0]?.title, JSON.stringify(sent.map((m) => [m.title, Boolean(m.image)])));
    check("druhý pokus má pořád cíl kliknutí", sent[1]?.url === "https://www.alza.cz", String(sent[1]?.url));

    // === Aplikace neodpovídá (např. smazaná) → chyba zůstane v background.js, nic nespadne ===
    mock.native.length = 0;
    mock.nativeReply = () => {
      throw new Error("test: native app missing");
    };
    const errorsBefore = mock.errors.length;
    mock.dispatchMessage({ action: "watchTestNotifications" });
    // Pokus + pokus bez náhledu u prvního produktu, pak souhrn – jeho chyba zastaví zbytek ukázky
    await mock.until(() => notifies().length >= 3, 400);
    await mock.advance(3000);
    check("bez aplikace žádná neošetřená výjimka", mock.errors.slice(errorsBefore).every((error) => !error.startsWith("unhandled")), mock.errors.slice(errorsBefore).join("\n    "));
    mock.nativeReply = null;

    // === Udržení stránky na pozadí (WebKit ji jinak po 30 s bez události uspí) ===
    const pings = () => mock.sent.filter((message) => message?.action === "safariKeepAlive").length;
    mock.sent.length = 0;
    await ProductPages.open();
    await mock.advance(35000);
    check("během kontroly zpráva hned a pak každých 10 s", pings() === 4, `zpráv: ${pings()}`);
    await ProductPages.open(); // druhý uživatel (otevřený seznam) – nový časovač nevzniká
    await mock.advance(10000);
    check("souběžné použití nespouští druhý časovač", pings() === 5, `zpráv: ${pings()}`);
    await ProductPages.close();
    await mock.advance(55000);
    const lingering = pings();
    check("po uvolnění ještě minutu", lingering >= 10, `zpráv: ${lingering}`);
    await mock.advance(40000);
    check("potom se zastaví", pings() === lingering, `zpráv: ${pings()} (předtím ${lingering})`);

    // === Stav povolení notifikací (průvodce) ===
    for (const [level, expected] of [["granted", "granted"], ["denied", "denied"], ["notDetermined", undefined], ["provisional", "granted"]]) {
      mock.nativeReply = (message) => (message.type === "permission" ? { ok: true, level } : { ok: true });
      const result = await chrome.notifications.getPermissionLevel();
      check(`getPermissionLevel: ${level} → ${expected}`, result === expected, String(result));
    }
    mock.nativeReply = null;

    // === Zprávy pro nativní aplikaci mají jen očekávaná pole ===
    mock.native.length = 0;
    await chrome.notifications.create("t1", { type: "basic", title: "A", message: "B", iconUrl: chrome.runtime.getURL("img/icon-128.png") });
    check("ikona rozšíření se aplikaci neposílá (jen data URL)", mock.native[0]?.image === null && mock.native[0]?.url === null, JSON.stringify(mock.native[0]));
    check("clear() smaže notifikaci v aplikaci", (await chrome.notifications.clear("t1")) === true && mock.native.at(-1)?.type === "clear");

    await mock.advance(1000);
    check("žádné chyby během testu", mock.errors.length === 0, mock.errors.join("\n    "));
    finish();
  } catch (error) {
    fail(error);
  }
})();
