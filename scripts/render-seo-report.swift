import Foundation
import CoreGraphics
import CoreText

let args = CommandLine.arguments
if args.count != 3 { fatalError("Usage: render-seo-report.swift input.md output.pdf") }
let input = try String(contentsOfFile: args[1], encoding: .utf8)
let output = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
var media = CGRect(x: 0, y: 0, width: 595.28, height: 841.89)
guard let context = CGContext(output as CFURL, mediaBox: &media, nil) else { fatalError("Cannot create PDF") }
let green = CGColor(red: 0.16, green: 0.29, blue: 0.22, alpha: 1)
let ink = CGColor(gray: 0.16, alpha: 1)
let muted = CGColor(gray: 0.42, alpha: 1)
let gold = CGColor(red: 0.65, green: 0.50, blue: 0.29, alpha: 1)
let margin: CGFloat = 48
let width: CGFloat = media.width - 2 * margin
var top: CGFloat = 0
var page = 0
func clean(_ text: String) -> String {
    var result = text.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "`", with: "")
    result = result.replacingOccurrences(of: "\\[([^\\]]+)\\]\\([^)]*\\)", with: "$1", options: .regularExpression)
    return result.replacingOccurrences(of: "–", with: "-").replacingOccurrences(of: "—", with: "-")
}
func attributes(_ size: CGFloat = 10, _ bold: Bool = false, _ color: CGColor = ink) -> [NSAttributedString.Key: Any] {
    let font = CTFontCreateWithName((bold ? "Helvetica-Bold" : "Helvetica") as CFString, size, nil)
    return [NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color]
}
func label(_ value: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat = 9, _ bold: Bool = false, _ color: CGColor = ink) {
    context.textMatrix = .identity
    context.textPosition = CGPoint(x: x, y: media.height - y - size)
    CTLineDraw(CTLineCreateWithAttributedString(NSAttributedString(string: value, attributes: attributes(size, bold, color))), context)
}
func finishPage() {
    guard page > 0 else { return }
    context.setStrokeColor(CGColor(gray: 0.85, alpha: 1)); context.setLineWidth(0.5)
    context.move(to: CGPoint(x: margin, y: 42)); context.addLine(to: CGPoint(x: media.width - margin, y: 42)); context.strokePath()
    label("GARY HOME  /  Engineering & SEO review", margin, media.height - 30, 8, false, muted)
    label(String(format: "%02d", page), media.width - margin - 12, media.height - 30, 8, true, green)
    context.endPDFPage()
}
func newPage() {
    finishPage(); page += 1; context.beginPDFPage(nil)
    context.setFillColor(green); context.fill(CGRect(x: 0, y: media.height - 8, width: media.width, height: 8))
    label("GARY HOME", margin, 27, 10, true, green)
    label("SEO ENGINE REMEDIATION  /  10 NOV 2026", 273, 29, 8, false, muted)
    top = 64
}
func paragraph(_ value: String, size: CGFloat = 10, bold: Bool = false, color: CGColor = ink, indent: CGFloat = 0, gap: CGFloat = 8) {
    let text = NSAttributedString(string: clean(value), attributes: attributes(size, bold, color))
    let framesetter = CTFramesetterCreateWithAttributedString(text)
    let availableWidth = width - indent
    let suggested = CTFramesetterSuggestFrameSizeWithConstraints(framesetter, CFRange(location: 0, length: 0), nil, CGSize(width: availableWidth, height: 10000), nil)
    let height = ceil(suggested.height) + 5
    if top + height > media.height - 65 { newPage() }
    let rect = CGRect(x: margin + indent, y: media.height - top - height, width: availableWidth, height: height)
    let path = CGPath(rect: rect, transform: nil)
    context.textMatrix = .identity
    CTFrameDraw(CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil), context)
    top += height + gap
}
newPage()
paragraph("SEO engine remediation", size: 28, bold: true, color: green, gap: 2)
paragraph("Evidence, reliability and multilingual correctness", size: 13, color: muted, gap: 12)
context.setFillColor(gold); context.fill(CGRect(x: margin, y: media.height - top, width: 52, height: 3)); top += 17
paragraph("STATUS: IMPLEMENTED & LOCALLY VERIFIED / LIVE ACCEPTANCE BLOCKED", size: 9, bold: true, color: green, gap: 12)
let lines = input.components(separatedBy: .newlines)
var pending: [String] = []
var tableRows: [[String]] = []
func drawTable() {
    guard !tableRows.isEmpty else { return }
    let rows = tableRows; tableRows = []
    let fractions: [CGFloat] = rows[0].count == 4 ? [0.18, 0.18, 0.36, 0.28] : Array(repeating: 1 / CGFloat(rows[0].count), count: rows[0].count)
    let sizes = fractions.map { width * $0 }
    var heights: [CGFloat] = []
    for (ri, row) in rows.enumerated() {
        var height: CGFloat = 28
        for (ci, cell) in row.enumerated() {
            let a = NSAttributedString(string: clean(cell), attributes: attributes(8.5, ri == 0))
            let frame = CTFramesetterCreateWithAttributedString(a)
            let size = CTFramesetterSuggestFrameSizeWithConstraints(frame, CFRange(location: 0, length: 0), nil, CGSize(width: sizes[ci] - 12, height: 10000), nil)
            height = max(height, ceil(size.height) + 14)
        }
        heights.append(height)
    }
    if top + heights.reduce(0, +) > media.height - 65 { newPage() }
    for (ri, row) in rows.enumerated() {
        let height = heights[ri]
        context.setFillColor(ri == 0 ? green : CGColor(gray: ri % 2 == 0 ? 0.95 : 0.985, alpha: 1))
        context.fill(CGRect(x: margin, y: media.height - top - height, width: width, height: height))
        var x = margin
        for (ci, cell) in row.enumerated() {
            let a = NSAttributedString(string: clean(cell), attributes: attributes(8.5, ri == 0, ri == 0 ? CGColor(gray: 1, alpha: 1) : ink))
            let frame = CTFramesetterCreateWithAttributedString(a)
            let rect = CGRect(x: x + 6, y: media.height - top - height + 4, width: sizes[ci] - 12, height: height - 10)
            CTFrameDraw(CTFramesetterCreateFrame(frame, CFRange(location: 0, length: 0), CGPath(rect: rect, transform: nil), nil), context)
            x += sizes[ci]
        }
        top += height
    }
    top += 12
}
func flush() { if !pending.isEmpty { paragraph(pending.joined(separator: " ")); pending = [] } }
for line in lines {
    if !line.hasPrefix("|") { drawTable() }
    if line.hasPrefix("# ") { continue }
    if line.hasPrefix("## ") {
        flush(); if line.hasPrefix("## 6.") { newPage() }; if top + 78 > media.height - 65 { newPage() }
        top += 9
        paragraph(String(line.dropFirst(3)), size: 13, bold: true, color: green, gap: 9)
    } else if line.hasPrefix("### ") {
        flush(); paragraph(String(line.dropFirst(4)), size: 10.5, bold: true, color: green, gap: 6)
    } else if line.hasPrefix("- ") {
        flush(); paragraph("• " + String(line.dropFirst(2)), indent: 8, gap: 5)
    } else if line.hasPrefix("|") {
        flush()
        if !line.contains("---") {
            let cells = line.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }
            tableRows.append(cells)
        }
    } else if line.isEmpty { flush() }
    else if line.hasPrefix("```") { flush() }
    else { pending.append(line) }
}
flush(); drawTable(); finishPage(); context.closePDF()
print("Created \(page)-page PDF at \(output.path)")
