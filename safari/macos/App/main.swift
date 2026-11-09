// Aplikace Alza Price Insight: obal rozšíření pro Safari. Ukazuje, jak rozšíření zapnout, a obsluhuje notifikace
// (rozšíření je posílá přes SafariWebExtensionHandler, kliknutí na ně otevře produkt v Safari).
//
// Parametry pro kontrolu sestavení (bez okna):
//   --status            vypíše stav rozšíření v Safari a notifikací jako JSON a skončí
//   --snapshot <soubor> vykreslí okno do PNG (cesta uvnitř sandboxu aplikace) a skončí

import AppKit

let app = NSApplication.shared
let delegate = AppDelegate(arguments: CommandLine.arguments)
app.delegate = delegate
app.run()
