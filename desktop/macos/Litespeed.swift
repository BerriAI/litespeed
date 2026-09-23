import AppKit
import WebKit

struct DesktopConfiguration: Decodable {
    let serverURL: String
    let sourceRoot: String?
    let nodePath: String?
    let dataDirectory: String?
    let workspace: String?
    let attachOnly: Bool?
    let bundledRuntime: Bool?
}

@MainActor
final class DesktopApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var config: DesktopConfiguration!
    var serverURL: URL!
    var startup: Process?
    var startupErrors: Pipe?
    var downloadPanels: [ObjectIdentifier: NSSavePanel] = [:]
    var starting = false
    var audited = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let location = Bundle.main.url(forResource: "desktop", withExtension: "json")!
            config = try JSONDecoder().decode(DesktopConfiguration.self, from: Data(contentsOf: location))
            let address = ProcessInfo.processInfo.environment["LITESPEED_DESKTOP_URL"] ?? config.serverURL
            guard let url = URL(string: address), url.scheme == "http", ["localhost", "127.0.0.1"].contains(url.host ?? ""), url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/" else { throw NSError(domain: "Litespeed", code: 1, userInfo: [NSLocalizedDescriptionKey: "The desktop server address must be a local HTTP address."]) }
            serverURL = url
            makeWindow()
            makeMenu()
            Task { await connect() }
        } catch { showFailure(error.localizedDescription) }
    }

    func makeWindow() {
        let preferences = WKWebViewConfiguration()
        preferences.websiteDataStore = .default()
        preferences.preferences.javaScriptCanOpenWindowsAutomatically = false
        preferences.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "desktop")
        let bridge = """
        (() => {
          const request = action => window.webkit.messageHandlers.desktop.postMessage({action});
          Object.defineProperty(window, 'litespeedDesktop', {value: Object.freeze({platform:'darwin', chooseFolder:()=>request('chooseFolder')})});
          document.addEventListener('DOMContentLoaded', () => document.documentElement.dataset.desktop = 'macos', {once:true});
          window.addEventListener('contextmenu', event => { if (!event.target.closest('input,textarea,[contenteditable],pre,code,.pdf-text-layer')) event.preventDefault(); });
        })();
        """
        preferences.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: preferences)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.setValue(false, forKey: "drawsBackground")
        webView.isInspectable = ProcessInfo.processInfo.environment["LITESPEED_DESKTOP_INSPECT"] == "1"
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 960), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Litespeed"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = false
        window.minSize = NSSize(width: 860, height: 600)
        window.backgroundColor = NSColor.windowBackgroundColor
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("LitespeedMainWindow")
        if !window.setFrameUsingName("LitespeedMainWindow") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        showLoading()
    }

    func makeMenu() {
        let menu = NSMenu()
        func group(_ title: String) -> NSMenu {
            let item = NSMenuItem(); item.title = title; let submenu = NSMenu(title: title); item.submenu = submenu; menu.addItem(item); return submenu
        }
        func command(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = [.command]) { let item = NSMenuItem(title: title, action: action, keyEquivalent: key); item.keyEquivalentModifierMask = modifiers; item.target = self; menu.addItem(item) }
        let app = group("Litespeed")
        command(app, "About Litespeed", #selector(about))
        app.addItem(.separator()); command(app, "Settings…", #selector(settings), ",")
        app.addItem(.separator()); app.addItem(withTitle: "Hide Litespeed", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h").keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator()); app.addItem(withTitle: "Quit Litespeed", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let file = group("File")
        command(file, "New Task", #selector(newTask), "n"); command(file, "Open Project…", #selector(openProject), "o")
        file.addItem(.separator()); command(file, "Close", #selector(closeFocused), "w")
        let edit = group("Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        for (title, action, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] { edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key) }
        let view = group("View")
        command(view, "Search Tasks…", #selector(search), "f", [.command, .shift]); command(view, "Command Palette…", #selector(commandPalette), "k"); command(view, "Toggle Workspace", #selector(toggleWorkspace), "j")
        command(view, "Open Browser", #selector(openTaskBrowser), "b", [.command, .shift])
        command(view, "Previous Tab", #selector(previousWorkspaceTab), "[", [.command, .shift]); command(view, "Next Tab", #selector(nextWorkspaceTab), "]", [.command, .shift])
        view.addItem(.separator()); command(view, "Reload", #selector(reload), "r")
        command(view, "Actual Size", #selector(actualSize), "0"); command(view, "Zoom In", #selector(zoomIn), "+"); command(view, "Zoom Out", #selector(zoomOut), "-")
        view.addItem(.separator()); view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f").keyEquivalentModifierMask = [.command, .control]
        let windows = group("Window"); NSApp.windowsMenu = windows
        windows.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windows.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        let help = group("Help"); command(help, "Litespeed Help", #selector(helpPage)); command(help, "Open in Browser", #selector(openInBrowser))
        NSApp.mainMenu = menu
    }

    func command(_ name: String) {
        guard let current = webView?.url, isAppURL(current) else { return }
        let data = try! JSONSerialization.data(withJSONObject: name, options: .fragmentsAllowed)
        let value = String(data: data, encoding: .utf8)!
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('litespeed:desktop-command',{detail:\(value)}))", completionHandler: nil)
    }
    @objc func newTask() { command("new-task") }
    @objc func settings() { command("settings") }
    @objc func search() { command("search") }
    @objc func commandPalette() { command("commands") }
    @objc func openTaskBrowser() { command("browser") }
    @objc func toggleWorkspace() { command("workspace") }
    @objc func openProject() { command("open-project") }
    @objc func helpPage() { command("help") }
    func workspaceCommand(_ name: String, fallback: @escaping () -> Void) {
        guard let current = webView?.url, isAppURL(current), let data = try? JSONSerialization.data(withJSONObject: name, options: .fragmentsAllowed), let value = String(data: data, encoding: .utf8) else { fallback(); return }
        webView.evaluateJavaScript("!window.dispatchEvent(new CustomEvent('litespeed:workspace-command',{detail:\(value),cancelable:true}))") { result, _ in
            if result as? Bool != true { fallback() }
        }
    }
    @objc func closeFocused() { workspaceCommand("close-tab") { [weak self] in self?.window.performClose(nil) } }
    @objc func previousWorkspaceTab() { workspaceCommand("previous-tab") {} }
    @objc func nextWorkspaceTab() { workspaceCommand("next-tab") {} }
    @objc func reload() { workspaceCommand("reload") { [weak self] in
        guard let self else { return }
        if let url = self.webView.url, self.isAppURL(url) { self.webView.reload() } else { Task { await self.connect() } }
    } }
    @objc func actualSize() { webView.pageZoom = 1 }
    @objc func zoomIn() { webView.pageZoom = min(1.6, webView.pageZoom + 0.1) }
    @objc func zoomOut() { webView.pageZoom = max(0.7, webView.pageZoom - 0.1) }
    @objc func openInBrowser() { if let url = webView.url, isAppURL(url) { NSWorkspace.shared.open(url) } }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Litespeed", .applicationVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "", .credits: NSAttributedString(string: "A quiet place to get things done.")]) }

    func isAppURL(_ url: URL) -> Bool { url.scheme == serverURL.scheme && url.host == serverURL.host && url.port == serverURL.port && url.user == nil && url.password == nil }
    func openExternal(_ url: URL) { guard ["http", "https", "mailto"].contains(url.scheme ?? ""), url.user == nil, url.password == nil else { return }; NSWorkspace.shared.open(url) }

    func connect() async {
        guard !starting else { return }; starting = true; defer { starting = false }
        do {
            if config.attachOnly != true {
                let bundled = config.bundledRuntime == true ? Bundle.main.resourceURL?.appendingPathComponent("litespeed") : nil
                guard let root = bundled?.path ?? config.sourceRoot, let node = bundled?.appendingPathComponent("runtime/node").path ?? config.nodePath else { throw NSError(domain: "Litespeed", code: 2, userInfo: [NSLocalizedDescriptionKey: "The app could not locate its server runtime."]) }
                let process = Process(); process.executableURL = URL(fileURLWithPath: node)
                process.arguments = [URL(fileURLWithPath: root).appendingPathComponent("bin/desktop-server.mjs").path]
                process.currentDirectoryURL = URL(fileURLWithPath: root)
                var environment = ProcessInfo.processInfo.environment
                environment["LITESPEED_DESKTOP_URL"] = serverURL.absoluteString
                if let data = config.dataDirectory { environment["LITESPEED_DATA_DIR"] = data }
                if let workspace = config.workspace { environment["LITESPEED_WORKSPACE"] = workspace }
                if let bundled {
                    environment["LITESPEED_DESKTOP_BUNDLE"] = "1"
                    environment["PLAYWRIGHT_BROWSERS_PATH"] = bundled.appendingPathComponent("runtime/browsers").path
                }
                process.environment = environment
                process.standardOutput = FileHandle.nullDevice
                let errors = Pipe(); process.standardError = errors; startupErrors = errors
                try process.run(); startup = process
            }
            for _ in 0..<100 {
                if let process = startup, !process.isRunning, process.terminationStatus != 0 {
                    let message = startupErrors.map { String(decoding: $0.fileHandleForReading.readDataToEndOfFile().prefix(4096), as: UTF8.self) } ?? "The local server could not start."
                    throw NSError(domain: "Litespeed", code: 4, userInfo: [NSLocalizedDescriptionKey: message])
                }
                if startup?.isRunning != true { if await healthy() { webView.load(URLRequest(url: serverURL)); return } }
                try await Task.sleep(for: .milliseconds(200))
            }
            throw NSError(domain: "Litespeed", code: 3, userInfo: [NSLocalizedDescriptionKey: "The local server isn’t ready. You can retry from View → Reload."])
        } catch { showFailure(error.localizedDescription) }
    }
    func healthy() async -> Bool {
        var request = URLRequest(url: serverURL.appendingPathComponent("api/health")); request.timeoutInterval = 1
        do { let (data, response) = try await URLSession.shared.data(for: request); guard (response as? HTTPURLResponse)?.statusCode == 200, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }; return value["ok"] as? Bool == true && value["name"] as? String == "litespeed" } catch { return false }
    }
    func showLoading() { webView.loadHTMLString(shellHTML("Opening Litespeed", ""), baseURL: nil) }
    func showFailure(_ message: String) {
        if webView == nil { let alert = NSAlert(); alert.messageText = "Couldn’t open Litespeed"; alert.informativeText = message; alert.runModal(); NSApp.terminate(nil) }
        else { webView.loadHTMLString(shellHTML("Couldn’t connect", message), baseURL: nil) }
    }
    func shellHTML(_ title: String, _ message: String) -> String {
        let escaped = message.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        return "<meta name='color-scheme' content='light dark'><style>html{background:light-dark(#fff,#191919);color:light-dark(#242424,#e5e5e5);font:14px -apple-system}body{display:grid;place-content:center;text-align:center;height:95vh;margin:0}h1{font-size:22px;font-weight:500}p{max-width:420px;color:#888;line-height:1.7}</style><h1>\(title)</h1><p>\(escaped)</p>"
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, isAppURL(url), let body = message.body as? [String: String], body["action"] == "chooseFolder" else { replyHandler(nil, "This desktop action is unavailable."); return }
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false; panel.canCreateDirectories = true; panel.prompt = "Open Project"; panel.message = "Choose a folder for your project."
        panel.beginSheetModal(for: window) { response in replyHandler(response == .OK ? panel.url?.path : nil, nil) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" { decisionHandler(.allow); return }
        if isAppURL(url) || url.scheme == "blob" {
            decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow); return
        }
        if navigationAction.navigationType == .linkActivated { openExternal(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) { decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download) }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { openExternal(url) }; return nil
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent; panel.canCreateDirectories = true
        downloadPanels[ObjectIdentifier(download)] = panel
        panel.beginSheetModal(for: window) { [weak self] result in self?.downloadPanels.removeValue(forKey: ObjectIdentifier(download)); completionHandler(result == .OK ? panel.url : nil) }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { if (error as NSError).code != NSURLErrorCancelled { let alert = NSAlert(); alert.messageText = "Download didn’t finish"; alert.informativeText = error.localizedDescription; alert.beginSheetModal(for: window) } }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard let url = frame.request.url, isAppURL(url) else { completionHandler(nil); return }
        let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = parameters.allowsDirectories; panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let arguments = ProcessInfo.processInfo.arguments
        let auditAllowed = config.attachOnly == true || ProcessInfo.processInfo.environment["LITESPEED_DESKTOP_AUDIT"] == "1"
        guard !audited, auditAllowed, let index = arguments.firstIndex(of: "--audit-dir"), arguments.count > index + 1, arguments[index + 1].hasPrefix("/"), let url = webView.url, isAppURL(url) else { return }
        audited = true
        let directory = URL(fileURLWithPath: arguments[index + 1], isDirectory: true)
        Task {
            do {
                _ = try await webView.callAsyncJavaScript("for(let i=0;i<100&&!document.querySelector('.app');i++)await new Promise(r=>setTimeout(r,100));await document.fonts.ready;", arguments: [:], in: nil, contentWorld: .page)
                if let step = arguments.firstIndex(of: "--audit-command"), arguments.count > step + 1 { command(arguments[step + 1]); try await Task.sleep(for: .milliseconds(400)) }
                let result = try await webView.evaluateJavaScript("JSON.stringify({url:location.href,title:document.title,text:document.body.innerText.slice(0,16000),desktop:document.documentElement.dataset.desktop,bridge:!!window.litespeedDesktop,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth})")
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                if let result = result as? String { try result.write(to: directory.appendingPathComponent("native-state.json"), atomically: true, encoding: .utf8) }
                let image = try await webView.takeSnapshot(configuration: nil)
                if let data = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) { try png.write(to: directory.appendingPathComponent("native-webview.png")) }
            } catch { try? error.localizedDescription.write(to: directory.appendingPathComponent("native-error.txt"), atomically: true, encoding: .utf8) }
        }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { window?.makeKeyAndOrderFront(nil); return true }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { webView?.configuration.userContentController.removeScriptMessageHandler(forName: "desktop", contentWorld: .page) }
}

MainActor.assumeIsolated {
    let application = NSApplication.shared
    let delegate = DesktopApp()
    application.delegate = delegate
    application.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) { application.run() }
}
