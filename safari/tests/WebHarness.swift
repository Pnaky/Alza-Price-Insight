// Spustí testovací stránku ve WKWebView (WebKit – stejný engine jako Safari) a vypíše výsledky.
// Stránka hlásí řádky zprávou { log } a konec zprávou { done: true | false }.
//
//   WebHarness <stránka.html> <kořen pro čtení souborů>

import AppKit
import WebKit

final class Harness: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    let window: NSWindow

    init(page: URL, root: URL) {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = WKUserContentController()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 900, height: 700), configuration: configuration)
        // V okně mimo obrazovku – skrytá stránka by měla přiškrcené časovače
        window = NSWindow(contentRect: NSRect(x: -3000, y: -3000, width: 900, height: 700), styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        configuration.userContentController.add(self, name: "test")
        webView.navigationDelegate = self
        window.contentView = webView
        window.orderBack(nil)
        webView.loadFileURL(page, allowingReadAccessTo: root)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if let line = body["log"] as? String { print(line) }
        if let done = body["done"] as? Bool {
            fflush(stdout)
            exit(done ? 0 : 1)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("navigation failed: \(error.localizedDescription)")
        exit(2)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("navigation failed: \(error.localizedDescription)")
        exit(2)
    }
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    print("usage: WebHarness <page.html> <read-access-root>")
    exit(2)
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let harness = Harness(page: URL(fileURLWithPath: arguments[1]), root: URL(fileURLWithPath: arguments[2]))
DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
    print("TIMEOUT – stránka nedokončila testy do 60 s")
    exit(2)
}
app.run()
