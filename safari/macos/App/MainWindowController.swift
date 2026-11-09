import AppKit
import SafariServices
import UserNotifications

/// Okno aplikace: tři kroky k funkčnímu rozšíření (zapnout v Safari, povolit přístup na Alzu, notifikace) se stavem
final class MainWindowController: NSWindowController {
    private static let contentWidth: CGFloat = 540
    private static let textIndent: CGFloat = 34

    private let extensionStatus = StatusLine()
    private let notificationStatus = StatusLine()
    private let allowButton = NSButton()
    private let notificationSettingsButton = NSButton()
    private let testButton = NSButton()
    private let testResult = NSTextField(wrappingLabelWithString: "")

    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: Self.contentWidth + 56, height: 600),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Alza Price Insight"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        window.contentView = makeContent()
        window.setContentSize(window.contentView?.fittingSize ?? window.frame.size)
        window.center()
        NotificationCenter.default.addObserver(self, selector: #selector(refresh), name: NSApplication.didBecomeActiveNotification, object: nil)
        refresh()
        // Zapnutí rozšíření v Safari i povolení notifikací se děje jinde – stav obnovovat, dokud je okno vidět
        let timer = Timer(timeInterval: 3, repeats: true) { [weak self] _ in
            guard let self, self.window?.isVisible == true else { return }
            self.refresh()
        }
        RunLoop.main.add(timer, forMode: .common)
        refreshTimer = timer
    }

    private var refreshTimer: Timer?

    deinit {
        refreshTimer?.invalidate()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    // MARK: - Stav

    @objc func refresh() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let state, state.isEnabled {
                    self.extensionStatus.set(.ok, T("Rozšíření je v Safari zapnuté", "The extension is turned on in Safari"))
                } else if state != nil {
                    self.extensionStatus.set(.todo, T("Rozšíření je v Safari vypnuté", "The extension is turned off in Safari"))
                } else {
                    // Safari nepodepsané rozšíření nevidí, dokud nejsou povolená nepodepsaná rozšíření
                    self.extensionStatus.set(.unknown, isAdHocSigned
                        ? T("Safari rozšíření zatím nevidí – povolte nepodepsaná rozšíření", "Safari doesn't see the extension yet – allow unsigned extensions")
                        : T("Stav rozšíření se nepodařilo zjistit", "Couldn't get the extension state"))
                    _ = error
                }
            }
        }

        AlzaNotifications.authorizationStatus { [weak self] status in
            DispatchQueue.main.async {
                guard let self else { return }
                switch status {
                case .authorized, .provisional:
                    self.notificationStatus.set(.ok, T("Notifikace jsou povolené", "Notifications are allowed"))
                case .denied:
                    // I během čekání na odpověď v systémovém dotazu (upozornění vpravo nahoře)
                    self.notificationStatus.set(.todo, T("Notifikace nejsou povolené – povolte je v upozornění vpravo nahoře nebo v Nastavení oznámení",
                                                         "Notifications are not allowed – allow them in the alert at the top right or in Notification Settings"))
                default:
                    self.notificationStatus.set(.unknown, T("Notifikace zatím nejsou povolené", "Notifications are not allowed yet"))
                }
                self.allowButton.isHidden = status != .notDetermined
                self.notificationSettingsButton.isHidden = status == .notDetermined
            }
        }
    }

    // MARK: - Akce

    @objc private func openSafariSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            // Nepodepsané rozšíření Safari bez povolení nezná – aspoň otevřít Safari
            if error != nil { DispatchQueue.main.async { AppDelegate.openInSafari(nil) } }
        }
    }

    @objc private func allowNotifications() {
        AlzaNotifications.requestAuthorization { [weak self] _, _ in
            DispatchQueue.main.async { self?.refresh() }
        }
    }

    @objc private func openNotificationSettings() {
        let id = Bundle.main.bundleIdentifier ?? ""
        let candidates = [
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)",
            "x-apple.systempreferences:com.apple.preference.notifications?id=\(id)",
        ]
        for candidate in candidates {
            if let url = URL(string: candidate), NSWorkspace.shared.open(url) { return }
        }
    }

    @objc private func sendTestNotification() {
        testResult.stringValue = ""
        AlzaNotifications.post(
            id: nil,
            title: T("Alza Price Insight – zkušební notifikace", "Alza Price Insight – test notification"),
            body: T("Takhle přijde upozornění na změnu ceny. Kliknutí otevře produkt v Safari.",
                    "This is how a price change alert looks. Clicking it opens the product in Safari."),
            url: URL(string: "https://www.alza.cz/"),
            imageDataURL: nil
        ) { [weak self] error in
            DispatchQueue.main.async {
                self?.testResult.stringValue = error.map { T("Notifikaci se nepodařilo poslat: \($0)", "Couldn't send the notification: \($0)") }
                    ?? T("Odesláno – notifikace se ukáže vpravo nahoře.", "Sent – the notification appears in the top-right corner.")
                self?.refresh()
            }
        }
    }

    // MARK: - Obsah okna

    private func makeContent() -> NSView {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""

        let icon = NSImageView(image: NSApp.applicationIconImage ?? NSImage())
        icon.imageScaling = .scaleProportionallyUpOrDown
        icon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([icon.widthAnchor.constraint(equalToConstant: 64), icon.heightAnchor.constraint(equalToConstant: 64)])

        let title = Self.label(T("Alza Price Insight pro Safari", "Alza Price Insight for Safari"), size: 20, weight: .semibold)
        let subtitle = Self.label(
            T("Verze \(version) · rozšíření pro Safari", "Version \(version) · Safari extension"),
            size: 12, color: .secondaryLabelColor, width: Self.contentWidth - 80
        )
        let titles = NSStackView(views: [title, subtitle])
        titles.orientation = .vertical
        titles.alignment = .leading
        titles.spacing = 2
        let header = NSStackView(views: [icon, titles])
        header.spacing = 16
        header.alignment = .centerY

        let safariText = isAdHocSigned
            ? T("Rozšíření je sestavené na tomto Macu bez vývojářského certifikátu. Safari ho načte, až v Safari → Nastavení → Pokročilé zapnete „Zobrazit funkce pro webové vývojáře“ a pak v Nastavení → Vývojář zapnete „Povolit nepodepsaná rozšíření“. Nakonec v Nastavení → Rozšíření zaškrtněte Alza Price Insight. Safari tuto volbu po ukončení vypne – po každém spuštění Safari ji zapněte znovu (data rozšíření zůstanou).",
                "The extension was built on this Mac without a developer certificate. Safari loads it once you turn on “Show features for web developers” in Safari → Settings → Advanced and then “Allow unsigned extensions” in Settings → Developer. Then check Alza Price Insight in Settings → Extensions. Safari turns this option off when it quits – turn it on again after each Safari launch (the extension keeps its data).")
            : T("V Safari → Nastavení → Rozšíření zaškrtněte Alza Price Insight.",
                "Check Alza Price Insight in Safari → Settings → Extensions.")
        let safariSection = Self.section(
            number: 1,
            title: T("Zapněte rozšíření v Safari", "Turn on the extension in Safari"),
            status: extensionStatus,
            text: safariText,
            buttons: [Self.button(T("Otevřít nastavení rozšíření v Safari", "Open Safari extension settings"), self, #selector(openSafariSettings))]
        )

        let accessSection = Self.section(
            number: 2,
            title: T("Povolte přístup na Alzu", "Allow access to Alza"),
            status: nil,
            text: T("Safari pustí rozšíření na web, až když to schválíte. Po zapnutí se otevře průvodce s tlačítkem Povolit přístup na Alzu – v nabídce Safari zvolte Vždy povolit. Jinak na stránce Alzy klikněte na ikonu rozšíření na liště, nebo v Safari → Nastavení → Rozšíření → Alza Price Insight → Upravit webové stránky nastavte Alze Povolit. Bez přístupu se ceny nezobrazí ani nehlídají na pozadí.",
                    "Safari only lets the extension onto a website after you approve it. Once turned on, the extension opens a setup guide with an Allow access to Alza button – choose Always Allow in Safari's prompt. Otherwise click the extension icon in the toolbar on an Alza page, or set Alza to Allow in Safari → Settings → Extensions → Alza Price Insight → Edit Websites. Without access, prices are neither shown nor watched in the background."),
            buttons: []
        )

        Self.configure(allowButton, T("Povolit notifikace", "Allow notifications"), self, #selector(allowNotifications))
        Self.configure(notificationSettingsButton, T("Nastavení oznámení…", "Notification Settings…"), self, #selector(openNotificationSettings))
        Self.configure(testButton, T("Vyzkoušet notifikaci", "Send test notification"), self, #selector(sendTestNotification))
        allowButton.keyEquivalent = "\r"
        testResult.font = .systemFont(ofSize: 12)
        testResult.textColor = .secondaryLabelColor
        testResult.preferredMaxLayoutWidth = Self.contentWidth - Self.textIndent
        let notifySection = Self.section(
            number: 3,
            title: T("Notifikace o změnách cen", "Price change notifications"),
            status: notificationStatus,
            text: T("V Safari upozornění posílá tato aplikace (rozšíření v Safari notifikace samo neumí). Kliknutí na upozornění otevře produkt v Safari.",
                    "In Safari, alerts are sent by this app (Safari extensions can't show notifications themselves). Clicking an alert opens the product in Safari."),
            buttons: [allowButton, notificationSettingsButton, testButton],
            footer: testResult
        )

        let footer = Self.label(
            T("Aplikaci nechte ve složce Aplikace – Safari z ní rozšíření načítá. Ceny se na pozadí kontrolují, jen když je Safari spuštěné. Okno můžete zavřít, rozšíření běží v Safari.",
              "Keep this app in the Applications folder – Safari loads the extension from it. Prices are checked in the background only while Safari is running. You can close this window; the extension runs in Safari."),
            size: 11, color: .secondaryLabelColor, width: Self.contentWidth
        )

        let stack = NSStackView(views: [header, safariSection, accessSection, notifySection, footer])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 22
        stack.setCustomSpacing(26, after: header)
        stack.edgeInsets = NSEdgeInsets(top: 26, left: 28, bottom: 26, right: 28)
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.widthAnchor.constraint(equalToConstant: Self.contentWidth + 56).isActive = true
        return stack
    }

    private static func section(number: Int, title: String, status: StatusLine?, text: String, buttons: [NSButton], footer: NSView? = nil) -> NSView {
        let heading = NSStackView(views: [NumberBadge(number), label(title, size: 15, weight: .semibold)])
        heading.spacing = 12
        heading.alignment = .centerY

        var body: [NSView] = []
        if let status { body.append(status) }
        body.append(label(text, size: 13, color: .secondaryLabelColor, width: contentWidth - textIndent))
        if !buttons.isEmpty {
            let row = NSStackView(views: buttons)
            row.spacing = 8
            body.append(row)
        }
        if let footer { body.append(footer) }

        let content = NSStackView(views: body)
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 8
        content.edgeInsets = NSEdgeInsets(top: 0, left: textIndent, bottom: 0, right: 0)

        let section = NSStackView(views: [heading, content])
        section.orientation = .vertical
        section.alignment = .leading
        section.spacing = 8
        return section
    }

    private static func label(_ text: String, size: CGFloat, weight: NSFont.Weight = .regular, color: NSColor = .labelColor, width: CGFloat? = nil) -> NSTextField {
        let field = width == nil ? NSTextField(labelWithString: text) : NSTextField(wrappingLabelWithString: text)
        field.font = .systemFont(ofSize: size, weight: weight)
        field.textColor = color
        field.isSelectable = false
        if let width {
            field.preferredMaxLayoutWidth = width
            field.translatesAutoresizingMaskIntoConstraints = false
            field.widthAnchor.constraint(equalToConstant: width).isActive = true
        }
        return field
    }

    private static func button(_ title: String, _ target: AnyObject, _ action: Selector) -> NSButton {
        let button = NSButton()
        configure(button, title, target, action)
        return button
    }

    private static func configure(_ button: NSButton, _ title: String, _ target: AnyObject, _ action: Selector) {
        button.title = title
        button.bezelStyle = .rounded
        button.setButtonType(.momentaryPushIn)
        button.target = target
        button.action = action
    }
}

/// Číslo kroku v kroužku (navy jako ikona rozšíření, v tmavém režimu světlejší)
final class NumberBadge: NSView {
    private static let fill = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0.36, green: 0.50, blue: 0.74, alpha: 1)
            : NSColor(srgbRed: 0.149, green: 0.247, blue: 0.416, alpha: 1)
    }
    private let number: String

    init(_ number: Int) {
        self.number = "\(number)"
        super.init(frame: NSRect(x: 0, y: 0, width: 22, height: 22))
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([widthAnchor.constraint(equalToConstant: 22), heightAnchor.constraint(equalToConstant: 22)])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func draw(_ dirtyRect: NSRect) {
        Self.fill.setFill()
        NSBezierPath(ovalIn: bounds).fill()
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 12, weight: .bold), .foregroundColor: NSColor.white]
        let size = number.size(withAttributes: attributes)
        number.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2), withAttributes: attributes)
    }
}

/// Řádek stavu: barevná ikona + text
final class StatusLine: NSStackView {
    enum Kind { case ok, todo, unknown }

    private let icon = NSImageView()
    private let text = NSTextField(labelWithString: "…")

    init() {
        super.init(frame: .zero)
        orientation = .horizontal
        spacing = 6
        alignment = .centerY
        text.font = .systemFont(ofSize: 13, weight: .medium)
        icon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([icon.widthAnchor.constraint(equalToConstant: 16), icon.heightAnchor.constraint(equalToConstant: 16)])
        addArrangedSubview(icon)
        addArrangedSubview(text)
        set(.unknown, "…")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func set(_ kind: Kind, _ value: String) {
        let (symbol, color): (String, NSColor) = switch kind {
        case .ok: ("checkmark.circle.fill", .systemGreen)
        case .todo: ("exclamationmark.circle.fill", .systemOrange)
        case .unknown: ("questionmark.circle", .secondaryLabelColor)
        }
        icon.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        icon.contentTintColor = color
        text.stringValue = value
    }
}
