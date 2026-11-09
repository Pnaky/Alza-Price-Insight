# Alza Price Insight pro Safari

Safari na macOS načítá rozšíření z aplikace, ne ze složky jako Chrome nebo Firefox. Složka `safari/` proto ze stejných souborů rozšíření (`src/`, `css/`, `img/`, `_locales/`) sestaví aplikaci **Alza Price Insight.app** – obal, ve kterém je rozšíření, a zároveň odesílatele notifikací. Rozšíření umí v Safari totéž co v Chrome a Firefoxu.

Jde o experimentální verzi: aplikaci si každý sestaví na vlastním Macu, v App Storu není.

Požadavky: macOS 13 nebo novější, Safari 18 nebo novější, Command Line Tools (`xcode-select --install`). Xcode potřeba není.

## Sestavení a instalace

```bash
safari/build.sh --install
```

Sestaví `safari/build/Alza Price Insight.app`, nainstaluje ji do `~/Applications`, zaregistruje rozšíření v Safari a aplikaci spustí. Bez `--install` jen sestaví. Aktualizace: `git pull` a stejný příkaz znovu.

Do průvodce nastavením (`src/welcome/welcome.html`) vkládá `safari/tools/prepare.py` dva skripty pro Safari podle přesného textu. Když se změní, sestavení skončí srozumitelnou chybou místo nefunkčního rozšíření. Ostatní soubory rozšíření zůstávají beze změny.

Volby: `SIGN_IDENTITY` (podpis, viz níže), `BUNDLE_ID` (výchozí `local.AlzaPriceInsight`), `INSTALL_DIR` (výchozí `~/Applications`), `BUILD_DIR`, `NO_OPEN=1` (po instalaci nespouštět aplikaci), `safari/build.sh --help`.

## Zapnutí v Safari

1. Spusťte aplikaci **Alza Price Insight** a povolte jí notifikace.
2. Safari → Nastavení → Rozšíření → zaškrtněte **Alza Price Insight**.
3. V průvodci nastavením klikněte nahoře na **Povolit přístup na Alzu** a zvolte **Vždy povolit** (případně Safari → Nastavení → Rozšíření → Alza Price Insight → Upravit webové stránky).

Aplikace bez vývojářského certifikátu je podepsaná jen „ad hoc“ a Safari ji načte, až v Nastavení → Pokročilé zapnete **Zobrazit funkce pro webové vývojáře** a v Nastavení → Vývojář **Povolit nepodepsaná rozšíření**. Tuto volbu Safari po každém ukončení vypne – natrvalo to vyřeší podpis.

## Podpis certifikátem

Rozšíření podepsané certifikátem Apple Development Safari načte vždy. Stačí bezplatný Apple ID účet:

1. Xcode → Settings → Accounts → přidejte Apple ID → **Manage Certificates…** → **+** → **Apple Development**.
2. `security find-identity -v -p codesigning` má vypsat `1 valid identities found`. Když vypíše `0 valid identities found`, chybí v klíčence mezicertifikát Apple **WWDR G3**: otevřete <https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer> a stažený soubor otevřete dvojklikem.
3. `safari/build.sh --install` – jediný platný certifikát Apple Development najde sám (jinak `SIGN_IDENTITY="Apple Development: …"`).

Safari bere podepsanou verzi jako jiné rozšíření než nepodepsanou (s vlastními daty) – před přechodem si v nastavení rozšíření udělejte **zálohu (JSON)**. Certifikát platí rok, aktualizace podepisujte certifikátem stejného týmu.

Pro instalaci u ostatních bez sestavení by aplikace musela projít App Storem nebo notarizací (placený Apple Developer Program).

## Co je v Safari jinak

| | Chrome / Firefox | Safari |
|---|---|---|
| Služba na pozadí | service worker + offscreen dokument (Chrome), stránka na pozadí (Firefox) | nestálá stránka na pozadí jako ve Firefoxu (má `DOMParser`), vlastní manifest z `manifest.json` (`prepare.py`) |
| Uspání pozadí | Firefox po 30 s bez volání API | WebKit po 30 s bez události – volání API odpočet neprodlouží. Během kontroly cen se proto každých 10 s pošle `runtime.sendMessage`, která stránku na pozadí „probudí“ a odpočet obnoví (`WebExtensionContext::wakeUpBackgroundContentIfNecessary`) |
| Notifikace | `chrome.notifications` | Safari je rozšířením nedává – `notifications.js` je nahradí mostem do aplikace (`runtime.sendNativeMessage` → `SafariWebExtensionHandler`), i s náhledem produktu. Kliknutí obslouží aplikace a otevře produkt v Safari (jen https www.alza.cz/sk/hu). Když API notifikací v Safari bude, použije se jeho vlastní |
| Přístup na web | při instalaci | uživatel ho musí schválit – průvodce má výzvu s tlačítkem (`permissions.request`) |
| Ikona na liště | připíná se | Safari ji po zapnutí dá na lištu sám – texty průvodce pro Safari |
| Cookies přihlášení | ano | ano – WebKit stránkám rozšíření uvolňuje blokování cookies třetích stran (`_shouldRelaxThirdPartyCookieBlocking`) |

Oprávnění `nativeMessaging` je jen v manifestu pro Safari – Chrome by ho při aktualizaci ohlásil jako nové oprávnění.

## Struktura

| Cesta | Co v ní je |
|---|---|
| `src/safari/` | kód rozšíření jen pro Safari: `product-pages.js` (stránka na pozadí + udržení), `notifications.js` (notifikace přes aplikaci), `welcome-safari.js` (texty průvodce, výzva k přístupu na Alzu) |
| `tools/prepare.py` | soubory rozšíření pro Safari: manifest a vložení skriptů do průvodce |
| `macos/` | aplikace (okno s postupem a stavem, kliknutí na notifikaci), nativní část rozšíření (`SafariWebExtensionHandler.swift`), ikona |
| `tests/` | testy ve WebKitu a nativní části |
| `build.sh` | sestavení, podpis a instalace |

## Testy

```bash
safari/tests/run.sh
```

Spustí stránku na pozadí a průvodce ve WKWebView (WebKit – stejný engine jako Safari) s napodobeným API Safari bez `chrome.notifications`: načtení bez chyby, notifikace přes aplikaci (náhled, cíl kliknutí, opakování bez náhledu, aplikace neodpovídá), udržení pozadí během kontroly, stav povolení notifikací, výzvu k přístupu na Alzu a texty pro Safari. Nativní testy hlídají, které adresy smí kliknutí na notifikaci otevřít, a rozbor náhledu produktu.

## Odinstalace

V Safari → Nastavení → Rozšíření vypněte Alza Price Insight (data si předtím můžete zálohovat v nastavení rozšíření) a smažte `~/Applications/Alza Price Insight.app`. Soubory aplikace zůstanou v `~/Library/Containers/local.AlzaPriceInsight*`.
