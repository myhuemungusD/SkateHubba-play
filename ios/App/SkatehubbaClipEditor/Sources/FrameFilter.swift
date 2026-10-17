import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

/// Per-frame Core Image graph. Mirrors the WebGL shader in
/// src/lib/clipEditor/shader.ts (same order: stabilize → fit → barrel →
/// chroma → blur → color → scanlines → grain → vignette → 4:3 → captions).
final class FrameFilter {
    private let project: EditProject
    private let size: CGSize
    private let look: LookParams
    private let matrix: [CGFloat]?
    private let stabilizer: Stabilizer?
    private let captions: [(start: Double, end: Double, image: CIImage)]
    private let stamp: CIImage?
    private let noise = CIFilter.randomGenerator().outputImage

    init(project: EditProject, renderSize: CGSize, colorMatrix: [CGFloat]?, stabilizer: Stabilizer?) {
        self.project = project
        self.size = renderSize
        self.look = LookParams.make(project.look, strength: project.lookStrength)
        self.matrix = colorMatrix?.count == 20 ? colorMatrix : nil
        self.stabilizer = stabilizer
        var caps: [(Double, Double, CIImage)] = []
        let rows = Dictionary(grouping: project.overlays.enumerated(), by: { $0.element.outStartSec })
        for o in project.overlays {
            let row = rows[o.outStartSec]?.firstIndex(where: { $0.element.id == o.id }) ?? 0
            if let img = CaptionRenderer.caption(o.text, style: o.style, size: renderSize, row: row) {
                caps.append((o.outStartSec, o.outEndSec, img))
            }
        }
        self.captions = caps
        self.stamp = look.timestamp ? CaptionRenderer.tapeStamp(size: renderSize, date: Date()) : nil
    }

    func apply(_ source: CIImage, at t: Double) -> CIImage {
        let frame = CGRect(origin: .zero, size: size)
        var img = source.transformed(by: CGAffineTransform(translationX: -source.extent.minX, y: -source.extent.minY))

        // Aspect-fill into the render size.
        let scale = max(size.width / img.extent.width, size.height / img.extent.height)
        img = img.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        img = img.transformed(by: CGAffineTransform(translationX: (size.width - img.extent.width) / 2, y: (size.height - img.extent.height) / 2))

        if let stabilizer, let c = stabilizer.correction(at: t) {
            // Shift by the correction, then zoom in to hide the moving edges.
            let z = Stabilizer.zoom
            img = img.transformed(by: CGAffineTransform(translationX: c.x, y: c.y))
            img = img.transformed(by: CGAffineTransform(translationX: -size.width / 2, y: -size.height / 2)
                .concatenating(CGAffineTransform(scaleX: z, y: z))
                .concatenating(CGAffineTransform(translationX: size.width / 2, y: size.height / 2)))
        }
        img = img.clampedToExtent().cropped(to: frame)

        if look.barrel > 0.001 {
            let f = CIFilter.bumpDistortion()
            f.inputImage = img.clampedToExtent()
            f.center = CGPoint(x: size.width / 2, y: size.height / 2)
            f.radius = Float(hypot(size.width, size.height) / 2)
            f.scale = Float(min(1, look.barrel * 0.28))
            img = (f.outputImage ?? img).cropped(to: frame)
        }

        if look.chromaShift > 0 {
            let px = look.chromaShift * size.height / 1080
            let red = channel(img, r: 1, g: 0, b: 0).transformed(by: CGAffineTransform(translationX: px, y: 0))
            let gb = channel(img, r: 0, g: 1, b: 1)
            let add = CIFilter.additionCompositing()
            add.inputImage = red
            add.backgroundImage = gb
            img = (add.outputImage ?? img).cropped(to: frame)
        }

        if look.blur > 0 {
            let f = CIFilter.gaussianBlur()
            f.inputImage = img.clampedToExtent()
            f.radius = Float(look.blur * 2.5 * size.height / 1080)
            img = (f.outputImage ?? img).cropped(to: frame)
        }

        if let m = matrix {
            let f = CIFilter.colorMatrix()
            f.inputImage = img
            f.rVector = CIVector(x: m[0], y: m[1], z: m[2], w: m[3])
            f.gVector = CIVector(x: m[5], y: m[6], z: m[7], w: m[8])
            f.bVector = CIVector(x: m[10], y: m[11], z: m[12], w: m[13])
            f.aVector = CIVector(x: m[15], y: m[16], z: m[17], w: m[18])
            f.biasVector = CIVector(x: m[4], y: m[9], z: m[14], w: m[19])
            img = (f.outputImage ?? img).cropped(to: frame)
        }

        if look.scanlines > 0 {
            let stripes = CIFilter.stripesGenerator()
            stripes.color0 = CIColor(red: 0, green: 0, blue: 0, alpha: look.scanlines * 0.5)
            stripes.color1 = CIColor(red: 0, green: 0, blue: 0, alpha: 0)
            stripes.width = Float(max(1, size.height / 540))
            stripes.sharpness = 0.5
            if let s = stripes.outputImage?.transformed(by: CGAffineTransform(rotationAngle: .pi / 2)).cropped(to: frame) {
                img = s.composited(over: img)
            }
        }

        if look.grain > 0, let n = noise {
            let jitter = CGAffineTransform(translationX: CGFloat((t * 997).truncatingRemainder(dividingBy: 512)), y: CGFloat((t * 613).truncatingRemainder(dividingBy: 512)))
            let gray = CIFilter.colorMatrix()
            gray.inputImage = n.transformed(by: jitter)
            gray.rVector = CIVector(x: 1, y: 0, z: 0, w: 0)
            gray.gVector = CIVector(x: 1, y: 0, z: 0, w: 0)
            gray.bVector = CIVector(x: 1, y: 0, z: 0, w: 0)
            gray.aVector = CIVector(x: 0, y: 0, z: 0, w: 0)
            gray.biasVector = CIVector(x: 0, y: 0, z: 0, w: look.grain * 0.35)
            if let g = gray.outputImage?.cropped(to: frame) {
                let blend = CIFilter.softLightBlendMode()
                blend.inputImage = g
                blend.backgroundImage = img
                img = (blend.outputImage ?? img).cropped(to: frame)
            }
        }

        if look.vignette > 0 {
            let f = CIFilter.vignette()
            f.inputImage = img
            f.intensity = Float(look.vignette * 1.6)
            f.radius = Float(hypot(size.width, size.height) / 2 * 0.9)
            img = (f.outputImage ?? img).cropped(to: frame)
        }

        if look.fourByThree, size.width / size.height > 4.0 / 3.0 {
            let w = size.height * 4 / 3
            let inner = CGRect(x: (size.width - w) / 2, y: 0, width: w, height: size.height)
            img = img.cropped(to: inner).composited(over: CIImage(color: .black).cropped(to: frame))
        }

        for c in captions where t >= c.start && t < c.end { img = c.image.composited(over: img) }
        if let stamp { img = stamp.composited(over: img) }
        return img.cropped(to: frame)
    }

    private func channel(_ img: CIImage, r: CGFloat, g: CGFloat, b: CGFloat) -> CIImage {
        let f = CIFilter.colorMatrix()
        f.inputImage = img
        f.rVector = CIVector(x: r, y: 0, z: 0, w: 0)
        f.gVector = CIVector(x: 0, y: g, z: 0, w: 0)
        f.bVector = CIVector(x: 0, y: 0, z: b, w: 0)
        f.aVector = CIVector(x: 0, y: 0, z: 0, w: 1)
        return f.outputImage ?? img
    }
}

/// Rasterises captions once (not per frame) with UIKit text rendering.
enum CaptionRenderer {
    /// 1 pixel per point: the size is already in video pixels, and the
    /// screen's 3x scale would make a 4K caption layer 9x bigger.
    static func onePointFormat() -> UIGraphicsImageRendererFormat {
        let f = UIGraphicsImageRendererFormat()
        f.scale = 1
        f.opaque = false
        return f
    }

    static func caption(_ text: String, style: String, size: CGSize, row: Int) -> CIImage? {
        let fontSize = size.height * (style == "minimal" ? 0.05 : 0.07)
        let label = style == "minimal" ? text : text.uppercased()
        let font: UIFont
        switch style {
        case "tape": font = .monospacedSystemFont(ofSize: fontSize, weight: .bold)
        case "minimal": font = .systemFont(ofSize: fontSize, weight: .semibold)
        default:
            let base = UIFont(name: "Impact", size: fontSize) ?? .systemFont(ofSize: fontSize, weight: .black)
            font = base.fontDescriptor.withSymbolicTraits(.traitItalic).map { UIFont(descriptor: $0, size: fontSize) } ?? base
        }
        let color: UIColor = style == "stamp" ? UIColor(red: 1, green: 0.42, blue: 0, alpha: 1) : .white
        var attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        if style != "tape" {
            attrs[.strokeColor] = UIColor.black.withAlphaComponent(0.85)
            attrs[.strokeWidth] = -4.0
        }
        let str = NSAttributedString(string: label, attributes: attrs)
        let textSize = str.size()
        // Same placement as the web drawCaption(): centred, 82% down, rows stack upward.
        let centerY = size.height * 0.82 - CGFloat(row) * fontSize * 1.6
        let image = UIGraphicsImageRenderer(size: size, format: onePointFormat()).image { ctx in
            let rect = CGRect(x: (size.width - textSize.width) / 2, y: centerY - textSize.height / 2, width: textSize.width, height: textSize.height)
            if style == "tape" {
                UIColor.black.withAlphaComponent(0.9).setFill()
                ctx.fill(rect.insetBy(dx: -fontSize / 2, dy: -fontSize * 0.2))
            }
            str.draw(in: rect)
        }
        return image.cgImage.map { CIImage(cgImage: $0) }
    }

    static func tapeStamp(size: CGSize, date: Date) -> CIImage? {
        let fontSize = size.height * 0.045
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.monospacedSystemFont(ofSize: fontSize, weight: .bold),
            .foregroundColor: UIColor.white.withAlphaComponent(0.92)
        ]
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "MMM. dd yyyy"
        let dateStr = NSAttributedString(string: f.string(from: date).uppercased(), attributes: attrs)
        let play = NSAttributedString(string: "PLAY \u{25B6}", attributes: attrs)
        let image = UIGraphicsImageRenderer(size: size, format: onePointFormat()).image { _ in
            play.draw(at: CGPoint(x: size.width * 0.05, y: size.height * 0.06))
            let ds = dateStr.size()
            dateStr.draw(at: CGPoint(x: size.width * 0.95 - ds.width, y: size.height * 0.88))
        }
        return image.cgImage.map { CIImage(cgImage: $0) }
    }
}
