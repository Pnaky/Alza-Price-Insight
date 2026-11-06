# Alza Price Insight

Rozšíření pro Chrome, které na Alze ukazuje historii cen, hlídá nákupní seznamy na pozadí a upozorňuje na podezřelé slevy. Funguje na alza.cz, alza.sk a alza.hu.

> **Neoficiální projekt.** Rozšíření nemá žádnou vazbu na Alza.cz a.s. Název „Alza“ je ochranná známka svého vlastníka a je zde použit jen k označení webu, se kterým rozšíření pracuje.

## Co umí

- **Historie cen** v nákupních seznamech a na detailu produktu, včetně grafu s typy cen, dostupností a minimem/maximem.
- **Hlídání seznamů na pozadí** s notifikacemi při změně ceny. Počet změn se zobrazuje na ikoně rozšíření.
- **Cílová cena** u hlídaných produktů, a to i cílová cena za kus.
- **Podezřelé slevy:** porovnání přeškrtnuté ceny s obvyklou cenou a hodnocení, jestli je aktuální cena opravdu výhodná.
- **Lišta nákupního seznamu** se souhrnem, filtry a řazením.
- **Skutečná cena za kus** v kategoriích, v nákupním seznamu i na detailu produktu (i se slevou AlzaPlus+) a řazení celé kategorie podle ní.
- **Záloha dat:** export do JSON, export historie do CSV, obnova ze zálohy a úklid starých dat.

Rozhraní je v češtině, slovenštině, maďarštině a angličtině.

## Instalace

Nainstalujte si rozšíření z [Chrome Web Store](https://chromewebstore.google.com/detail/alza-wishlist-price-insig/ndaheikijjhppooeiioljekolkekfgie).

### Ruční instalace (vývojová verze)

1. Stáhněte repozitář (**Code → Download ZIP**) a rozbalte ho, nebo ho naklonujte.
2. V Chromu otevřete `chrome://extensions`.
3. Zapněte **Režim pro vývojáře** vpravo nahoře.
4. Klikněte na **Načíst rozbalené** a vyberte složku s `manifest.json`.

Vyžaduje Chrome 116 nebo novější.

## Vydání do Chrome Web Store

Balíček, popisy, snímky a propagační dlaždice: [store/README.md](store/README.md).

## Soukromí

Všechna data (ceny, historie, nastavení) se ukládají jen lokálně v prohlížeči. Rozšíření komunikuje výhradně s weby Alzy a nikam jinam nic neodesílá.

## Chyby a návrhy

Chyby a nápady hlaste přes [Issues](https://github.com/Pnaky/Alza-Price-Insight/issues). Když Alza změní vzhled webu a něco přestane fungovat, pomůže odkaz na stránku a snímek obrazovky. Projekt vzniká ve volném čase, pull requesty přijímám podle uvážení.

## Licence

Copyright (c) 2025–2026 Jan Pňakovič

[GNU GPL v3.0](LICENSE). Kód můžete používat, upravovat a šířit, ale upravené verze musí zůstat pod stejnou licencí a se zdrojovým kódem.
