# Changelog – Chrome Web Store

## Nevydáno

## 2026.11.7 – 2026-11-07

- Po instalaci průvodce nastavením: hlavní Alza, ověření přihlášení a cen s DPH jedním kliknutím (co je hotové a co udělat), hlídání a notifikace ve 3 krocích
- Nastavení: 🧭 Průvodce v záhlaví, volba Hlavní Alza
- Nový vzhled nastavení, nápovědy a popupu (jako průvodce); záhlaví na všech stránkách na stejném místě
- Nastavení: 🐞 Nahlásit chybu – předvyplněné hlášení na GitHubu (verze, prohlížeč, poslední chyby)
- Oprava: nastavení po otevření samo odskočilo dolů
- Popup: odkaz na Alzu vede na doménu otevřené záložky (na alza.sk na alza.sk)
- Popup: když hlídáte víc Alz, seznamy, změny cen i hlídané produkty mají štítek CZ / SK / HU
- Popup: cena v přehledu změn už nezatéká pod posuvník
- Číslo na ikoně počítá i zdražení; barva: zelená = něco zlevnilo, červená = jen zdražení, šedá = jen konec prodeje
- Popup: podbarvené jsou i nové zdražení a změny z kontroly spuštěné při otevřeném popupu
- Oprava: seřazený nákupní seznam znovu obnoví ceny, které Alza přepíše (AlzaPlus+, kód, součet za kusy)
- Odložené notifikace z tichých hodin přijdou hned po jejich konci, ne až s další kontrolou
- Kontrola bez připojení k internetu se zopakuje za 15 minut a nepočítá se jako proběhlá
- Oprava: číslo na ikoně mohlo po otevření popupu zůstat; počítá jen změny, které popup ukáže
- Oprava: na alza.sk a alza.hu se běžné zlevnění mohlo vyhodnotit jako „ceny bez DPH“ a ukládání se zastavilo
- Průvodce: zeleně „vše připraveno“ jen s ověřenými cenami s DPH; mezi hlídanými počítá i cílové ceny
- Nastavení: změny z průvodce už nepřepíše otevřená stránka nastavení
- Import zálohy: kontrola adres, obrázků a časů; hlásí i vynechané položky
- Nahlásit chybu: z veřejného hlášení zmizí adresy produktů
- Malé zlevnění v procentech s desetinnými místy místo „-0 %“
- Popup: odkaz na Alzu vede na hlavní Alzu z nastavení, když není otevřená záložka Alzy

## 2026.11.6 – 2026-11-06

- Oprava: seznam bez přihlášení (nebo s cenami bez DPH) se donekonečna načítal místo upozornění, že se ceny neukládají
- Seznam: sloupec „ks celkem“ se už nepřekrývá se šipkami ▼ ▲ a ikonou změny ceny
- Oprava: při přepnutí záložky seznamu se hlídaný seznam mohl přepsat položkami předchozího seznamu (Alza mění adresu dřív, než vykreslí položky)
- Spolehlivější ukládání: změny z více záložek, popupu a kontroly na pozadí se už navzájem nepřepisují; uložené ceny po produktech (převod proběhne sám)
- Rychlejší seznam: stránky produktů se stahují a čtou na pozadí, s časovým limitem a bez zbytečného opakování
- Smazání všech dat až po potvrzení, že se záloha uložila
- Zkracování textu dostupnosti funguje i s jiným jazykem rozšíření než Alzy
- Šipka změny ceny nezávislá na ikonách Alzy; malé změny v procentech s desetinným místem
- Po aktualizaci rozšíření otevřená stránka Alzy nepohlcuje kliknutí ani nehází chyby
- Chyby akcí v nastavení a popupu se zobrazí (dřív se nic nestalo)
- Nastavení: u každé volby ikona „?“ s nápovědou (ukáže se hned po najetí myší)
- Kontrola na pozadí: v nastavení frekvence – každou hodinu, 3 / 6 / 12 hodin nebo jednou denně ve zvolený čas (zmeškaná proběhne po spuštění prohlížeče); popup ukazuje čas další kontroly
- Nastavení: „?“ s nápovědou i u Zálohy dat a Diagnostiky
- Nastavení: přehlednější členění – Sledování cen (kontrola hlídaných produktů, ukládání z procházení), Notifikace, Výpisy kategorií; jazyk v pravém sloupci u zálohy a diagnostiky
- Popup širší (400 px): řádky změn cen se vejdou na jeden řádek, název rozšíření se nezalamuje
- Popup: v záhlaví jen název, ikona Alzy a ⚙️ (nápověda je v nastavení); změny barevně – zlevnění zeleně, zdražení červeně, nedostupnost / konec prodeje šedě (nové podbarvené, viděné jen barvou textu); v přehledu i zdražení (bez notifikace)
- Popup: u hlídaných seznamů místo křížku shrnutí, kolik produktů za 7 dní zlevnilo ▼ / zdražilo ▲; oprava zdvojeného řádku „Další kontrola“
- Rytmus akcí: jak často a jak hluboko bývá produkt ve slevě, kdy se čeká další; „⏳ vyplatí se počkat“ v seznamu, filtr, na detailu
- Stejný produkt v jiném stavu (rozbalený, zánovní) levněji než vaše nejnižší cena (i s AlzaPlus+ a benefitem): na detailu, v tooltipu ceny, filtr
- Ukládání cen z procházení: výpisy kategorií, vyhledávání, detail, karusely na detailu (zakoupeno společně, alternativy, naposledy navštívené) i homepage tiše do historie (volba v nastavení)
- Čistka navrhne produkty z procházení až po roce
- Nastavení: 📈 u produktu otevře historii cen s grafem a cílovou cenou
- Seznam při více kusech: ceny zůstávají za kus (dřív zmizely), vlevo od nich sloupec „3 ks celkem“ se součtem i s množstevní slevou; řádek se neposune
- Upozornění před vložením do košíku ze seznamu, když nejnižší cena platí jen za podmínky (slevový kód, AlzaPlus+, cashback, výkup)
- Výběr délky: cena za metr; detail produktu i s adresou „…?dq=“ (skupiny variant, např. kabely)
- Výběr velikosti balení: cena za kus u každé velikosti ve sloupci vpravo, nejvýhodnější zeleně, nejdražší červeně; hned i v zavřeném výběru; i velikosti s názvem („Sparkle 120 ks“) a násobkem („2× 60 ks“)
- Množstevní slevy „Kup víc, zaplať míň“: stupně u ceny, filtr, součet podle počtu kusů
- Souhrn seznamu: cashback a výkup zvlášť od částky k zaplacení
- Výstraha ⚠ u podezřelé (chybně načtené) ceny
- Produkt bez cen ukazuje, od kdy trvá jeho dostupnost

## 2026.11.4.2 – 2026-11-04

- Rozšíření i anglicky na stránkách Alzy
- Šipky ▼ ▲ u cen bez kroužků

## 2026.11.4.1 – 2026-11-04

- Nový název Alza Price Insight, nový popup a nastavení
- Historie cen s grafem
- Hodnocení ceny, podezřelé slevy a přeškrtnuté ceny
- Cílová cena s notifikací
- Hlídání seznamů a produktů na pozadí
- Skutečná cena za kus, řazení kategorie podle ní
- Lišta nákupního seznamu: souhrn, filtry, řazení
- Záloha, export do CSV, úklid dat, diagnostika
- Čeština, slovenština, maďarština, angličtina
