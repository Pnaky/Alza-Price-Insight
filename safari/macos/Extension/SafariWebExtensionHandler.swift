// Nativní část rozšíření: Safari sem doručí zprávy z browser.runtime.sendNativeMessage
// (src/safari/notifications.js). Odpověď je vždy { ok: true, … } nebo { ok: false, error }.
//
//   { type: "ping" }                                        → { ok, version }
//   { type: "permission" }                                  → { ok, level: granted | denied | notDetermined | provisional }
//   { type: "notify", id, title, message, url?, image? }    → { ok } – url jen https www.alza.cz/sk/hu, image = data URL
//   { type: "clear", id }                                   → { ok }

import Foundation
import SafariServices
import os

@objc(SafariWebExtensionHandler)
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let log = Logger(subsystem: "AlzaPriceInsight.Extension", category: "native-messaging")

    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]

        Self.handle(message) { reply in
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: reply]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }

    static func handle(_ message: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        let type = message["type"] as? String ?? ""
        log.notice("Native message: \(type, privacy: .public)") // Jen druh zprávy – texty a adresy do logu nepatří
        switch type {
        case "ping":
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
            reply(["ok": true, "version": version])

        case "permission":
            AlzaNotifications.authorizationStatus { status in
                reply(["ok": true, "level": AlzaNotifications.level(status)])
            }

        case "notify":
            AlzaNotifications.post(
                id: message["id"] as? String,
                title: String((message["title"] as? String ?? "").prefix(500)),
                body: String((message["message"] as? String ?? "").prefix(4000)),
                url: AlzaShared.alzaURL(message["url"]),
                imageDataURL: message["image"] as? String
            ) { error in
                if let error {
                    log.error("Notification failed: \(error, privacy: .public)")
                    reply(["ok": false, "error": error])
                } else {
                    reply(["ok": true])
                }
            }

        case "clear":
            if let id = message["id"] as? String { AlzaNotifications.clear(id: id) }
            reply(["ok": true])

        default:
            log.error("Unknown native message type: \(type, privacy: .public)")
            reply(["ok": false, "error": "unknown message type: \(type)"])
        }
    }
}
