// Sdílí aplikace (Vyzkoušet notifikaci, kliknutí na notifikaci) i rozšíření (SafariWebExtensionHandler).
// Notifikace zobrazuje macOS jménem aplikace Alza Price Insight – rozšíření v Safari API notifikací nemají.

import Foundation
import UserNotifications

enum AlzaShared {
    /// Stejné pravidlo jako AlzaCore.isAlzaUrl v rozšíření: jen https stránky www.alza.cz / .sk / .hu
    static let alzaHosts: Set<String> = ["www.alza.cz", "www.alza.sk", "www.alza.hu"]

    static func alzaURL(_ value: Any?) -> URL? {
        guard let string = value as? String,
              let components = URLComponents(string: string),
              components.scheme?.lowercased() == "https",
              let host = components.host?.lowercased(), alzaHosts.contains(host),
              components.port == nil, components.user == nil, components.password == nil,
              let url = components.url
        else { return nil }
        return url
    }

    /// Klíč adresy produktu v userInfo notifikace
    static let urlKey = "alzaURL"
    static let threadIdentifier = "alza-price-insight"

    /// Texty aplikace česky (i pro slovenštinu), jinak anglicky
    static let czech: Bool = {
        let language = Locale.preferredLanguages.first?.lowercased() ?? ""
        return language.hasPrefix("cs") || language.hasPrefix("sk")
    }()

    static func text(_ czechText: String, _ englishText: String) -> String {
        czech ? czechText : englishText
    }
}

enum AlzaNotifications {
    /// Stav povolení jako text pro rozšíření (safari/notifications.js → getPermissionLevel)
    static func level(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .provisional: return "provisional"
        case .denied: return "denied"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }

    static func authorizationStatus(_ completion: @escaping (UNAuthorizationStatus) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { completion($0.authorizationStatus) }
    }

    static func requestAuthorization(_ completion: @escaping (Bool, Error?) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
            completion(granted, error)
        }
    }

    /// Zobrazí notifikaci. Dokud uživatel notifikace nepovolil ani nezakázal, nejdřív si o povolení řekne.
    /// completion(nil) = zobrazeno, jinak popis chyby
    static func post(
        id: String?,
        title: String,
        body: String,
        url: URL?,
        imageDataURL: String?,
        completion: @escaping (String?) -> Void
    ) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .denied:
                completion("notifications are turned off for Alza Price Insight in System Settings → Notifications")
            case .notDetermined:
                requestAuthorization { granted, error in
                    guard granted else {
                        completion(error?.localizedDescription ?? "notifications were not allowed")
                        return
                    }
                    add(to: center, id: id, title: title, body: body, url: url, imageDataURL: imageDataURL, completion: completion)
                }
            default:
                add(to: center, id: id, title: title, body: body, url: url, imageDataURL: imageDataURL, completion: completion)
            }
        }
    }

    static func clear(id: String) {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
    }

    private static func add(
        to center: UNUserNotificationCenter,
        id: String?,
        title: String,
        body: String,
        url: URL?,
        imageDataURL: String?,
        completion: @escaping (String?) -> Void
    ) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.threadIdentifier = AlzaShared.threadIdentifier
        if let url { content.userInfo = [AlzaShared.urlKey: url.absoluteString] }
        if let attachment = imageAttachment(imageDataURL) { content.attachments = [attachment] }

        let identifier = (id?.isEmpty == false ? id : nil) ?? UUID().uuidString
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        center.add(request) { error in
            completion(error.map { $0.localizedDescription })
        }
    }

    /// Obrázek produktu (data URL z rozšíření) jako příloha notifikace – macOS ho ukáže vpravo jako náhled.
    /// Soubor si systém při přidání notifikace přesune do svého úložiště
    private static func imageAttachment(_ dataURL: String?) -> UNNotificationAttachment? {
        guard let image = decodeImage(dataURL) else { return nil }
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("alza-notification-\(UUID().uuidString)")
            .appendingPathExtension(image.fileExtension)
        do {
            try image.data.write(to: file)
            return try UNNotificationAttachment(identifier: "product", url: file, options: nil)
        } catch {
            try? FileManager.default.removeItem(at: file)
            return nil
        }
    }

    /// data:image/png|jpeg|gif;base64,… → obsah a přípona souboru. Jiné formáty (webp…) notifikace neumí – bez náhledu
    static func decodeImage(_ dataURL: String?) -> (data: Data, fileExtension: String)? {
        guard let dataURL, dataURL.hasPrefix("data:image/"), let comma = dataURL.firstIndex(of: ",") else { return nil }
        let header = dataURL[..<comma].lowercased()
        guard header.hasSuffix(";base64") else { return nil }
        let fileExtension: String
        switch header.dropFirst("data:".count).prefix(while: { $0 != ";" }) {
        case "image/png": fileExtension = "png"
        case "image/jpeg", "image/jpg": fileExtension = "jpg"
        case "image/gif": fileExtension = "gif"
        default: return nil
        }
        guard let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              !data.isEmpty, data.count <= 5_000_000
        else { return nil }
        return (data, fileExtension)
    }
}
