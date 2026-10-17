import Capacitor
import UIKit

/// Root view controller (Main.storyboard). Identical to Capacitor's bridge
/// controller, plus registration of the app's local plugins.
@objc(SkateBridgeViewController)
open class SkateBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(ClipEditorPlugin())
    }
}

public enum SkatehubbaClipEditor {
    /// Referenced from AppDelegate so the linker never strips the controller
    /// the storyboard instantiates by name.
    public static func ensureLinked() {
        _ = SkateBridgeViewController.self
    }
}
