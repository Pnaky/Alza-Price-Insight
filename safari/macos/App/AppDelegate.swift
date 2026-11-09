import AppKit
import SafariServices
import UserNotifications

/// Identifikátor rozšíření (appex) – build.sh ho zapíše do Info.plist aplikace
let extensionBundleIdentifier: String =
    Bundle.main.object(forInfoDictionaryKey: "AlzaExtensionBundleIdentifier") as? String
    ?? (Bundle.main.bundleIdentifier ?? "AlzaPriceInsight") + ".Extension"

/// Podepsáno jen „ad hoc“ (bez vývojářského certifikátu) – Safari pak vyžaduje Povolit nepodepsaná rozšíření
let isAdHocSigned: Bool = Bundle.main.object(forInfoDictionaryKey: "AlzaAdHocSigned") as? Bool ?? true

let T = AlzaShared.text

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private let arguments: [String]
    private let launchedAt = Date()
    private var mainWindow: MainWindowController?
    private var quitTimer: Timer?

    init(arguments: [String]) {
        self.arguments = arguments
    }

    // Delegát notifikací musí být nastavený před koncem spuštění – jinak by se kliknutí, které aplikaci spustilo, ztratilo
    func applicationWillFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        NSApp.mainMenu = makeMainMenu()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if arguments.contains("--status") {
            printStatusAndQuit()
            return
        }
        if let index = arguments.firstIndex(of: "--snapshot"), index + 1 < arguments.count {
            snapshotAndQuit(to: arguments[index + 1])
            return
        }
        // Spuštěno kliknutím na notifikaci: okno není potřeba, otevře se produkt (didReceive). Kdyby odpověď nepřišla, skončit
        if notification.userInfo?[NSApplication.launchUserNotificationUserInfoKey] != nil {
            quitTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { _ in NSApp.terminate(nil) }
            return
        }
        showMainWindow()
        // Při prvním spuštění rovnou požádat o povolení notifikací (systém se zeptá jen jednou)
        AlzaNotifications.authorizationStatus { status in
            guard status == .notDetermined else { return }
            AlzaNotifications.requestAuthorization { _, _ in
                DispatchQueue.main.async { self.mainWindow?.refresh() }
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showMainWindow() }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func showMainWindow() {
        quitTimer?.invalidate()
        quitTimer = nil
        if mainWindow == nil { mainWindow = MainWindowController() }
        mainWindow?.showWindow(nil)
        mainWindow?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Notifikace

    // Ukázat i ve chvíli, kdy je aplikace vpředu (Vyzkoušet notifikaci)
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    // Kliknutí na notifikaci: produkt (nebo seznam) v Safari. Aplikace spuštěná jen kvůli tomu pak zase skončí
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let url = AlzaShared.alzaURL(response.notification.request.content.userInfo[AlzaShared.urlKey])
        let clicked = response.actionIdentifier == UNNotificationDefaultActionIdentifier
        DispatchQueue.main.async {
            if clicked { Self.openInSafari(url) }
            let launchedForNotification = self.mainWindow == nil || Date().timeIntervalSince(self.launchedAt) < 5
            if launchedForNotification {
                self.mainWindow?.close()
                self.quitTimer?.invalidate()
                self.quitTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { _ in NSApp.terminate(nil) }
            }
            completionHandler()
        }
    }

    /// Adresa Alzy v Safari; bez adresy jen přepne do Safari
    static func openInSafari(_ url: URL?) {
        let workspace = NSWorkspace.shared
        guard let safari = workspace.urlForApplication(withBundleIdentifier: "com.apple.Safari") else {
            if let url { workspace.open(url) }
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        if let url {
            workspace.open([url], withApplicationAt: safari, configuration: configuration) { _, error in
                if error != nil { DispatchQueue.main.async { workspace.open(url) } }
            }
        } else {
            workspace.openApplication(at: safari, configuration: configuration, completionHandler: nil)
        }
    }

    // MARK: - Kontrola sestavení

    private func printStatusAndQuit() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            AlzaNotifications.authorizationStatus { status in
                var result: [String: Any] = [
                    "app": Bundle.main.bundleIdentifier ?? "",
                    "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                    "extension": extensionBundleIdentifier,
                    "adHocSigned": isAdHocSigned,
                    "notifications": AlzaNotifications.level(status),
                ]
                if let state { result["extensionEnabled"] = state.isEnabled }
                if let error { result["extensionError"] = error.localizedDescription }
                if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]),
                   let text = String(data: data, encoding: .utf8) {
                    print(text)
                }
                DispatchQueue.main.async { NSApp.terminate(nil) }
            }
        }
    }

    private func snapshotAndQuit(to path: String) {
        let controller = MainWindowController()
        mainWindow = controller
        controller.window?.orderFront(nil)
        // Stav rozšíření a notifikací doběhne asynchronně – vykreslit až potom
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            guard let view = controller.window?.contentView else { NSApp.terminate(nil); return }
            view.layoutSubtreeIfNeeded()
            if let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: rep)
                let url = URL(fileURLWithPath: path)
                do {
                    try rep.representation(using: .png, properties: [:])?.write(to: url)
                    print("snapshot: \(url.path) \(Int(view.bounds.width))×\(Int(view.bounds.height))")
                } catch {
                    print("snapshot failed: \(error.localizedDescription)")
                }
            }
            NSApp.terminate(nil)
        }
    }

    // MARK: - Menu

    private func makeMainMenu() -> NSMenu {
        let name = "Alza Price Insight"
        let menu = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: name)
        appMenu.addItem(withTitle: T("O aplikaci \(name)", "About \(name)"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: T("Skrýt \(name)", "Hide \(name)"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: T("Skrýt ostatní", "Hide Others"), action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: T("Zobrazit vše", "Show All"), action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: T("Ukončit \(name)", "Quit \(name)"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: T("Okno", "Window"))
        windowMenu.addItem(withTitle: T("Minimalizovat", "Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: T("Zavřít", "Close"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        menu.addItem(windowItem)
        NSApp.windowsMenu = windowMenu

        return menu
    }
}
