# Zdůvodnění oprávnění (Chrome Web Store → Postupy v oblasti ochrany soukromí)

Texty pro pole „Odůvodnění“ u jednotlivých oprávnění. Čtou je recenzenti Googlu, proto anglicky. Při změně kódu (nové oprávnění, jiné použití) aktualizovat tady i v obchodě.

## alarms

```
Used to run the background price check regularly – every hour by default, or every 3, 6 or 12 hours or once a day at a time the user chooses in the settings (chrome.alarms). The check looks only at products the user explicitly chose to watch – watched shopping lists, products marked "Watch in background" and products with a target price – compares their current prices with the locally stored price history and notifies the user about price drops or a reached target price. Without alarms the service worker could not wake up periodically to run this check.
```

## notifications

```
Used to show desktop notifications when a product the user watches gets cheaper, gets a new price type (sale, discount code, cashback), changes availability, or reaches the target price the user set. Notifications are created only for products the user chose to watch, and the user decides in the extension settings which kinds of changes to be notified about (including a minimum price drop and quiet hours). A test button in the settings lets the user check that notifications work.
```

## offscreen

```
The periodic background price check runs in the service worker, which has no DOM. An offscreen document (reason DOM_PARSER) fetches the product page of a watched product from alza.cz, alza.sk or alza.hu and parses it with DOMParser to read the prices and availability, using the same parser as the content script. It only ever requests Alza product URLs (requests to other domains or redirects away from Alza are rejected) and the parsed data is stored only locally in the browser.
```

## unlimitedStorage

```
The extension keeps a local price history for every product in the user's shopping lists and watched products: each price change with its time, all price types (regular, sale, AlzaPlus+, discount code, cashback…) and availability, up to 500 entries per product. Users with large shopping lists accumulate this history over months, which would exceed the default 10 MB limit of chrome.storage.local and new prices could no longer be saved. All data stays in the browser and is never sent anywhere; the user can export it, clean up old products or delete everything in the extension settings.
```

## Ostatní oprávnění (obchod je zatím nevyžadoval, pro případ dotazu)

**storage** – `Stores price history, watched lists and products, target prices and settings locally in the browser.`

**Host permissions (alza.cz, alza.sk, alza.hu, image.alza.*)** – `Shows prices, price history and the real unit price directly on Alza pages, and loads product pages and product images from Alza for the background price check and notifications. The extension communicates with no other website.`
