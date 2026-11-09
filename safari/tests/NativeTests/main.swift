// Testy nativní části bez Safari: které adresy smí kliknutí na notifikaci otevřít, rozbor náhledu produktu
// a odpovědi SafariWebExtensionHandler na zprávy, které nesahají na notifikace. Spouští tests/run.sh.

import Foundation

var failures = 0
func check(_ name: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
    if !condition { failures += 1 }
    print("\(condition ? "✓" : "✗") \(name)\(condition ? "" : "\n    \(detail())")")
}

// === Cíl kliknutí: jen https stránky www.alza.cz / .sk / .hu (jako AlzaCore.isAlzaUrl) ===
let allowed = [
    "https://www.alza.cz/",
    "https://www.alza.cz",
    "https://www.alza.sk/iphone-17-d123456.htm?o=1#hodnoceni",
    "https://www.alza.hu/kosar",
    "https://WWW.ALZA.CZ/velka-pismena",
]
let denied: [Any?] = [
    "http://www.alza.cz/",
    "https://alza.cz/",
    "https://image.alza.cz/products/x.jpg",
    "https://www.alza.cz.example.com/",
    "https://example.com/?u=https://www.alza.cz/",
    "https://www.alza.cz:8443/",
    "https://user:heslo@www.alza.cz/",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "safari-web-extension://ABC/src/options/options.html",
    "",
    nil,
    42,
]
for value in allowed {
    check("povoleno: \(value)", AlzaShared.alzaURL(value) != nil)
}
for value in denied {
    check("odmítnuto: \(value.map { "\($0)" } ?? "nil")", AlzaShared.alzaURL(value) == nil, "\(String(describing: AlzaShared.alzaURL(value)))")
}

// === Náhled produktu (data URL z background.js) ===
let png = "data:image/png;base64," + Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).base64EncodedString()
check("PNG náhled", AlzaNotifications.decodeImage(png)?.fileExtension == "png" && AlzaNotifications.decodeImage(png)?.data.count == 8)
check("JPEG náhled", AlzaNotifications.decodeImage("data:image/jpeg;base64,/9j/4AAQ")?.fileExtension == "jpg")
check("WebP bez náhledu", AlzaNotifications.decodeImage("data:image/webp;base64,UklGRg==") == nil)
check("SVG bez náhledu", AlzaNotifications.decodeImage("data:image/svg+xml;base64,PHN2Zz4=") == nil)
check("bez base64 bez náhledu", AlzaNotifications.decodeImage("data:image/png,abc") == nil)
check("poškozené base64 bez náhledu", AlzaNotifications.decodeImage("data:image/png;base64,***") == nil)
check("jiný typ než obrázek bez náhledu", AlzaNotifications.decodeImage("data:text/html;base64,PGI+") == nil)
check("adresa místo data URL bez náhledu", AlzaNotifications.decodeImage("https://image.alza.cz/a.png") == nil)

// === Odpovědi na zprávy ===
func reply(_ message: [String: Any]) -> [String: Any] {
    var result: [String: Any] = [:]
    let done = DispatchSemaphore(value: 0)
    SafariWebExtensionHandler.handle(message) {
        result = $0
        done.signal()
    }
    done.wait()
    return result
}
check("ping", reply(["type": "ping"])["ok"] as? Bool == true)
let unknown = reply(["type": "něco"])
check("neznámá zpráva → ok: false s chybou", unknown["ok"] as? Bool == false && (unknown["error"] as? String)?.isEmpty == false, "\(unknown)")
check("prázdná zpráva → ok: false", reply([:])["ok"] as? Bool == false)
check("odpověď jde převést na JSON", JSONSerialization.isValidJSONObject(unknown))

print(failures == 0 ? "vše v pořádku" : "\(failures) test(y) selhal(y)")
exit(failures == 0 ? 0 : 1)
