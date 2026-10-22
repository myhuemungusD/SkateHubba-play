import Foundation
import FirebaseCore
import FirebaseMessaging
import FirebaseAuth
import FirebaseAppCheck
import UIKit

/// Turns the APNs device token Capacitor already receives into the FCM
/// registration token the push sender (`api/cron/drain-push-dispatch.ts`)
/// actually delivers to.
///
/// `FirebaseApp.configure()` crashes when `GoogleService-Info.plist` is
/// missing, so every entry point no-ops until that file is in the bundle.
/// Simulator and CI builds do not have it; a TestFlight build does.
public enum SkatehubbaFcm {
    /// Configure Firebase if the plist is present and nothing else has yet.
    /// Safe to call on every launch.
    public static func configureIfPossible() {
        // App Check's provider must be set before configure() (Firebase docs),
        // so it is set here, first thing at launch. JS bridges the token into
        // the web SDK (src/lib/nativeAppCheck.ts) and never resets the factory.
        AppCheck.setAppCheckProviderFactory(SkatehubbaAppCheckProviderFactory())
        if FirebaseApp.app() != nil { return }
        guard FirebaseOptions.defaultOptions() != nil else { return }
        FirebaseApp.configure()
    }

    /// Bind `deviceToken` as the APNs token and return the FCM registration
    /// token. Completion receives nil when Firebase is not configured or
    /// Messaging cannot mint a token (no network, no APNs auth key yet).
    public static func exchangeApnsToken(_ deviceToken: Data, completion: @escaping (String?) -> Void) {
        guard FirebaseApp.app() != nil else {
            completion(nil)
            return
        }
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token { token, _ in
            if let token, !token.isEmpty {
                completion(token)
            } else {
                completion(nil)
            }
        }
    }

    // MARK: Firebase Auth phone verification
    // FirebaseAppDelegateProxyEnabled is false in Info.plist, so Auth never
    // sees APNs traffic on its own. These forwarders let native phone/SMS
    // verification use the silent push (best path); reCAPTCHA via the
    // encoded app-id URL scheme stays the fallback.

    /// Hand the APNs token to Firebase Auth. Type `.unknown` lets the SDK
    /// pick sandbox vs production from the provisioning profile.
    public static func forwardApnsTokenToAuth(_ deviceToken: Data) {
        guard FirebaseApp.app() != nil else { return }
        Auth.auth().setAPNSToken(deviceToken, type: .unknown)
    }

    /// True when the push was Firebase Auth's silent verification push.
    public static func authCanHandleNotification(_ userInfo: [AnyHashable: Any]) -> Bool {
        guard FirebaseApp.app() != nil else { return false }
        return Auth.auth().canHandleNotification(userInfo)
    }

    /// True when the URL is the reCAPTCHA fallback returning to the app.
    public static func authCanHandle(_ url: URL) -> Bool {
        guard FirebaseApp.app() != nil else { return false }
        return Auth.auth().canHandle(url)
    }
}

/// App Attest on devices (DeviceCheck if App Attest is unavailable). The
/// simulator can't attest, so it uses the debug provider: the token prints in
/// the Xcode console and must be added in Firebase > App Check > Manage debug
/// tokens. Simulators never ship, so this can't reach a store build.
final class SkatehubbaAppCheckProviderFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        #if targetEnvironment(simulator)
        return AppCheckDebugProvider(app: app)
        #else
        if let appAttest = AppAttestProvider(app: app) { return appAttest }
        return DeviceCheckProvider(app: app)
        #endif
    }
}
