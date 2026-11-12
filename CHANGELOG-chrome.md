# Changelog – Chrome Web Store

## Nevydáno

## 2026.11.12

- Moje nákupy (volitelné): všechno koupené na Alze – datum a cena nákupu, stav a délka záruky, vrácené a reklamované zboží, odkaz na objednávku, graf výdajů po letech a měsících se srovnáním, filtr podle roku a měsíce se součtem
- Připomínka konce záruky měsíc předem u dražšího zboží; na detailu produktu „Koupili jste…“
- Cena provozu: v kategoriích u lednic, mrazáků, praček a sušiček s řazením „S provozem“, na detailu produktu i u televizí, monitorů a myček; cena elektřiny, počet let, praní týdně a hodiny televize v nastavení
- Cena za parametr v kategoriích a vyhledávání: Kč/TB a Kč/GB u disků a pamětí, za 1000 mAh u powerbanek, za Wh u nabíjecích stanic; řazení „Za jednotku“ i podle ní
- Co je nového: po aktualizaci stránka s novinkami (sama jen u nové volby), značka Novinky v popupu
- Nastavení po záložkách (Sledování cen, Notifikace, Výpisy kategorií, Obecné), ovladatelné i šipkami a čtečkou obrazovky; průvodce má krok Kategorie, Moje nákupy a připomínku konce záruky
- Hlídané seznamy se před každou kontrolou aktualizují z Alzy – i položky přidané v mobilní aplikaci
- Hlídání po nákupu: nová objednávka se načte už při kontrole na pozadí; zlevnění hned po nákupu se ohlásí; zboží mimo hlídané seznamy hlásí jen zlevnění pod nákupní cenu; vrácené a zrušené zboží se přestane hlídat
- Filtr slev u velkých výpisů filtruje načtené produkty a další dávku přidá „Načíst dalších 480“; správně počítá ceny člena AlzaPlus+
- Běžná cena se přeškrtne, jen když jde opravdu zaplatit míň – ne u samotného cashbacku nebo výkupu
- Šetrněji k Alze: prodlevy mezi dotazy na objednávky, přerušení po odmítnutí
- Zlevnění zjištěné těsně před zavřením prohlížeče se ohlásí po dalším spuštění
- Nahlásit chybu: název napíšete sami; hlášení i diagnostika bez adres, kódů, názvů koupeného zboží a čísel objednávek
- Záloha obsahuje i připomínky cashbacku; Smazat všechna data smaže i nákupy, kódy a připomínky
- Opravy: sleva k položce v objednávce s víc zbožím, zdánlivé zlevnění po nákupu s kódem, připomínky cashbacku (tiché hodiny, maďarská data, eura), slevový kód z textu, košík po překreslení, Přidat s kódem bez dvojího přidání, cenová karta po překreslení stránky, ceny při načítání seznamu, jedno upozornění pro produkt pod dvěma adresami, texty chyb v jazyce rozhraní

## 2026.11.9

- Popup: trezor slevových kódů (kód, cena s kódem, Kopírovat), sbalený na jeden řádek; upozornění na nový kód hlídaného produktu obsahuje kód
- Hlídání po nákupu: zboží z „Moje objednávky“ (14 dní) – když zlevní, upozornění, že jde vrátit a koupit znovu
- Připomínka cashbacku: lhůta registrace ze stránky akce, upozornění, až jde nákup zaregistrovat, a týden před koncem; „Cashback k registraci“ v popupu
- Cashback: termíny akce v tooltipu ceny a na detailu, varování po konci nákupního období
- Košík: hodnocení ceny u položek, „+1 ks → cena za kus“ u množstevní slevy, upozornění na chybějící slevový kód před „Pokračovat“
- Seznam: „Přidat s kódem“ vloží zboží do košíku i se slevovým kódem
- Seznam: zeleně cena za kus podle stupně množstevní slevy; cena s kódem červeně s ikonou kupónu
- Detail: bublina množstevních slev hned, „Kopírovat nabídku“, ikony srovnávačů (Heureka, Zboží.cz, Árukereső); karta řekne, proč se ceny neukládají
- Kategorie a vyhledávání: filtr slev v panelu filtrů (sleva aspoň X %, jen s kupónem, s množstevní slevou), řazení za jednotku jako záložka „Za jednotku“
- Hezčí a přehlednější vzhled: tooltipy jako na Alze (název ceny, rozdíl proti dražším cenám, stupně množstevní slevy, kód ke zkopírování), lišta seznamu s logem jako nastavení, ovládání v kategoriích přímo v záložkách a filtrech Alzy
- Popup: název produktu s chybou kontroly je odkaz
- Oprava: slevový kód výrobce („Koupit s kódem …“) se nepočítal
- Oprava: cena za jednotku v kategoriích u ceny s AlzaPlus+
- Oprava: ceny zboží bez DPH (knihy) se znovu ukládají; jeden takový produkt nezastaví kontrolu seznamu
- Oprava: cena „od …“ u množstevní slevy kazila historii a minimum (staré záznamy se odstraní)

## 2026.11.7

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

## 2026.11.6

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

## 2026.11.4.2

- Rozšíření i anglicky na stránkách Alzy
- Šipky ▼ ▲ u cen bez kroužků

## 2026.11.4.1

- Nový název Alza Price Insight, nový popup a nastavení
- Historie cen s grafem
- Hodnocení ceny, podezřelé slevy a přeškrtnuté ceny
- Cílová cena s notifikací
- Hlídání seznamů a produktů na pozadí
- Skutečná cena za kus, řazení kategorie podle ní
- Lišta nákupního seznamu: souhrn, filtry, řazení
- Záloha, export do CSV, úklid dat, diagnostika
- Čeština, slovenština, maďarština, angličtina
