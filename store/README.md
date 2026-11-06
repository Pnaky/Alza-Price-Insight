# Vydání do Chrome Web Store a Firefox Add-ons

Všechno, co je potřeba k nové verzi v obchodě: balíček, popisy, snímky a propagační dlaždice. Složka `store/` ani `tools/` se do balíčku nedostanou.

**Jeden kód, jeden `manifest.json`, dva balíčky.** Při vývoji se oba prohlížeče načítají rozbalené přímo z repozitáře (každý ignoruje klíče toho druhého). Do obchodu jde z jednoho commitu ZIP pro Chrome a ZIP pro Firefox. Každý obsahuje jen to, co jeho prohlížeč používá: bez kódu druhého prohlížeče a s manifestem bez jeho klíčů. Viz [Chrome a Firefox](#chrome-a-firefox).

**Vývoj a vydání.** Každá změna se dělá rovnou pro oba prohlížeče a testuje se v obou (rozbaleně z repozitáře). Commit má vývojovou verzi `RRRR.M.D.N` a změnu zapíše jednou stručnou odrážkou do sekce „Nevydáno“ v `CHANGELOG-chrome.md` i `CHANGELOG-firefox.md` (do jednoho z nich, týká-li se jen jednoho prohlížeče). Každý obchod má vlastní changelog, protože verze v obchodech se můžou rozejít. Build a vydání (postup níže) až na pokyn „vytvoř build“.

## Postup krok za krokem

1. **Zkontrolovat nápovědu** `src/help/help*.html` proti všem odrážkám verze v changelogu: každá nová nebo změněná funkce (názvy tlačítek, voleb a sekcí, čísla, výchozí hodnoty, co kde v popupu a nastavení je) musí v nápovědě odpovídat skutečnosti, ve všech čtyřech jazycích stejně. Kostru a názvy voleb nastavení hlídá `tests/help.test.js`, obsah ne – ten projít očima. Totéž popisy `store/description-*.txt` a odůvodnění oprávnění `store/permissions.md`.
2. **Ověřit kód**: `node --test "tests/*.test.js"`, `node --check` všech souborů v `src/`, `npx web-ext lint --source-dir . --ignore-files "store/**" "tools/**" "*.md"` (0 chyb; 5 varování za klíče Chromu ve vývojovém manifestu je v pořádku) a ruční test v obou prohlížečích (`chrome://extensions` → Načíst rozbalené; `about:debugging#/runtime/this-firefox` → Načíst dočasný doplněk → `manifest.json`).
3. **Nastavit verzi** v `manifest.json` na **`RRRR.M.D`** podle dne vydání, bez čtvrtého čísla (např. `2026.11.5`), a v changelogu každého obchodu, kam se vydává, přesunout odrážky z „Nevydáno“ pod nadpis `## RRRR.M.D – datum vydání`. Commit začíná verzí: `2026.11.5 - popis změn`.

   - **Během vývoje** má verze tvar `RRRR.M.D.N`, kde `N` je pořadí změny ten den (`2026.11.5.1`, `2026.11.5.2`, …). Do obchodu jde vždy jen `RRRR.M.D`, víc vydání za den nebývá.
   - Obchod přijme jen verzi vyšší než poslední nahranou. Poslední nahraná: Chrome Web Store `2026.11.4.2`, Firefox Add-ons `2026.11.5`; další vydání proto nejdřív `2026.11.6` (do Chrome Web Store může jít i `2026.11.5`, pokud se vydá ten den). Den vydání se tedy musí lišit od dne posledního vydání. Kdyby přece jen bylo potřeba vydat dvakrát za den, druhé vydání dostane `RRRR.M.D.1`.
   - Vývojové `RRRR.M.D.N` téhož dne je vyšší než vydaná `RRRR.M.D`. U rozbaleného rozšíření v prohlížeči to nevadí.
4. **Sestavit balíčky** z uloženého commitu (v kořeni repozitáře, Node 22+):

   ```
   node tools/package.js
   ```

   Výstup: `..\alza-price-insight_<verze>_chrome.zip` a `..\alza-price-insight_<verze>_firefox.zip`. S neuloženými změnami skript odmítne balit (`--dirty` jen na zkoušku, takový balíček nenahrávat). Jdou jen soubory potřebné pro běh (`manifest.json`, `_locales`, `css`, `img`, `src` – bez README, `store/`, `tools/`). Skript ověří, že v balíčku je všechno, na co manifest a HTML stránky odkazují.

   Balíček pro Firefox ještě zkontrolovat: rozbalit a `npx web-ext lint --source-dir <složka>` → 0 chyb, 1 varování (Firefox pro Android – nepodporujeme, nemá notifikace).
5. **Přegenerovat snímky, dlaždice a promo novinek** (po každé změně vzhledu nebo textů rozšíření):

   ```
   python tools/store-screenshots/build.py
   ```

   Výstup: `..\alza-price-insight-store\<verze>\` (vedle repozitáře, každá verze ve vlastní složce, např. `2026.11.6\`), cca 1 min. Promo novinek pro X / Twitter (`release\cs\` a `release\en\`: 4 obrázky 1600×900 a `post.txt` s textem příspěvku) vznikne jen pro verzi, která má texty v `RELEASES` v `tools/store-screenshots/release.py` – pro novou verzi je tam doplnit podle odrážek z changelogu.
6. **Nahrát** `_chrome.zip` v Chrome Web Store Developer Dashboard podle tabulky níže a `_firefox.zip` na addons.mozilla.org (Developer Hub → doplněk → Nahrát novou verzi; jen Firefox pro počítač, ne Android). Co vyplnit na AMO a poznámky pro kontrolora: `store/amo.md`. Do „Version notes“ na AMO jdou odrážky verze z `CHANGELOG-firefox.md`.
7. **Zapsat vydání**: řádek do [Historie vydání](#historie-vydání) níže; commit.

## Co kam v obchodě

| Pole v obchodě | Soubor |
|---|---|
| Balíček | `..\alza-price-insight_<verze>_chrome.zip` |
| Název a krátký popis | automaticky z `_locales/<jazyk>/messages.json` (`name`, `description` ≤ 132 znaků) |
| Podrobný popis (max 16 000 znaků) | `store/description-cs.txt`, `-sk`, `-hu`, `-en` (en = výchozí / globální) |
| Lokalizované snímky (max 5, 1280×800) | `alza-price-insight-store\<verze>\cs\`, `sk\`, `hu\` |
| Globální snímky (max 5, 1280×800) | `alza-price-insight-store\<verze>\en\` |
| Malá propagační dlaždice 440×280 | `alza-price-insight-store\<verze>\promo\small-tile-440x280.png` |
| Dlaždice propagačního běžícího textu 1400×560 | `alza-price-insight-store\<verze>\promo\marquee-1400x560.png` |
| Příspěvek o nové verzi na X / Twitteru (mimo obchod) | `alza-price-insight-store\<verze>\release\cs\` a `en\` – 4 obrázky a `post.txt` |
| Postupy v oblasti ochrany soukromí → odůvodnění oprávnění | `store/permissions.md` (alarms, notifications, offscreen, unlimitedStorage) |

Obchod chce JPEG nebo 24bitové PNG bez průhlednosti v přesném rozměru – nástroj to zajišťuje a rozměr kontroluje.

## Chrome a Firefox

- **Kód jen pro jeden prohlížeč patří do `src/chrome/` nebo `src/firefox/`**, nic jinde nevětví podle prohlížeče. `tools/package.js` dá do balíčku pro Chrome jen `src/chrome/`, do balíčku pro Firefox jen `src/firefox/`. Klíče manifestu pro jeden prohlížeč odebírá `TARGETS` v témže skriptu: Chrome nedostane `browser_specific_settings` ani `background.scripts`, Firefox `minimum_chrome_version`, `background.service_worker` ani oprávnění `offscreen`.
- **Pozadí**: Chrome spouští service worker `src/chrome/service-worker.js` (`importScripts`), Firefox stránku na pozadí ze seznamu `background.scripts` v manifestu. Oba načtou stejné pořadí: `core.js` → vlastní `product-pages.js` → `background.js`. Nový skript pro pozadí je potřeba přidat na obě místa. Skripty na pozadí sdílejí globální prostor – žádná dvě stejná jména funkcí nebo konstant.
- **Stažení produktu na pozadí**: `background.js` volá `ProductPages.open()` / `fetch(url)` / `close()`. Samotné stažení a rozbor je `fetchProductPage` v `src/shared/product-page.js`. Chrome ji spouští v offscreen dokumentu (`src/chrome/offscreen/`), protože service worker nemá `DOMParser`. Firefox offscreen API nemá a volá ji přímo (`src/firefox/product-pages.js`).
- **`browser_specific_settings.gecko`**: `id` je trvalé (pod ním AMO doplněk vede a ukládá data uživatelů) – neměnit. `data_collection_permissions: none` = doplněk nic neodesílá vývojáři ani třetím stranám.
- **Kontrola AMO**: cokoli, co `web-ext lint` balíčku pro Firefox hlásí navíc proti očekávanému (viz krok 4), opravit. Nepoužívat `innerHTML` s neověřeným obsahem (ani s ternárním výrazem – hlásí ho taky).
- **Rozdíly k otestování**: notifikace (Firefox umí jen `basic`, `requireInteraction` ignoruje), přihlášení při kontrole na pozadí (cookies), vzhled popupu.

## Popisy (`store/description-*.txt`)

- Čistý text bez emoji (obchod neumí formátování). Šipky ▼ ▲ zůstávají – jsou to znaky, které rozšíření skutečně zobrazuje.
- Všechny čtyři jazyky mají stejnou strukturu: úvod, Historie cen, Je cena opravdu dobrá?, Cílová cena, Hlídání na pozadí, Skutečná cena za kus, Chytřejší nákupní seznamy, Vaše data, Jazyky, Jak začít, Soukromí, Oprávnění, upozornění „neoficiální projekt“ na konci.
- Příklady cen v měně trhu: CZ/EN 2,40 Kč/ks, SK 0,16 €/ks, HU 60 Ft/db.
- **Při změně funkcí** upravit všechny čtyři popisy a zároveň nápovědu `src/help/help*.html`. Popisy jsou společné pro Chrome Web Store i AMO – nepsat do nich nic, co platí jen pro jeden prohlížeč (např. offscreen dokument), a popis aktualizovat v obou obchodech.

## Snímky – nástroj `tools/store-screenshots/`

Nezávislý na rozšíření: jen čte jeho `src/` a `css/`, nic v něm nemění. Rozhraní na snímcích je **skutečné** (vykreslí ho `content.js`, `category.js` a `popup.js`), data a okolní „stránka Alzy“ jsou vymyšlené. Po změně rozšíření tedy stačí nástroj spustit znovu.

| Soubor | Co v něm je |
|---|---|
| `build.py` | rozvržení snímků (funkce `shot_*`, `tile_small`, `marquee`), nadpisy a body vlevo (`COPY`), texty okolní stránky (`MOCK`), ceny v kategorii (`CATEGORY`), vykreslení headless Chromem |
| `common.js` | náhrada `chrome.*` API a vymyšlené produkty, historie a ceny pro každý trh |
| `changes.js` | texty notifikací a přehledu změn – skládá je jádro rozšíření, takže odpovídají skutečnosti |
| `after-core.js` | doména snímku (stránky jsou `file://`) |
| `release.py` | promo novinek verze pro X / Twitter: texty verze (`RELEASES`), 4 obrázky 1600×900 se skutečným popupem, seznamem, detailem a nastavením, text příspěvku |
| `pages/` | vygenerované stránky (v `.gitignore`) |

Potřebuje: Google Chrome v `C:\Program Files\Google\Chrome\Application\` a Python s Pillow. Jiná výstupní složka: `python tools/store-screenshots/build.py <složka>`.

**Snímky (stejné pořadí ve všech jazycích):**

1. Historie cen – podezřelá sleva a vymyšlená přeškrtnutá cena, graf s propadem ceny
2. Nákupní seznam – lišta se souhrnem, filtry, šipky ▼ ▲ u cen
3. Detail produktu – karta s hodnocením ceny, cenou za kus a cílem za kus
4. Kategorie – oranžové štítky se skutečnou cenou za kus a seřazení podle ní
5. Hlídání na pozadí – popup s přehledem změn a notifikace

**Jazyky:** `cs` = alza.cz (Kč), `sk` = alza.sk (€), `hu` = alza.hu (Ft), `en` = alza.cz (Kč) s rozšířením v angličtině (nastavení „Jazyk rozšíření“). Rozhraní uvnitř snímku je vždy v jazyce snímku.

## Pravidla designu (domluvená, neměnit bez důvodu)

- **Barvy z ikony**: rám `#1e1e1e`, limetková `#c9dd03` (zvýraznění v nadpisu, odrážky), oranžová `#ee771a`, šedá `#9a9b9c`, námořnická `#263f6a` (přechod pozadí).
- **Rozvržení 1280×800**: vlevo 420 px textu (značka, nadpis se zvýrazněním, perex, tři odrážky, sloupce z ikony dole), vpravo okno.
- **Všechna okna stejná**: tmavá lišta se třemi tečkami, rám 3 px, výška 704 px, horní okraj 48 px, bílá plocha x 436–1219. Zvětšuje se jen obsah okna (`zoom` na `.inner`), **nikdy celé okno** – jinak se změní rám a snímky při listování poskakují. Okno popupu (snímek 5) je užší, ale stejně vysoké.
- **Nákupní seznam**: šipky ▼ ▲ bez kroužků a těsně před cenou, bez terče 🎯, řádky odsazené 16 px od okraje, ceny stejně široké (min. 84 px) a ve sloupcích pod sebou.
- **Žádný vzhled ani logo Alzy**: neutrální kostra stránky, vymyšlené produkty bez značek, emoji místo fotek.
- **Dlaždice běžícího textu**: koláž skutečných prvků (karta historie, varování před podezřelou slevou, notifikace) – ne oříznutý snímek obrazovky. Malá dlaždice: logo, název, jedna věta, sloupce z ikony.

## Kde co upravit

- Nadpisy a body vlevo: `COPY` v `build.py` (všechny čtyři jazyky).
- Produkty, ceny, historie: `common.js` (přepočet do € a Ft funkcí `conv`, kapsle a kategorie mají ceny zvlášť, ať je cena za kus čitelná i v €).
- Velikosti a pozice: CSS ve funkcích `shot_*` v `build.py`.
- Po úpravě vždy zkontrolovat výsledek očima a ověřit, že okna 1–4 mají stejný rám.

## Historie vydání

| Verze | Datum | Poznámka |
|---|---|---|
| 2026.11.4.1 | 2026-11-04 | první balíček po přejmenování na „Alza Price Insight“ |
| 2026.11.4.2 | 2026-11-04 | rozšíření i anglicky na stránkách Alzy, šipky bez kroužků; nové snímky CZ/SK/HU/EN a dlaždice |
| 2026.11.5 | 2026-11-05 | první vydání pro Firefox – odesláno na AMO (veřejně, jen Firefox pro počítač); do Chrome Web Store zatím nenahráno |
| 2026.11.6 | 2026-11-06 | balíčky pro Chrome i Firefox: jediný zapisovatel do storage, frekvence kontroly (až jednou denně), nový popup a členění nastavení, rytmus akcí, jiný stav levněji, součet při více kusech, upozornění před košíkem, oprava přepsání hlídaného seznamu při přepnutí záložky |
