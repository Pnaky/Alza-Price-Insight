// Ikona aplikace (AppIcon.iconset) ve všech velikostech – vektorově podle ikony rozšíření (img/icon-128.png):
// okno prohlížeče s grafem cen. Ikona aplikace je vidět u každé notifikace, 128 px by bylo rozmazané.
//
//   MakeIcon <výstup.iconset>

import AppKit

let navy = NSColor(srgbRed: 0x26 / 255, green: 0x3F / 255, blue: 0x6A / 255, alpha: 1).cgColor
let lime = NSColor(srgbRed: 0xC9 / 255, green: 0xDD / 255, blue: 0x03 / 255, alpha: 1).cgColor
let orange = NSColor(srgbRed: 0xEE / 255, green: 0x77 / 255, blue: 0x1A / 255, alpha: 1).cgColor
let gray = NSColor(srgbRed: 0x9E / 255, green: 0x9E / 255, blue: 0x9E / 255, alpha: 1).cgColor

/// Kreslí v plátně 1024 × 1024 s počátkem vlevo nahoře. scale = pixely na bod (stín se zadává v pixelech zařízení)
func draw(_ ctx: CGContext, scale: CGFloat) {
    // Podklad ve tvaru ikony macOS (mřížka 824 px se zaoblením) s jemným stínem
    let plate = CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824), cornerWidth: 185, cornerHeight: 185, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10 * scale), blur: 24 * scale, color: NSColor.black.withAlphaComponent(0.28).cgColor)
    ctx.addPath(plate)
    ctx.setFillColor(NSColor.white.cgColor)
    ctx.fillPath()
    ctx.restoreGState()

    ctx.saveGState()
    ctx.addPath(plate)
    ctx.clip()
    let gradient = CGGradient(
        colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
        colors: [NSColor.white.cgColor, NSColor(srgbRed: 0.91, green: 0.93, blue: 0.96, alpha: 1).cgColor] as CFArray,
        locations: [0, 1]
    )!
    ctx.drawLinearGradient(gradient, start: CGPoint(x: 512, y: 100), end: CGPoint(x: 512, y: 924), options: [])
    ctx.restoreGState()

    // Okno prohlížeče
    let window = CGRect(x: 196, y: 250, width: 632, height: 520)
    ctx.addPath(CGPath(roundedRect: window, cornerWidth: 44, cornerHeight: 44, transform: nil))
    ctx.setFillColor(NSColor.white.cgColor)
    ctx.fillPath()
    ctx.addPath(CGPath(roundedRect: window, cornerWidth: 44, cornerHeight: 44, transform: nil))
    ctx.setStrokeColor(navy)
    ctx.setLineWidth(26)
    ctx.strokePath()
    ctx.move(to: CGPoint(x: window.minX, y: 332))
    ctx.addLine(to: CGPoint(x: window.maxX, y: 332))
    ctx.setLineWidth(18)
    ctx.strokePath()
    ctx.setFillColor(navy)
    for x in [252.0, 300.0, 348.0] {
        ctx.fillEllipse(in: CGRect(x: x - 15, y: 291 - 15, width: 30, height: 30))
    }

    // Sloupce grafu
    let bottom: CGFloat = 715
    let bars: [(CGFloat, CGColor)] = [(110, gray), (190, lime), (140, orange), (240, lime), (290, lime)]
    var points: [CGPoint] = []
    for (index, (height, color)) in bars.enumerated() {
        let x = 256 + CGFloat(index) * 110
        ctx.addPath(CGPath(roundedRect: CGRect(x: x, y: bottom - height, width: 72, height: height), cornerWidth: 8, cornerHeight: 8, transform: nil))
        ctx.setFillColor(color)
        ctx.fillPath()
        points.append(CGPoint(x: x + 36, y: bottom - height - 55))
    }

    // Křivka ceny
    ctx.setStrokeColor(navy)
    ctx.setLineWidth(22)
    ctx.setLineJoin(.round)
    ctx.setLineCap(.round)
    ctx.addLines(between: points)
    ctx.strokePath()
    ctx.setFillColor(navy)
    for point in points {
        ctx.fillEllipse(in: CGRect(x: point.x - 24, y: point.y - 24, width: 48, height: 48))
    }
}

func render(pixels: Int) -> Data {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = context
    let ctx = context.cgContext
    let scale = CGFloat(pixels) / 1024
    ctx.translateBy(x: 0, y: CGFloat(pixels))
    ctx.scaleBy(x: scale, y: -scale)
    draw(ctx, scale: scale)
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write("usage: MakeIcon <out.iconset>\n".data(using: .utf8)!)
    exit(2)
}
let output = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    try render(pixels: size).write(to: output.appendingPathComponent("icon_\(size)x\(size).png"))
    try render(pixels: size * 2).write(to: output.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
