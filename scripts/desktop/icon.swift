import AppKit

let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: pixels * 4, bitsPerPixel: 32)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let base = AffineTransform(scale: CGFloat(pixels) / 1024)
        (base as NSAffineTransform).concat()
        let background = NSBezierPath(roundedRect: NSRect(x: 52, y: 52, width: 920, height: 920), xRadius: 206, yRadius: 206)
        NSColor(calibratedWhite: 0.15, alpha: 1).setFill(); background.fill()
        NSColor(calibratedWhite: 0.24, alpha: 1).setStroke(); background.lineWidth = 2; background.stroke()
        let mark = NSAffineTransform(); mark.translateX(by: 185, yBy: 760); mark.scaleX(by: 18, yBy: -18); mark.concat()
        NSColor(calibratedWhite: 0.93, alpha: 1).setStroke()
        let path = NSBezierPath(); path.lineWidth = 2.6; path.lineCapStyle = .round; path.lineJoinStyle = .round
        path.move(to: NSPoint(x: 5, y: 7)); path.line(to: NSPoint(x: 20, y: 7)); path.curve(to: NSPoint(x: 35, y: 19), controlPoint1: NSPoint(x: 26, y: 7), controlPoint2: NSPoint(x: 31, y: 12)); path.curve(to: NSPoint(x: 32, y: 24), controlPoint1: NSPoint(x: 36.4, y: 21.5), controlPoint2: NSPoint(x: 34.8, y: 24)); path.line(to: NSPoint(x: 5, y: 24)); path.stroke()
        let glass = NSBezierPath(); glass.move(to: NSPoint(x: 19, y: 11)); glass.line(to: NSPoint(x: 21, y: 11)); glass.curve(to: NSPoint(x: 29, y: 17), controlPoint1: NSPoint(x: 24, y: 11), controlPoint2: NSPoint(x: 27, y: 14)); glass.line(to: NSPoint(x: 18, y: 17)); glass.close(); NSColor(calibratedWhite: 0.93, alpha: 1).setFill(); glass.fill()
        let speed = NSBezierPath(); speed.lineWidth = 2.2; speed.lineCapStyle = .round
        for (start, end) in [(NSPoint(x: 2, y: 12), NSPoint(x: 11, y: 12)), (NSPoint(x: 1, y: 18), NSPoint(x: 12, y: 18)), (NSPoint(x: 9, y: 29), NSPoint(x: 32, y: 29))] { speed.move(to: start); speed.line(to: end) }; speed.stroke()
        NSGraphicsContext.restoreGraphicsState()
        try bitmap.representation(using: .png, properties: [:])!.write(to: folder.appendingPathComponent("icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"))
    }
}
