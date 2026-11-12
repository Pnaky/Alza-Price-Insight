# Jak přispět

Díky za zájem! Projekt vzniká ve volném čase, pull requesty přijímám podle uvážení. U větší změny prosím nejdřív založte [issue](https://github.com/Pnaky/Alza-Price-Insight/issues) a domluvíme se, ať práce nepřijde vniveč.

## Chyby a nápady

- **Chyba:** nejrychleji z rozšíření přes **Nastavení → Obecné → Diagnostika → 🐞 Nahlásit chybu** (předvyplní verzi, prohlížeč a poslední chyby; název hlášení napíšete sami), nebo šablonou **Nahlásit chybu** v Issues. Pomůže odkaz na stránku Alzy a snímek obrazovky.
- **Nápad:** prázdné issue s popisem, co by rozšíření mělo umět a proč.
- **Bezpečnostní chyba:** neveřejně, viz [SECURITY.md](SECURITY.md).

## Vývoj

Bez buildu a bez závislostí. Jak načíst rozbalenou verzi do Chrome a Firefoxu, popisuje [README](README.md#pro-vývojáře).

Pravidla:

- **Jeden kód pro Chrome i Firefox.** Každou změnu vyzkoušejte v obou prohlížečích. Kód jen pro jeden prohlížeč patří do `src/chrome/` nebo `src/firefox/`.
- **Testy:** `node --test "tests/*.test.js"` (stačí Node.js) musí projít. Ke změně v jádře (`src/shared/`) přidejte test.
- **Překlady:** texty jsou ve čtyřech jazycích (cs, sk, hu, en). Nový text doplňte do všech, testy hlídají, že žádný nechybí.
- **Nápověda:** když měníte, co rozšíření umí, upravte i `src/help/`.
- **Úložiště:** do `chrome.storage` zapisuje jen `src/shared/store.js`.
- **Soukromí:** žádná analytika, žádné vlastní servery. Rozšíření komunikuje jen s weby Alzy.
- **Styl:** jako okolní kód, komentáře česky. Popis ve `CHANGELOG-chrome.md` a `CHANGELOG-firefox.md` do sekce „Nevydáno“ stručně, jednou odrážkou.

## Pull requesty

- Směřujte do `main`, jedna věc na jeden PR.
- Popište, co se mění, a jak jste to vyzkoušeli (prohlížeč, doména Alzy).
- PR se slučuje squashem do jednoho commitu.
- Příspěvkem souhlasíte, že ho vydám pod licencí [GPL-3.0](LICENSE).
