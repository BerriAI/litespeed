import AppKit

// A Retina background; Finder supplies the actual draggable app and folder icons.
let width = 720, height = 440, scale = 2
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width * scale, pixelsHigh: height * scale, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: width * scale * 4, bitsPerPixel: 32)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
let transform = NSAffineTransform(); transform.scale(by: CGFloat(scale)); transform.concat()
NSColor(calibratedWhite: 0.965, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: width, height: height).fill()
func label(_ text: String, y: CGFloat, size: CGFloat, weight: NSFont.Weight, color: CGFloat) {
    let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
    (text as NSString).draw(in: NSRect(x: 30, y: y, width: 660, height: 40), withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: NSColor(calibratedWhite: color, alpha: 1), .paragraphStyle: paragraph])
}
label("Litespeed", y: 341, size: 27, weight: .semibold, color: 0.13)
label("Drag Litespeed to Applications", y: 309, size: 15, weight: .regular, color: 0.43)
let arrow = NSBezierPath(); arrow.lineWidth = 2.5; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round
arrow.move(to: NSPoint(x: 332, y: 211)); arrow.line(to: NSPoint(x: 389, y: 211))
arrow.move(to: NSPoint(x: 379, y: 221)); arrow.line(to: NSPoint(x: 389, y: 211)); arrow.line(to: NSPoint(x: 379, y: 201))
NSColor(calibratedWhite: 0.62, alpha: 1).setStroke(); arrow.stroke()
label("Then open Litespeed from Applications.", y: 40, size: 13, weight: .regular, color: 0.50)
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
