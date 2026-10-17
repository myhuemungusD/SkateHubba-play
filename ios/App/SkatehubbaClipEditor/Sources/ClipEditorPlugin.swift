import AVFoundation
import Capacitor
import Foundation
import Photos

/// `ClipEditor` Capacitor plugin. JS side: src/services/clipEditorNative.ts.
@objc(ClipEditorPlugin)
public class ClipEditorPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClipEditorPlugin"
    public let jsName = "ClipEditor"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeSourceChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "render", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private var renderer: ClipRenderer?

    private static var workDir: URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("clipeditor", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        let presets = AVAssetExportSession.allExportPresets()
        call.resolve([
            "available": true,
            "maxWidth": 3840,
            "maxFps": 60,
            "hevc": presets.contains(AVAssetExportPresetHEVCHighestQuality)
        ])
    }

    @objc func writeSourceChunk(_ call: CAPPluginCall) {
        guard let rawId = call.getString("id"), let b64 = call.getString("data"),
              let data = Data(base64Encoded: b64) else {
            return call.reject("Missing id or data")
        }
        let id = rawId.replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression)
        let url = Self.workDir.appendingPathComponent("src-\(id).mp4")
        let append = call.getBool("append") ?? false
        do {
            if append, let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } else {
                try data.write(to: url, options: .atomic)
            }
            call.resolve(["fileUrl": url.absoluteString])
        } catch {
            call.reject("Could not stage clip: \(error.localizedDescription)")
        }
    }

    @objc func render(_ call: CAPPluginCall) {
        guard renderer == nil else { return call.reject("A render is already running") }
        guard let projectObj = call.getObject("project"),
              let planObj = call.getObject("plan"),
              let sourcesObj = call.getObject("sources") else {
            return call.reject("Missing project, plan or sources")
        }
        let project: EditProject
        do {
            let data = try JSONSerialization.data(withJSONObject: projectObj)
            project = try JSONDecoder().decode(EditProject.self, from: data)
        } catch {
            return call.reject("Bad project: \(error.localizedDescription)")
        }
        let plan = RenderPlan(
            width: planObj["width"] as? Int ?? 1920,
            height: planObj["height"] as? Int ?? 1080,
            fps: planObj["fps"] as? Int ?? 30,
            bitrate: planObj["bitrate"] as? Int ?? 12_000_000)
        var sources: [String: URL] = [:]
        for (k, v) in sourcesObj { if let s = v as? String, let u = URL(string: s) { sources[k] = u } }
        var audio: [String: URL] = [:]
        for (k, v) in call.getObject("audio") ?? [:] {
            if let s = v as? String, let u = Self.bundledAsset(for: s) { audio[k] = u }
        }
        let matrix = (call.getArray("colorMatrix") as? [NSNumber])?.map { CGFloat(truncating: $0) }
        let saveToPhotos = call.getBool("saveToPhotos") ?? false
        let out = Self.workDir.appendingPathComponent("edit-\(UUID().uuidString).mp4")

        let r = ClipRenderer(project: project, plan: plan, sources: sources, audio: audio, colorMatrix: matrix, output: out)
        renderer = r
        r.onProgress = { [weak self] p in self?.notifyListeners("progress", data: ["progress": p]) }
        r.run { [weak self] result in
            self?.renderer = nil
            switch result {
            case .failure(let error):
                call.reject(error.localizedDescription)
            case .success(let url):
                let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
                guard saveToPhotos else {
                    return call.resolve(["fileUrl": url.absoluteString, "bytes": bytes, "savedToPhotos": false])
                }
                Self.saveToPhotos(url) { saved in
                    call.resolve(["fileUrl": url.absoluteString, "bytes": bytes, "savedToPhotos": saved])
                }
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        renderer?.cancel()
        call.resolve()
    }

    /// Audio assets ship inside the web bundle (App/public/editor/...). The
    /// web view hands us its own URL; map the path back to the bundle file.
    static func bundledAsset(for urlString: String) -> URL? {
        guard let path = URL(string: urlString)?.path, path.hasPrefix("/editor/") else { return nil }
        let file = Bundle.main.bundleURL.appendingPathComponent("public").appendingPathComponent(String(path.dropFirst()))
        return FileManager.default.fileExists(atPath: file.path) ? file : nil
    }

    static func saveToPhotos(_ url: URL, completion: @escaping (Bool) -> Void) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else { return completion(false) }
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)
            }, completionHandler: { ok, _ in completion(ok) })
        }
    }
}
