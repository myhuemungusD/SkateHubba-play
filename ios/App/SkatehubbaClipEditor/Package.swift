// swift-tools-version: 5.9
import PackageDescription

// Local package for the clip editor's native renderer (AVFoundation + Core
// Image + Vision). Local rather than an npm Capacitor plugin because it is
// iOS-only app code; it is registered with the bridge by
// SkateBridgeViewController (set as the storyboard's root view controller).
let package = Package(
    name: "SkatehubbaClipEditor",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "SkatehubbaClipEditor",
            targets: ["SkatehubbaClipEditor"])
    ],
    dependencies: [
        // Range, not exact: `cap sync` pins CapApp-SPM to the installed
        // @capacitor/ios version and SwiftPM needs one version for both.
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", .upToNextMajor(from: "8.0.0"))
    ],
    targets: [
        .target(
            name: "SkatehubbaClipEditor",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "Sources")
    ]
)
