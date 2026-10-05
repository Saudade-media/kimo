// Board 32 "Dock activity": renders app bundles' icons the way macOS draws them in the Dock
// (IconServices applies the system icon treatment: rim, depth, mark shading), so the Dock tile
// frames match the idle icon. Used by `bun scripts/dock-frames.ts --treat` (macOS only).
//
//   swift dock-icon-treatment.swift <px> <app> <out.png> [<app> <out.png> ...]
import AppKit

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 3, args.count % 2 == 1, let px = Int(args[0]) else {
    FileHandle.standardError.write("usage: dock-icon-treatment <px> <app> <out.png> ...\n".data(using: .utf8)!)
    exit(2)
}
for i in stride(from: 1, to: args.count, by: 2) {
    let icon = NSWorkspace.shared.icon(forFile: args[i])
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)
    else { exit(1) }
    rep.size = NSSize(width: px, height: px)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    icon.draw(in: NSRect(x: 0, y: 0, width: px, height: px))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
    try png.write(to: URL(fileURLWithPath: args[i + 1]))
}
