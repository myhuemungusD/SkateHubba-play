import Foundation

/// Swift mirror of src/lib/clipEditor/types.ts. Keep in sync.
struct EditAngle: Decodable {
    let id: String
    let label: String
    let durationSec: Double
    let offsetSec: Double
}

struct AngleCut: Decodable {
    let atSec: Double
    let angleId: String
}

struct SpeedKey: Decodable {
    let atSec: Double
    let speed: Double
}

struct TextOverlay: Decodable {
    let id: String
    let text: String
    let outStartSec: Double
    let outEndSec: Double
    let style: String
}

struct SfxPlacement: Decodable {
    let id: String
    let soundId: String
    let outAtSec: Double
    let gain: Double
}

struct MusicChoice: Decodable {
    let trackId: String
    let trackOffsetSec: Double
    let gain: Double
    let originalGain: Double
}

struct EditProject: Decodable {
    let angles: [EditAngle]
    let cuts: [AngleCut]
    let trimInSec: Double
    let trimOutSec: Double
    let landingSec: Double?
    let speed: [SpeedKey]
    let look: String
    let lookStrength: Double
    let color: String
    let overlays: [TextOverlay]
    let music: MusicChoice?
    let sfx: [SfxPlacement]
    let stabilize: Bool
}

struct RenderPlan {
    let width: Int
    let height: Int
    let fps: Int
    let bitrate: Int
}

/// One constant-speed, single-angle stretch of the edit, in source seconds
/// on angle 0's clock.
struct Piece {
    let from: Double
    let to: Double
    let speed: Double
    let angleId: String
}

enum Timeline {
    static let minSpeed = 0.125
    static let maxSpeed = 4.0

    /// Mirrors speedSegments() + angleAt() in TS: split the trim window at
    /// every speed key and every cut.
    static func pieces(_ p: EditProject) -> [Piece] {
        var bounds = Set<Double>([p.trimInSec, p.trimOutSec])
        for k in p.speed where k.atSec > p.trimInSec && k.atSec < p.trimOutSec { bounds.insert(k.atSec) }
        for c in p.cuts where c.atSec > p.trimInSec && c.atSec < p.trimOutSec { bounds.insert(c.atSec) }
        let sorted = bounds.sorted()
        var out: [Piece] = []
        for i in 0..<(sorted.count - 1) {
            let a = sorted[i], b = sorted[i + 1]
            if b - a < 1.0 / 240.0 { continue }
            out.append(Piece(from: a, to: b, speed: speedAt(p, a), angleId: angleAt(p, a)))
        }
        return out
    }

    static func speedAt(_ p: EditProject, _ t: Double) -> Double {
        var s = 1.0
        for k in p.speed.sorted(by: { $0.atSec < $1.atSec }) {
            if k.atSec <= t { s = k.speed } else { break }
        }
        return min(maxSpeed, max(minSpeed, s))
    }

    static func angleAt(_ p: EditProject, _ t: Double) -> String {
        var id = p.angles.first?.id ?? ""
        for c in p.cuts.sorted(by: { $0.atSec < $1.atSec }) {
            if c.atSec <= t { id = c.angleId } else { break }
        }
        return id
    }
}

/// Mirrors src/lib/clipEditor/looks.ts.
struct LookParams {
    var barrel = 0.0, vignette = 0.0, grain = 0.0, chromaShift = 0.0, scanlines = 0.0, blur = 0.0
    var fourByThree = false, timestamp = false

    static func make(_ id: String, strength: Double) -> LookParams {
        let s = min(1, max(0, strength))
        var p = LookParams()
        switch id {
        case "vx1000": p.barrel = 2.2; p.vignette = 0.55; p.grain = 0.15; p.fourByThree = true
        case "fisheye": p.barrel = 1.6; p.vignette = 0.4
        case "vhs": p.vignette = 0.25; p.grain = 0.35; p.chromaShift = 3; p.scanlines = 0.35; p.blur = 0.4; p.timestamp = true
        case "hi8": p.vignette = 0.2; p.grain = 0.2; p.chromaShift = 1.5; p.scanlines = 0.12; p.blur = 0.2; p.timestamp = true
        default: break
        }
        p.barrel *= s; p.vignette *= s; p.grain *= s; p.chromaShift *= s; p.scanlines *= s; p.blur *= s
        return p
    }
}
