import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit
import Vision

enum RenderError: LocalizedError {
    case missingSource(String), noVideo, cancelled, failed(String)
    var errorDescription: String? {
        switch self {
        case .missingSource(let id): return "Missing clip for \(id)"
        case .noVideo: return "That clip has no video track"
        case .cancelled: return "Export cancelled"
        case .failed(let m): return m
        }
    }
}

/// Builds the edit as an AVMutableComposition (pieces inserted per angle and
/// time-scaled per speed segment), filters every frame with Core Image, mixes
/// music + SFX with an AVAudioMix, and writes MPEG-4 with AVAssetWriter so the
/// bitrate is exactly what the export plan asked for.
final class ClipRenderer {
    let project: EditProject
    let plan: RenderPlan
    let sources: [String: URL]
    let audio: [String: URL]
    let colorMatrix: [CGFloat]?
    let output: URL
    var onProgress: ((Double) -> Void)?

    private var reader: AVAssetReader?
    private var writer: AVAssetWriter?
    private var cancelled = false
    private let queue = DispatchQueue(label: "clipeditor.render")

    init(project: EditProject, plan: RenderPlan, sources: [String: URL], audio: [String: URL], colorMatrix: [CGFloat]?, output: URL) {
        self.project = project
        self.plan = plan
        self.sources = sources
        self.audio = audio
        self.colorMatrix = colorMatrix
        self.output = output
    }

    func cancel() {
        cancelled = true
        reader?.cancelReading()
        writer?.cancelWriting()
    }

    func run(completion: @escaping (Result<URL, Error>) -> Void) {
        Task.detached(priority: .userInitiated) {
            do {
                let url = try await self.render()
                DispatchQueue.main.async { completion(.success(url)) }
            } catch {
                try? FileManager.default.removeItem(at: self.output)
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
    }

    // MARK: Composition

    private struct Built {
        let composition: AVMutableComposition
        let videoTrack: AVMutableCompositionTrack
        let audioParams: [AVMutableAudioMixInputParameters]
        let renderSize: CGSize
        let duration: CMTime
    }

    private func build() async throws -> Built {
        guard let main = project.angles.first, let mainURL = sources[main.id] else { throw RenderError.missingSource("angle 1") }
        let comp = AVMutableComposition()
        guard let vTrack = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let aTrack = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw RenderError.failed("Could not create composition")
        }

        var videoTracks: [String: AVAssetTrack] = [:]
        for a in project.angles {
            guard let u = sources[a.id] else { throw RenderError.missingSource(a.label) }
            let asset = AVURLAsset(url: u, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
            guard let t = try await asset.loadTracks(withMediaType: .video).first else { throw RenderError.noVideo }
            videoTracks[a.id] = t
        }
        let mainAsset = AVURLAsset(url: mainURL, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let mainAudio = try await mainAsset.loadTracks(withMediaType: .audio).first
        guard let mainVideo = videoTracks[main.id] else { throw RenderError.noVideo }
        let transform = try await mainVideo.load(.preferredTransform)
        let natural = try await mainVideo.load(.naturalSize).applying(transform)
        vTrack.preferredTransform = transform

        let ts: CMTimeScale = 600
        var cursor = CMTime.zero
        for piece in Timeline.pieces(project) {
            let angle = project.angles.first { $0.id == piece.angleId } ?? main
            guard let src = videoTracks[angle.id] else { continue }
            let start = CMTime(seconds: max(0, piece.from - angle.offsetSec), preferredTimescale: ts)
            let srcDur = CMTime(seconds: piece.to - piece.from, preferredTimescale: ts)
            let range = CMTimeRange(start: start, duration: srcDur)
            try vTrack.insertTimeRange(range, of: src, at: cursor)
            if let mainAudio {
                let aRange = CMTimeRange(start: CMTime(seconds: piece.from, preferredTimescale: ts), duration: srcDur)
                try? aTrack.insertTimeRange(aRange, of: mainAudio, at: cursor)
            }
            let outDur = CMTime(seconds: (piece.to - piece.from) / piece.speed, preferredTimescale: ts)
            comp.scaleTimeRange(CMTimeRange(start: cursor, duration: srcDur), toDuration: outDur)
            cursor = cursor + outDur
        }
        let duration = cursor

        var params: [AVMutableAudioMixInputParameters] = []
        let original = AVMutableAudioMixInputParameters(track: aTrack)
        original.setVolume(Float(project.music?.originalGain ?? 1), at: .zero)
        original.audioTimePitchAlgorithm = .spectral
        params.append(original)

        if let music = project.music, let url = audio[music.trackId] {
            let asset = AVURLAsset(url: url)
            if let src = try await asset.loadTracks(withMediaType: .audio).first,
               let track = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                let len = try await asset.load(.duration)
                var at = CMTime.zero
                var offset = CMTime(seconds: music.trackOffsetSec.truncatingRemainder(dividingBy: max(len.seconds, 0.001)), preferredTimescale: ts)
                while at < duration && len.seconds > 0 {
                    let chunk = CMTimeMinimum(len - offset, duration - at)
                    try track.insertTimeRange(CMTimeRange(start: offset, duration: chunk), of: src, at: at)
                    at = at + chunk
                    offset = .zero
                }
                let p = AVMutableAudioMixInputParameters(track: track)
                p.setVolume(Float(music.gain), at: .zero)
                params.append(p)
            }
        }

        for s in project.sfx {
            guard let url = audio[s.soundId] else { continue }
            let asset = AVURLAsset(url: url)
            guard let src = try await asset.loadTracks(withMediaType: .audio).first,
                  let track = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }
            let len = try await asset.load(.duration)
            let at = CMTime(seconds: s.outAtSec, preferredTimescale: ts)
            guard at < duration else { continue }
            // Trim in/out (file seconds), mirroring sfxSpan() in overlays.ts.
            let full = len.seconds
            let minLen = 0.05
            let startSec = min(max(s.trimStartSec ?? 0, 0), max(0, full - minLen))
            let endSec = min(max(s.trimEndSec ?? full, min(full, startSec + minLen)), full)
            let playLen = min(endSec - startSec, (duration - at).seconds)
            guard playLen > 0 else { continue }
            let start = CMTime(seconds: startSec, preferredTimescale: ts)
            let span = CMTime(seconds: playLen, preferredTimescale: ts)
            try track.insertTimeRange(CMTimeRange(start: start, duration: span), of: src, at: at)
            let p = AVMutableAudioMixInputParameters(track: track)
            // 12 ms fades at both cut points so trims never click (SFX_FADE_SEC).
            let gain = Float(s.gain)
            let fade = CMTime(seconds: min(0.012, playLen / 2), preferredTimescale: ts)
            p.setVolume(0, at: .zero)
            p.setVolumeRamp(fromStartVolume: 0, toEndVolume: gain, timeRange: CMTimeRange(start: at, duration: fade))
            p.setVolumeRamp(fromStartVolume: gain, toEndVolume: 0, timeRange: CMTimeRange(start: at + span - fade, duration: fade))
            params.append(p)
        }

        let portrait = abs(natural.height) > abs(natural.width)
        let long = max(plan.width, plan.height), short = min(plan.width, plan.height)
        let size = portrait ? CGSize(width: short, height: long) : CGSize(width: long, height: short)
        return Built(composition: comp, videoTrack: vTrack, audioParams: params, renderSize: size, duration: duration)
    }

    // MARK: Render

    private func render() async throws -> URL {
        let b = try await build()
        let stab = project.stabilize ? try await Stabilizer.analyze(b.composition, renderSize: b.renderSize, cancelled: { self.cancelled }) : nil
        if cancelled { throw RenderError.cancelled }

        let fx = FrameFilter(project: project, renderSize: b.renderSize, colorMatrix: colorMatrix, stabilizer: stab)
        let vc = AVMutableVideoComposition(asset: b.composition) { request in
            let t = request.compositionTime.seconds
            request.finish(with: fx.apply(request.sourceImage, at: t), context: nil)
        }
        vc.renderSize = b.renderSize
        vc.frameDuration = CMTime(value: 1, timescale: CMTimeScale(plan.fps))

        let mix = AVMutableAudioMix()
        mix.inputParameters = b.audioParams

        let reader = try AVAssetReader(asset: b.composition)
        reader.timeRange = CMTimeRange(start: .zero, duration: b.duration)
        let vOut = AVAssetReaderVideoCompositionOutput(videoTracks: [b.videoTrack], videoSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ])
        vOut.videoComposition = vc
        vOut.alwaysCopiesSampleData = false
        reader.add(vOut)
        let audioTracks = b.composition.tracks(withMediaType: .audio).filter { !$0.segments.isEmpty }
        var aOut: AVAssetReaderAudioMixOutput?
        if !audioTracks.isEmpty {
            let o = AVAssetReaderAudioMixOutput(audioTracks: audioTracks, audioSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2,
                AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false
            ])
            o.audioMix = mix
            reader.add(o)
            aOut = o
        }

        let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
        let hevc = plan.width * plan.height >= 3840 * 2160 / 2
        let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: hevc ? AVVideoCodecType.hevc : AVVideoCodecType.h264,
            AVVideoWidthKey: Int(b.renderSize.width),
            AVVideoHeightKey: Int(b.renderSize.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: plan.bitrate,
                AVVideoExpectedSourceFrameRateKey: plan.fps,
                AVVideoMaxKeyFrameIntervalKey: plan.fps * 2
            ] as [String: Any]
        ])
        vIn.expectsMediaDataInRealTime = false
        writer.add(vIn)
        var aIn: AVAssetWriterInput?
        if aOut != nil {
            let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192_000
            ])
            i.expectsMediaDataInRealTime = false
            writer.add(i)
            aIn = i
        }
        writer.shouldOptimizeForNetworkUse = true

        self.reader = reader
        self.writer = writer
        guard reader.startReading() else { throw RenderError.failed(reader.error?.localizedDescription ?? "Reader failed") }
        guard writer.startWriting() else { throw RenderError.failed(writer.error?.localizedDescription ?? "Writer failed") }
        writer.startSession(atSourceTime: .zero)

        let total = max(b.duration.seconds, 0.001)
        let group = DispatchGroup()
        group.enter()
        vIn.requestMediaDataWhenReady(on: queue) { [weak self] in
            while vIn.isReadyForMoreMediaData {
                guard let self, !self.cancelled, let sample = vOut.copyNextSampleBuffer() else {
                    vIn.markAsFinished()
                    group.leave()
                    return
                }
                let t = CMSampleBufferGetPresentationTimeStamp(sample).seconds
                if !vIn.append(sample) { reader.cancelReading() }
                let p = min(1, t / total)
                DispatchQueue.main.async { self.onProgress?(p) }
            }
        }
        if let aIn, let aOut {
            let aQueue = DispatchQueue(label: "clipeditor.audio")
            group.enter()
            aIn.requestMediaDataWhenReady(on: aQueue) { [weak self] in
                while aIn.isReadyForMoreMediaData {
                    guard let self, !self.cancelled, let sample = aOut.copyNextSampleBuffer() else {
                        aIn.markAsFinished()
                        group.leave()
                        return
                    }
                    aIn.append(sample)
                }
            }
        }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in group.notify(queue: queue) { c.resume() } }
        if cancelled {
            writer.cancelWriting()
            throw RenderError.cancelled
        }
        if reader.status == .failed { throw RenderError.failed(reader.error?.localizedDescription ?? "Read failed") }
        await writer.finishWriting()
        if writer.status != .completed { throw RenderError.failed(writer.error?.localizedDescription ?? "Write failed") }
        return output
    }
}
