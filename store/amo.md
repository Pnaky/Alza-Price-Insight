# Firefox Add-ons (addons.mozilla.org, AMO)

Co vyplnit při nahrání na AMO. Postup sestavení balíčku je v `store/README.md`. Nahrává se `..\alza-price-insight_<verze>_firefox.zip`.

## První nahrání (Developer Hub → Submit a New Add-on)

| Krok / pole | Co zvolit |
|---|---|
| Kde vydat | **On this site** (veřejně na AMO) |
| Platforma | jen **Firefox** (pro počítač), **ne Android** – nemá notifikace, `web-ext lint` to hlásí jako jediné varování |
| Zdrojový kód („Do you need to submit source code?“) | **No** – kód není minifikovaný, obfuskovaný ani generovaný; `tools/package.js` soubory jen kopíruje a z manifestu odebírá klíče pro Chrome |
| Název a krátký popis | automaticky z `_locales/<jazyk>/messages.json` (`name`, `description`) |
| Popis | celý `store/description-en.txt` (výchozí), přidat překlady `-cs`, `-sk`, `-hu` (AMO: Edit Product Page → jazyk). AMO zachová řádky; po uložení zkontrolovat náhled stránky |
| This add-on is experimental | nezaškrtávat |
| Requires payment, non-free services… | nezaškrtávat – účet na Alze je zdarma |
| Kategorie (max 3) | **Shopping**, **Alerts & Updates** |
| Support email / website | nepovinné; e-mail uvidí uživatelé na stránce doplňku |
| Štítky | `price tracker`, `price history`, `shopping`, `alza` |
| Licence | **GNU General Public License v3.0** (jako `LICENSE` v repozitáři) |
| This add-on has a Privacy Policy | nezaškrtávat – doplněk nic nesbírá ani neodesílá (`data_collection_permissions: none`) |
| Snímky | Manage Listing → Images → Add a Screenshot. Jedna sada pro všechny jazyky: `..\alza-price-insight-store\cs\` 1–5 (stejné jako pro Chrome Web Store, 1280×800; AMO bere až 2400×1800) |
| Ikona | AMO ji z balíčku nepřevezme – Manage Listing → Images → Upload a Custom Icon → `img/icon-128.png` |
| Notes to Reviewer | text níže |

ID doplňku `alza-price-insight@pnakovic` je v manifestu a po prvním nahrání se nesmí změnit.

## Notes to Reviewer

Čte kontrolor Mozilly, proto anglicky. Při změně oprávnění nebo hlídání na pozadí aktualizovat (viz i `store/permissions.md`).

```
Alza Price Insight adds price history and price evaluation to the Czech/Slovak/Hungarian e-shop Alza (alza.cz, alza.sk, alza.hu). It runs only on those sites and communicates with no other server; all data stays in browser storage (export/delete in the extension settings).

How to test:
- Most features need a logged-in Alza account (free registration on alza.cz). Without login the extension deliberately does not store prices, because Alza then shows different prices and the history would be wrong.
- Logged in: open any product page on alza.cz – the price history card appears next to the price. Open the account's shopping lists ("Nákupní seznamy") to see the list toolbar, price arrows and filters.
- Category pages show an orange "real unit price" label for products sold in packs.
- Popup → "Zkontrolovat" runs the background price check immediately; results are in Settings → "Logy běhů".

Background price check (alarms, hourly): fetches the product pages of products the user explicitly chose to watch, with the user's Alza cookies (credentials: "include"), parses them with DOMParser (src/shared/product-page.js, same parser as the content script) and compares prices with the stored history. Only Alza URLs are ever requested; redirects away from Alza are rejected. During a check, src/firefox/product-pages.js calls runtime.getPlatformInfo() every 10 s only to keep the event page alive (storage writes do not reset the idle timer); it stops when the check finishes.

Notifications: shown for price drops, new price types, availability changes and reached target prices of watched products, as configured in the settings. Product images for notifications are loaded from image.alza.*.

No remote code, no minification, no bundler, no analytics. The files in the package are the original source, copied unchanged; the only difference from the repository is that manifest.json has the Chrome-only keys (service_worker, offscreen permission, minimum_chrome_version) removed and the Chrome-only folder src/chrome/ is left out.
```

## Další verze

1. Balíček sestavit stejně jako pro Chrome (`node tools/package.js`, viz `store/README.md`) – verze musí být vyšší než poslední nahraná na AMO.
2. Developer Hub → My Add-ons → Alza Price Insight → **Upload New Version** → `..\alza-price-insight_<verze>_firefox.zip`.
3. Platforma jen Firefox, zdrojový kód **No**. Do „Version notes“ / „Notes to Reviewer“ stačí krátce, co se změnilo; při změně oprávnění nebo hlídání na pozadí vložit aktualizovaný blok výše.
4. Po odeslání přijde e-mail o zveřejnění, obvykle do 24 hodin; při ruční kontrole může trvat déle a kontrolor se může ozvat s dotazy.

Při změně funkcí upravit i popis na AMO (Manage Listing, všechny jazyky) – zdrojem jsou stejné `store/description-*.txt` jako pro Chrome Web Store.
