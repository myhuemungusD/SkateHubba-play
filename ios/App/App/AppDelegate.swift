import UIKit
import WebKit
import Capacitor
import SkatehubbaFcm

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // No-ops when GoogleService-Info.plist is absent, so unsigned
        // simulator builds still launch. See ios/App/SkatehubbaFcm.
        SkatehubbaFcm.configureIfPossible()
        enableEdgeSwipeBack()
        deliverScreenshotRoute()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
        SkatehubbaFcm.exchangeApnsToken(deviceToken) { token in
            guard let token else { return }
            self.deliverFcmToken(token)
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // The webview may not exist yet during didFinishLaunching.
        enableEdgeSwipeBack()
        deliverScreenshotRoute()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    /// iOS has no hardware back button. The edge swipe is the system back
    /// gesture, and WKWebView leaves it off unless we turn it on. Android
    /// back is handled in src/services/nativeApp.ts.
    private func enableEdgeSwipeBack() {
        bridgeController()?.webView?.allowsBackForwardNavigationGestures = true
    }

    /// Push the FCM token into the page. JS may not be listening yet (the
    /// APNs callback can beat the React tree), so the value is also parked
    /// on `window.__skatehubbaFcmToken` and the event is repeated for a few
    /// seconds. `arrayUnion` makes a duplicate write a no-op.
    private func deliverFcmToken(_ token: String) {
        let escaped = token
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        let js = """
        window.__skatehubbaFcmToken = '\(escaped)';
        window.dispatchEvent(new CustomEvent('skatehubba:fcm-token', { detail: { token: window.__skatehubbaFcmToken } }));
        """
        func attempt(_ remaining: Int) {
            DispatchQueue.main.async {
                self.bridgeController()?.webView?.evaluateJavaScript(js, completionHandler: nil)
                if remaining > 0 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                        attempt(remaining - 1)
                    }
                }
            }
        }
        attempt(8)
    }

    /// Debug builds accept `-SKATEHUBBA_ROUTE /privacy` from `simctl launch`
    /// so the screenshot job can open a screen without `simctl openurl`.
    /// openurl raises an "Open in SkateHubba?" confirmation and never
    /// delivers the link. Release builds compile this to a no-op.
    private func deliverScreenshotRoute() {
        #if DEBUG
        guard let route = Self.screenshotRoute() else { return }
        let js = "window.dispatchEvent(new CustomEvent('skatehubba:screenshot-route', { detail: '\(route)' }));"
        func attempt(_ remaining: Int) {
            DispatchQueue.main.async {
                self.bridgeController()?.webView?.evaluateJavaScript(js, completionHandler: nil)
                if remaining > 0 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                        attempt(remaining - 1)
                    }
                }
            }
        }
        attempt(15)
        #endif
    }

    /// A route is a path such as `/auth` or `/privacy`. Anything else is
    /// ignored so the argument cannot become JavaScript.
    #if DEBUG
    private static func screenshotRoute() -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let flag = args.firstIndex(of: "-SKATEHUBBA_ROUTE"), flag + 1 < args.count else { return nil }
        let route = args[flag + 1]
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-")
        guard route.hasPrefix("/"),
              !route.hasPrefix("//"),
              route.count <= 80,
              route.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }
        return route
    }
    #endif

    private func bridgeController() -> CAPBridgeViewController? {
        let keyWindow = window
            ?? UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first { $0.isKeyWindow }
        let root = keyWindow?.rootViewController
        return root as? CAPBridgeViewController
    }
}
