# Technický dluh – audit 2026-11-06

Audit celé codebase (content.js, core.js, background.js, options, popup, category, browsing, nápověda, nástroje).
Bezpečnost bez vážného nálezu: žádná tajemství, `innerHTML` jen k mazání, URL přes `isAlzaUrl`, CSV ošetřené proti vzorcům.
Mrtvé funkce nenalezeny (každý člen `AlzaCore` i funkce v options/popup se používá).

Stav: ☐ čeká · ◐ rozpracováno · ☑ hotovo · ✗ nedělá se (důvod u položky)

## Pořadí práce (priorita × rychlost)

1. Rychlé opravy: 11, 2, 4, 5, 28, 25, 26, 27, 21, 19, 18
2. Střední: 6, 7+8, 12, 14, 9, 10
3. Testy core.js (15) → refaktor úložiště (1 + 3) s migrací
4. Úklid: 22, 23, 24, 17, 16 (rozdělení content.js), 13 (nastavení a nápověda), 20

## 🔴 Vysoké

| # | Stav | Kde | Problém | Oprava |
|---|---|---|---|---|
| 1 | ☑ | content.js 1351–1385, 2315–2339, 3534–3594; background.js 276–283, 339–353; browsing.js 170–198; popup.js 217–221; options.js 93–99 | Souběžné read-modify-write sdílených klíčů z více kontextů (záložky, pozadí, popup, nastavení) → ztracené zápisy | Jediný zapisovatel (služba na pozadí, fronta) + klíče po produktech |
| 2 | ☑ | content.js 641–652 → 1390–1424 | Celá `alzaPrices_<doména>` se čte v každém snímku mutace, když zůstane položka bez naší ceny | Mapa v paměti + `storage.onChanged`, pamatovat neobnovitelné položky |
| 3 | ☑ | content.js 1376; background.js 350–353; browsing.js 174–198 | Obří objekty přepisované celé (O(n²) na seznam), fan-out na všechny `onChanged`; `alzaPrices_*` podle URL, zbytek podle čísla produktu | Migrace na klíč za produkt |
| 4 | ☑ | options.js 897–906 | „Smazat všechna data“ smaže i když se záloha nestáhla | Potvrzení uložené zálohy před mazáním |
| 5 | ☑ | options.js 776, 869 | `storage.local.getBytesInUse` ve Firefoxu (pravděpodobně chybí) → tabulka dat se nevykreslí | Kontrola existence, jinak „–“ |

## 🟠 Střední

| # | Stav | Kde | Problém | Oprava |
|---|---|---|---|---|
| 6 | ☑ | content.js 641, 1147, 3617, 3674 | Po aktualizaci rozšíření běží osiřelý content script (observery, chyby, pohlcený klik) | Kontrola `chrome.runtime?.id`, odpojit vše |
| 7 | ☑ | content.js 1018–1035 | `fetchWithRetry` bez timeoutu, opakuje 4xx/429, nekontroluje přesměrování mimo Alzu ani detail | Sdílený fetch s timeoutem a kontrolami, opakovat jen síť/5xx |
| 8 | ☑ | content.js 930 | DOMParser celé stránky produktu na hlavním vlákně Alzy | Parsování v pozadí / offscreen |
| 9 | ☑ | content.js 641, 3617, 1147; category.js 128; browsing.js 59 | Pět observerů na celém body bez filtru vlastních změn | `isOwnMutation`, užší cíle |
| 10 | ☑ | category.js 11–15, 220–233 vs core.js 1240–1269 | Duplicitní parser cen výpisu, už se rozešel | category.js nad `extractPricesFromListingItem` |
| 11 | ☑ | content.js 609, 1914–1935 | Zkracování dostupnosti porovnává texty v jazyce UI místo jazyka domény | `AlzaCore.translate(state.language, …)` |
| 12 | ☑ | options.js, popup.js, content.js (openHistoryDialog, tlačítko hlídání) | Async akce selžou potichu | Obal se zpětnou vazbou |
| 13 | ☑ | options.html, help*.html | Nastavení jen česky, nápověda zastaralá (saveBrowsing nezdokumentované), 4 ručně udržované verze | Opravit texty, i18n nastavení, nápověda z jednoho zdroje |
| 14 | ☑ | options.js 819–827; background.js 49, 531 | `storage.local.get(null)` opakovaně (záložka dat při běhu, start workeru) | Inkrementálně / omezit |
| 15 | ☑ | – | Žádné testy, linter, typy | `node --test` pro core.js, `@ts-check` + JSDoc typedefy, `node --check` v package.js |

## 🟡 Nízké až střední

| # | Stav | Kde | Problém | Oprava |
|---|---|---|---|---|
| 16 | ☑ | content.js | 3,7k řádků, ~10 odpovědností, nedeklarované pole stavu | Rozdělit na soubory (sdílený scope) |
| 17 | ☑ | core.js 214, content.js 609, category.js 153, popup.js 126, background.js 506 | Čtyři `translate`, různé fallbacky, `cz`/`cs`; bez kontroly parity klíčů | Jedna funkce, jedna mapa jazyků, skript parity |
| 18 | ☑ | core.js 600, 419; content.js 2373, 2391, 1853, 1876 | Nejednotné čtení čísel a procent („-0 %“) | Jeden parser, všude `formatPercent` |
| 19 | ☑ | options.js 293–322, 346; content.js 853; popup.js 148, 316 | Mezery ve validaci (import, budoucí `lastUpdated`, doména v popupu) | Doplnit kontroly |
| 20 | ✗ | content.js 1474, 1600, 1829 | Zásahy do uzlů Reactu (nejisté) | Vlastní obal + skrytí CSS |
| 21 | ☑ | content.js 1836 | Šipka závisí na Font Awesome 4 Alzy | SVG / Unicode |

## 🟢 Nízké

| # | Stav | Kde | Problém | Oprava |
|---|---|---|---|---|
| 22 | ☑ | core.js 1221/1304, 1067/1105, 717/1250, 783/1277; literály `alzaPrices_`/`alzaHistory_` | Duplicity v core.js | Extrahovat |
| 23 | ◐ | content.js (rAF 5×, addStat 2×, RMW 4×…), popup/options | Duplicity | Pomocné funkce, `src/shared/ui.js` |
| 24 | ☑ | content.js 1313–1335, 1426–1438, 893–999; popup.js 171–182 | Callback API, Promise anti-pattern, různé chování wrapperů | Promise API, async |
| 25 | ☑ | content.js 2221, 3340 | Pád na null z řetězených querySelector | `?.` / vrátit prvek |
| 26 | ☑ | content.js 1387, 3172, 638, 1988, 2001; core.js 1377 | Osiřelé komentáře, průchozí obaly | Smazat / přesunout |
| 27 | ☑ | options.js 65, 41–54 | `#wipeConfirm` ukládá nastavení; `saveSettings` jen z polí formuláře | Vyjmout z formuláře, sloučit s uloženými |
| 28 | ☑ | tools/package.js 135; tools/store-screenshots | Varování verze při každém buildu; zastaralá verze v mocku | Regex na RRRR.M.D(.N), verze z manifestu |

## Poznámky k provedení

Stav k 2026-11-07 (provedeno v jedné session, neuloženo do commitu):

- **1, 2, 3 – úložiště**: nový `src/shared/store.js` (`AlzaStore`). Zapisuje jen služba na pozadí (fronta); content scripty,
  popup i nastavení posílají operace zprávou (`mergePrices`, `appendHistory`, `recordBrowsing`, `patchMap`, `assign`,
  `recordVatCheck`, `appendErrors`, `removeProducts`, `remove`, `importData`). Ceny po produktech `alzaPrice_<doména>_<id>`
  (dřív jeden objekt `alzaPrices_<doména>`); převod `AlzaStore.migrate()` při startu služby na pozadí, import starých
  záloh převádí `importData`. Content script drží záznamy cen v paměti (`state.priceRecords`, obnova přes `storage.onChanged`).
- **7, 8**: seznam stahuje stránky produktů zprávou `fetchProductPage` přes službu na pozadí (Chrome offscreen, Firefox
  stránka na pozadí) – timeout, kontrola přesměrování mimo Alzu, opakování jen u sítě/429/5xx (`AlzaCore.isRetryableFetchError`).
  Offscreen dokument sdílí kontrola na pozadí a seznamy (počítadlo `acquireProductPages` / `releaseProductPages`).
- **6, 9**: `AlzaCore.createObserver` – po zneplatnění kontextu se observer odpojí, `ignoreOwn` přeskočí vlastní změny DOM
  (`isOwnMutation`: prvky Alzy s naší třídou, poznané podle `data-testid`, se za vlastní nepočítají – jinak by se neobnovila
  cena přepsaná Reactem).
  Užší cíle observerů nedělány (React překresluje celý kontejner seznamu – riziko bez živého testu seznamu).
- **10**: sdílené selektory `AlzaCore.listingSelectors` a `classifyPriceBox`; výpočet ceny za jednotku v category.js zůstává
  vlastní (potřebuje surové kupóny a záhlaví, ne typy cen).
- **13**: nastavení v cs/sk/hu/en (`src/options/options-texts.js`, atributy `data-i18n*`, přepnutí jazyka bez načtení stránky;
  slovo pro smazání SMAZAT / ZMAZAŤ / TÖRLÉS / DELETE). Nápověda ve 4 jazycích sjednocená, popsané ukládání z procházení
  a Uložená data; `tests/help.test.js` hlídá stejnou strukturu stránek a názvy voleb, `tests/options-i18n.test.js` úplnost
  překladů. SK/HU/EN jsou strojové překlady – ať je projde rodilý mluvčí. Nápověda zůstává ve 4 souborech (generátor
  nahradil test struktury).
- **15**: `tests/` (node --test, bez závislostí): core, store, překlady, pořadí skriptů, nápověda. JSDoc typedefy v core.js;
  `// @ts-check` záměrně nezapnut (velké objektové literály by v editoru zahltily hlášeními). `tools/package.js` dělá `node --check`.
- **16**: content.js rozdělen na `src/content.js` + `src/content/*.js` (Object.assign do `AlzaPriceTracker`), spouští `content/start.js`.
  Pořadí v manifestu a na stránce nastavení hlídá `tests/content-scripts.test.js`.
- **20 ✗**: zásahy do uzlů Reactu v seznamu nejsou ověřitelné bez přihlášeného seznamu; stávající obnova přepsaných cen
  (`restoreOverwrittenPrices`) funguje. Doporučení: ověřit na živém seznamu, pokud se objeví chyby `removeChild`.
- **23 ◐**: v content.js hotovo (scheduleFrame, appendStat, appendTitle, getHistoricExtreme), obrázky produktů
  `AlzaCore.getProductImageUrl`, překlady `AlzaCore.translateFrom`. Sdílený `ui.js` pro popup a nastavení (odkaz na Alzu ×4,
  formát data ×2) nedělán: další sdílený soubor pro stránky i nástroj na snímky by stál víc, než ušetří.
- **28**: verze z manifestu v nástroji na snímky. Varování o tvaru verze v `package.js` je záměrné (do obchodu jde RRRR.M.D).

Testováno: unit testy; Chromium (izolovaný profil, Playwright): migrace, detail produktu, výpis, dialog historie, cílová cena,
nastavení (export, import staré zálohy, smazání ve dvou krocích, dialog historie), popup, kontrola na pozadí (simulovaná
stránka), souběžné zápisy; Firefox 159 (WebDriver BiDi): migrace, zápisy přes stránku na pozadí, stažení produktu, nastavení,
content scripty na detailu a ve výpisu; `web-ext lint` 0 chyb. Nákupní seznam: podstrčená stránka Order1.htm se skutečnými
produkty (stažení přes pozadí, uložení, zobrazení, lišta, obnova přepsané ceny). **Netestováno živě s přihlášením** – skutečný
seznam a kontrola na pozadí s cookies přihlášeného účtu.
