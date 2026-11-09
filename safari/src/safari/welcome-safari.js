// Safari: úpravy průvodce nastavením. Načítá se hned za welcome-texts.js (před welcome.js).
// - Texty o notifikacích a ikoně na liště popisují Chrome / Windows – nahradí je postup pro Safari a macOS.
//   Notifikace v Safari posílá aplikace Alza Price Insight (safari/notifications.js), ikona se nepřipíná.
// - Safari rozšíření na weby nepustí, dokud to uživatel neschválí. Bez přístupu na Alzu rozšíření nic neukáže
//   ani nezkontroluje na pozadí – nad průvodcem se proto ukáže výzva s tlačítkem (permissions.request).
(() => {
  if (typeof WELCOME_TEXTS === "undefined") return;

  const safari = {
    cz: {
      checkNotificationsOk: "Notifikace jsou v macOS povolené",
      checkNotificationsHelp:
        "V Safari notifikace posílá aplikace Alza Price Insight. Klikněte na Vyzkoušet notifikace v kroku 3. Když nic nepřijde, povolte je v Nastavení systému → Oznámení → Alza Price Insight a vypněte režim Soustředění.",
      checkPinTip: "Tip: mějte ikonu na liště Safari",
      checkPinHelp:
        "Safari po zapnutí rozšíření přidá jeho ikonu na lištu vedle adresního řádku. Když tam není, zvolte Zobrazení → Upravit nástrojový panel… a přetáhněte ji na lištu. Na ikoně pak uvidíte počet změn cen a jedním klikem otevřete přehled.",
      safariAccessTitle: "Povolte rozšíření přístup na Alzu",
      safariAccessText:
        "Safari pustí rozšíření na web, až když to schválíte. Bez přístupu na Alzu se ceny nezobrazí ani nehlídají na pozadí. Klikněte na tlačítko a v nabídce Safari zvolte Vždy povolit.",
      safariAccessButton: "Povolit přístup na Alzu",
      safariAccessDenied:
        "Přístup zatím povolený není. Můžete ho povolit i v Safari → Nastavení → Rozšíření → Alza Price Insight → Upravit webové stránky.",
    },
    sk: {
      checkNotificationsOk: "Notifikácie sú v macOS povolené",
      checkNotificationsHelp:
        "V Safari notifikácie posiela aplikácia Alza Price Insight. Kliknite na Vyskúšať notifikácie v kroku 3. Keď nič nepríde, povoľte ich v Systémových nastaveniach → Hlásenia → Alza Price Insight a vypnite režim Sústredenie.",
      checkPinTip: "Tip: majte ikonu na lište Safari",
      checkPinHelp:
        "Safari po zapnutí rozšírenia pridá jeho ikonu na lištu vedľa adresného riadka. Keď tam nie je, zvoľte Zobraziť → Prispôsobiť panel s nástrojmi… a presuňte ju na lištu. Na ikone potom uvidíte počet zmien cien a jedným kliknutím otvoríte prehľad.",
      safariAccessTitle: "Povoľte rozšíreniu prístup na Alzu",
      safariAccessText:
        "Safari pustí rozšírenie na web, až keď to schválite. Bez prístupu na Alzu sa ceny nezobrazia ani nesledujú na pozadí. Kliknite na tlačidlo a v ponuke Safari zvoľte Vždy povoliť.",
      safariAccessButton: "Povoliť prístup na Alzu",
      safariAccessDenied:
        "Prístup zatiaľ povolený nie je. Môžete ho povoliť aj v Safari → Nastavenia → Rozšírenia → Alza Price Insight → Upraviť webové stránky.",
    },
    hu: {
      checkNotificationsOk: "Az értesítések engedélyezve vannak a macOS-ben",
      checkNotificationsHelp:
        "Safariban az értesítéseket az Alza Price Insight alkalmazás küldi. Kattintson az Értesítések kipróbálása gombra a 3. lépésben. Ha nem érkezik semmi, engedélyezze őket a Rendszerbeállítások → Értesítések → Alza Price Insight alatt, és kapcsolja ki a Fókusz módot.",
      checkPinTip: "Tipp: tartsa az ikont a Safari eszközsorán",
      checkPinHelp:
        "A bővítmény bekapcsolása után a Safari a címsor mellé, az eszközsorra teszi az ikonját. Ha nincs ott, válassza a Nézet → Eszközsor testreszabása… menüpontot, és húzza az ikont az eszközsorra. Az ikonon látja az árváltozások számát, és egy kattintással megnyitja az áttekintést.",
      safariAccessTitle: "Engedélyezze a bővítménynek az Alza elérését",
      safariAccessText:
        "A Safari csak az Ön jóváhagyása után engedi a bővítményt a weboldalakra. Az Alza elérése nélkül az árak nem jelennek meg, és a háttérfigyelés sem működik. Kattintson a gombra, és a Safari ablakában válassza a Mindig engedélyez lehetőséget.",
      safariAccessButton: "Alza elérésének engedélyezése",
      safariAccessDenied:
        "A hozzáférés még nincs engedélyezve. A Safari → Beállítások → Bővítmények → Alza Price Insight → Webhelyek szerkesztése alatt is engedélyezheti.",
    },
    en: {
      checkNotificationsOk: "Notifications are allowed in macOS",
      checkNotificationsHelp:
        "In Safari, notifications are sent by the Alza Price Insight app. Click Test notifications in step 3. If nothing shows up, allow them in System Settings → Notifications → Alza Price Insight and turn off Focus.",
      checkPinTip: "Tip: keep the icon on the Safari toolbar",
      checkPinHelp:
        "Once the extension is turned on, Safari adds its icon to the toolbar next to the address bar. If it isn't there, choose View → Customize Toolbar… and drag it to the toolbar. The icon then shows the number of price changes and opens the overview in one click.",
      safariAccessTitle: "Allow the extension to access Alza",
      safariAccessText:
        "Safari only lets an extension onto a website after you approve it. Without access to Alza, prices are not shown and nothing is watched in the background. Click the button and choose Always Allow in Safari's prompt.",
      safariAccessButton: "Allow access to Alza",
      safariAccessDenied:
        "Access is not allowed yet. You can also allow it in Safari → Settings → Extensions → Alza Price Insight → Edit Websites.",
    },
  };

  Object.entries(safari).forEach(([lang, texts]) => {
    if (WELCOME_TEXTS[lang]) Object.assign(WELCOME_TEXTS[lang], texts);
  });

  // === Přístup na Alzu ===
  // Skripty jsou na konci <body> – karta průvodce už existuje. Texty (data-w) doplní welcome.js (applyTexts)
  const card = document.querySelector("main.card");
  const origins = chrome.runtime?.getManifest?.().host_permissions || [];
  if (!card || !chrome.permissions?.contains || origins.length === 0) return;

  // Bez inline display – atribut hidden musí prvek opravdu skrýt
  const box = document.createElement("div");
  box.className = "summary todo";
  box.hidden = true;
  box.style.margin = "0 0 20px";
  const title = document.createElement("strong");
  title.dataset.w = "safariAccessTitle";
  const text = document.createElement("p");
  text.dataset.w = "safariAccessText";
  text.style.margin = "6px 0 10px";
  const denied = document.createElement("p");
  denied.dataset.w = "safariAccessDenied";
  denied.style.margin = "10px 0 0";
  denied.hidden = true;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.dataset.w = "safariAccessButton";
  box.append(title, text, button, denied);
  card.prepend(box);

  const refresh = async () => {
    try {
      box.hidden = await chrome.permissions.contains({ origins });
    } catch {
      box.hidden = true; // Bez odpovědi nic nevnucovat
    }
  };

  button.addEventListener("click", async () => {
    try {
      denied.hidden = await chrome.permissions.request({ origins });
    } catch {
      denied.hidden = false;
    }
    await refresh();
  });

  chrome.permissions.onAdded?.addListener(refresh);
  chrome.permissions.onRemoved?.addListener(refresh);
  refresh();
})();
