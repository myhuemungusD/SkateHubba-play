import AVFoundation
import CoreImage
import Vision

/// Two-pass stabilization: measure frame-to-frame translation with Vision on a
/// small proxy, smooth the camera path, then shift each frame by
/// (smoothed − raw) and zoom slightly to hide the edges.
final class Stabilizer {
    static let zoom: CGFloat = 1.1
    private static let proxyWidth: CGFloat = 320
    private static let window = 15

    private var times: [Double] = []
    private var corrections: [CGPoint] = []

    static func analyze(_ asset: AVAsset, renderSize: CGSize, cancelled: @escaping () -> Bool) async throws -> Stabilizer? {
        let track = asset.tracks(withMediaType: .video).first
        guard let track else { return nil }
        let scale = proxyWidth / max(renderSize.width, 1)
        let proxy = CGSize(width: proxyWidth, height: (renderSize.height * scale).rounded())
        let vc = AVMutableVideoComposition(propertiesOf: asset)
        vc.renderSize = proxy
        vc.frameDuration = CMTime(value: 1, timescale: 30)
        let reader = try AVAssetReader(asset: asset)
        let out = AVAssetReaderVideoCompositionOutput(videoTracks: [track], videoSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ])
        out.videoComposition = vc
        reader.add(out)
        guard reader.startReading() else { return nil }

        var times: [Double] = []
        var path: [CGPoint] = []
        var prev: CVPixelBuffer?
        var acc = CGPoint.zero
        while let sample = out.copyNextSampleBuffer() {
            if cancelled() {
                reader.cancelReading()
                return nil
            }
            guard let buf = CMSampleBufferGetImageBuffer(sample) else { continue }
            if let prev {
                let req = VNTranslationalImageRegistrationRequest(targetedCVPixelBuffer: buf)
                try? VNImageRequestHandler(cvPixelBuffer: prev, options: [:]).perform([req])
                if let t = (req.results?.first as? VNImageTranslationAlignmentObservation)?.alignmentTransform {
                    acc.x += t.tx
                    acc.y += t.ty
                }
            }
            prev = buf
            times.append(CMSampleBufferGetPresentationTimeStamp(sample).seconds)
            path.append(acc)
        }
        guard path.count > 2 else { return nil }
        let s = Stabilizer()
        s.times = times
        let up = 1 / scale
        for i in path.indices {
            let lo = max(0, i - window), hi = min(path.count - 1, i + window)
            var sx: CGFloat = 0, sy: CGFloat = 0
            for j in lo...hi { sx += path[j].x; sy += path[j].y }
            let n = CGFloat(hi - lo + 1)
            // Shift the frame back onto the smoothed path, in render pixels,
            // clamped to what the zoom margin can hide.
            let maxShift = (zoom - 1) / 2
            let cx = max(-renderSize.width * maxShift, min(renderSize.width * maxShift, (path[i].x - sx / n) * up))
            let cy = max(-renderSize.height * maxShift, min(renderSize.height * maxShift, (path[i].y - sy / n) * up))
            s.corrections.append(CGPoint(x: cx, y: cy))
        }
        return s
    }

    func correction(at t: Double) -> CGPoint? {
        guard !times.isEmpty else { return nil }
        var lo = 0, hi = times.count - 1
        while lo < hi {
            let mid = (lo + hi) / 2
            if times[mid] < t { lo = mid + 1 } else { hi = mid }
        }
        return corrections[lo]
    }
}
