// swift-tools-version: 5.9
import PackageDescription

// Local package so the iOS shell can exchange an APNs device token for an
// FCM registration token. It is not an npm Capacitor plugin on purpose:
// @capacitor-firebase/messaging replaces Capacitor's notification handler
// and would be synced into the Android project, which already gets FCM
// tokens from @capacitor/push-notifications.
let package = Package(
    name: "SkatehubbaFcm",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "SkatehubbaFcm",
            targets: ["SkatehubbaFcm"])
    ],
    dependencies: [
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", .upToNextMajor(from: "12.7.0"))
    ],
    targets: [
        .target(
            name: "SkatehubbaFcm",
            dependencies: [
                .product(name: "FirebaseCore", package: "firebase-ios-sdk"),
                .product(name: "FirebaseMessaging", package: "firebase-ios-sdk")
            ],
            path: "Sources")
    ]
)
