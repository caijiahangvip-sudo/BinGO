import SwiftUI

// MARK: - 画布

/// 原生 SwiftUI 幻灯片画布：把服务端 1000×562.5 逻辑坐标系的元素等比缩放到可用空间。
struct SlideCanvasView: View {
    let canvas: SlideCanvas

    var body: some View {
        GeometryReader { proxy in
            let logical = canvas.logicalSize
            let scale = min(proxy.size.width / logical.width, proxy.size.height / logical.height)
            ZStack {
                Color(hex: canvas.theme?.backgroundColor ?? "") ?? Color(uiColor: .systemGroupedBackground)
                ForEach(Array((canvas.elements ?? []).enumerated()), id: \.offset) { _, element in
                    placed(element)
                }
            }
            .frame(width: logical.width, height: logical.height)
            .clipped()
            .scaleEffect(scale, anchor: .center)
            .frame(width: logical.width * scale, height: logical.height * scale)
            .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
        }
        .background(Color(uiColor: .systemGroupedBackground))
    }

    private func placed(_ element: SlideElement) -> some View {
        let size = elementSize(element)
        return SlideElementView(element: element, theme: canvas.theme)
            .frame(width: size.width, height: size.height)
            .rotationEffect(.degrees(element.rotate ?? 0))
            .position(
                x: (element.left ?? 0) + size.width / 2,
                y: (element.top ?? 0) + size.height / 2
            )
    }

    private func elementSize(_ element: SlideElement) -> CGSize {
        var width = element.width
        var height = element.height
        if element.type == "line" {
            // 线元素可能没有显式宽高，用端点/控制点的包围盒兜底
            var xs: [Double] = []
            var ys: [Double] = []
            for pair in [element.start, element.end, element.curve, element.broken] {
                if let pair, pair.count >= 2 {
                    xs.append(pair[0])
                    ys.append(pair[1])
                }
            }
            if width == nil { width = (xs.max() ?? 0) + 24 }
            if height == nil { height = (ys.max() ?? 0) + 24 }
        }
        return CGSize(width: max(width ?? 40, 1), height: max(height ?? 40, 1))
    }
}

// MARK: - 元素分发

private struct SlideElementView: View {
    let element: SlideElement
    let theme: SlideTheme?

    var body: some View {
        switch element.type {
        case "text":
            TextElementView(element: element, theme: theme)
        case "shape":
            ShapeElementView(element: element, theme: theme)
        case "line":
            LineElementView(element: element)
        case "image":
            ImageElementView(element: element)
        case "latex":
            LatexElementView(element: element, theme: theme)
        default:
            PlaceholderElementView(type: element.type ?? "unknown")
        }
    }
}

// MARK: - 文本元素（HTML 迷你解析）

private struct TextElementView: View {
    let element: SlideElement
    let theme: SlideTheme?

    var body: some View {
        let defaultColor = Color(hex: element.defaultColor ?? theme?.fontColor ?? "") ?? .primary
        let parsed = SlideHTMLParser.parse(
            element.content ?? "",
            defaultFontName: element.defaultFontName ?? theme?.fontName,
            defaultColor: defaultColor
        )
        Text(parsed.attributed)
            .multilineTextAlignment(parsed.alignment)
            .lineSpacing(parsed.lineSpacing)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(hex: element.fill ?? "") ?? .clear)
    }
}

struct SlideHTMLText {
    var attributed: AttributedString
    var alignment: TextAlignment
    var lineSpacing: CGFloat
}

/// 极简 HTML → AttributedString 解析器。
/// 支持 p / span / strong / b / em / i / br，style 属性支持
/// font-size / color / font-weight / text-align / line-height；
/// 其他标签剥掉只留文本。
enum SlideHTMLParser {
    static func parse(_ html: String, defaultFontName: String?, defaultColor: Color) -> SlideHTMLText {
        var result = AttributedString()
        var fontSize: CGFloat?
        var color: Color?
        var bold = false
        var italic = false
        var alignment: TextAlignment = .leading
        var lineHeightMultiple: CGFloat?
        var alignmentLocked = false

        func makeFont() -> Font {
            let size = fontSize ?? 30
            var font: Font
            if let name = defaultFontName, !name.isEmpty {
                font = .custom(name, size: size)
            } else {
                font = .system(size: size)
            }
            if bold { font = font.weight(.bold) }
            if italic { font = font.italic() }
            return font
        }

        func append(_ text: String) {
            guard !text.isEmpty else { return }
            var container = AttributeContainer()
            container.font = makeFont()
            container.foregroundColor = color ?? defaultColor
            result.append(AttributedString(decodeEntities(text), attributes: container))
        }

        func applyStyle(_ style: String) {
            for declaration in style.split(separator: ";") {
                let parts = declaration.split(separator: ":", maxSplits: 1)
                guard parts.count == 2 else { continue }
                let key = parts[0].trimmingCharacters(in: .whitespaces).lowercased()
                let value = parts[1].trimmingCharacters(in: .whitespaces)
                switch key {
                case "font-size":
                    if let px = Double(value.replacingOccurrences(of: "px", with: "")) {
                        fontSize = CGFloat(px)
                    }
                case "color":
                    if let parsed = Color(hex: value) { color = parsed }
                case "font-weight":
                    if value.lowercased() == "bold" {
                        bold = true
                    } else if let weight = Int(value) {
                        bold = weight >= 600
                    }
                case "text-align" where !alignmentLocked:
                    switch value.lowercased() {
                    case "center": alignment = .center
                    case "right": alignment = .trailing
                    default: alignment = .leading
                    }
                    alignmentLocked = true
                case "line-height":
                    if let multiple = Double(value.replacingOccurrences(of: "px", with: "")) {
                        lineHeightMultiple = CGFloat(multiple)
                    }
                default:
                    break
                }
            }
        }

        func styleAttribute(of tag: String) -> String? {
            for quote in ["\"", "'"] {
                guard let range = tag.range(of: "style=\(quote)") else { continue }
                let rest = tag[range.upperBound...]
                guard let end = rest.firstIndex(of: quote == "\"" ? "\"" : "'") else { continue }
                return String(rest[..<end])
            }
            return nil
        }

        var index = html.startIndex
        while index < html.endIndex {
            if html[index] == "<", let close = html[index...].firstIndex(of: ">") {
                var tag = String(html[html.index(after: index)..<close]).trimmingCharacters(in: .whitespaces)
                let isClosing = tag.hasPrefix("/")
                if isClosing { tag.removeFirst() }
                let name = tag.split(whereSeparator: { $0 == " " || $0 == "/" }).first.map(String.init)?.lowercased() ?? ""
                switch name {
                case "p":
                    if isClosing {
                        fontSize = nil
                        color = nil
                    } else {
                        if !result.characters.isEmpty { append("\n") }
                        if let style = styleAttribute(of: tag) { applyStyle(style) }
                    }
                case "span":
                    if isClosing {
                        fontSize = nil
                        color = nil
                    } else if let style = styleAttribute(of: tag) {
                        applyStyle(style)
                    }
                case "strong", "b":
                    bold = !isClosing
                case "em", "i":
                    italic = !isClosing
                case "br":
                    append("\n")
                default:
                    break
                }
                index = html.index(after: close)
            } else {
                let next = html[index...].firstIndex(of: "<") ?? html.endIndex
                append(String(html[index..<next]))
                index = next
            }
        }

        let baseSize = fontSize ?? 30
        let spacing = max((lineHeightMultiple ?? 0) - 1, 0) * baseSize
        return SlideHTMLText(attributed: result, alignment: alignment, lineSpacing: spacing)
    }

    static func decodeEntities(_ text: String) -> String {
        text.replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
    }
}

// MARK: - 形状元素（SVG path 迷你解析）

private struct ShapeElementView: View {
    let element: SlideElement
    let theme: SlideTheme?

    var body: some View {
        GeometryReader { proxy in
            let path = SVGPathParser.path(
                from: element.path ?? "",
                viewBox: element.viewBox,
                in: proxy.size
            )
            let fillColor = Color(hex: element.fill ?? "") ?? (element.fill == nil ? .clear : .gray)
            let outline = element.outline ?? theme?.outline
            ZStack {
                path.fill(fillColor)
                if let outline, let color = Color(hex: outline.color ?? ""), (outline.width ?? 0) > 0 {
                    path.stroke(
                        color,
                        style: StrokeStyle(
                            lineWidth: outline.width ?? 1,
                            dash: outline.style == "dashed" ? [6, 4] : []
                        )
                    )
                }
            }
        }
    }
}

/// SVG path → SwiftUI Path。M/L/H/V/C/S/Q/T/Z 完整支持，
/// A（椭圆弧）退化为直线到端点，保证不崩。
enum SVGPathParser {
    static func path(from string: String, viewBox: [Double]?, in size: CGSize) -> Path {
        let boxWidth = max(viewBox?.first ?? 100, 0.0001)
        let boxHeight = max((viewBox?.count ?? 0) > 1 ? viewBox?[1] ?? 100 : 100, 0.0001)
        let scaleX = size.width / boxWidth
        let scaleY = size.height / boxHeight

        var path = Path()
        var current = CGPoint.zero
        var startPoint = CGPoint.zero
        var lastControl: CGPoint?
        var lastCommand = ""

        let tokens = tokenize(string)
        var index = 0
        var command: Character?

        func number() -> Double? {
            guard index < tokens.count, let value = Double(tokens[index]) else { return nil }
            index += 1
            return value
        }

        func point(relative: Bool) -> CGPoint? {
            guard let x = number(), let y = number() else { return nil }
            // current 已是缩放后的坐标，相对偏移只缩放增量
            if relative {
                return CGPoint(x: current.x + x * scaleX, y: current.y + y * scaleY)
            }
            return CGPoint(x: x * scaleX, y: y * scaleY)
        }

        while index < tokens.count {
            let token = tokens[index]
            if let letter = token.first, token.count == 1, letter.isLetter {
                command = letter
                index += 1
                if letter == "Z" || letter == "z" {
                    path.closeSubpath()
                    current = startPoint
                    lastControl = nil
                    lastCommand = "Z"
                    continue
                }
            }
            guard let cmd = command else { index += 1; continue }
            let relative = cmd.isLowercase
            switch cmd.uppercased().first {
            case "M":
                guard let target = point(relative: relative) else { index += 1; continue }
                path.move(to: target)
                current = target
                startPoint = target
                lastControl = nil
                // 隐式后续坐标按 L 处理
                command = relative ? "l" : "L"
            case "L":
                guard let target = point(relative: relative) else { index += 1; continue }
                path.addLine(to: target)
                current = target
                lastControl = nil
            case "H":
                guard let x = number() else { index += 1; continue }
                let target = CGPoint(x: relative ? current.x + x * scaleX : x * scaleX, y: current.y)
                path.addLine(to: target)
                current = target
                lastControl = nil
            case "V":
                guard let y = number() else { index += 1; continue }
                let target = CGPoint(x: current.x, y: relative ? current.y + y * scaleY : y * scaleY)
                path.addLine(to: target)
                current = target
                lastControl = nil
            case "C":
                guard let c1 = point(relative: relative),
                      let c2 = point(relative: relative),
                      let target = point(relative: relative) else { index += 1; continue }
                path.addCurve(to: target, control1: c1, control2: c2)
                current = target
                lastControl = c2
            case "S":
                guard let c2 = point(relative: relative),
                      let target = point(relative: relative) else { index += 1; continue }
                let c1: CGPoint
                if lastCommand == "C" || lastCommand == "S", let lastControl {
                    c1 = CGPoint(x: 2 * current.x - lastControl.x, y: 2 * current.y - lastControl.y)
                } else {
                    c1 = current
                }
                path.addCurve(to: target, control1: c1, control2: c2)
                current = target
                lastControl = c2
            case "Q":
                guard let control = point(relative: relative),
                      let target = point(relative: relative) else { index += 1; continue }
                path.addQuadCurve(to: target, control: control)
                current = target
                lastControl = control
            case "T":
                guard let target = point(relative: relative) else { index += 1; continue }
                let control: CGPoint
                if lastCommand == "Q" || lastCommand == "T", let lastControl {
                    control = CGPoint(x: 2 * current.x - lastControl.x, y: 2 * current.y - lastControl.y)
                } else {
                    control = current
                }
                path.addQuadCurve(to: target, control: control)
                current = target
                lastControl = control
            case "A":
                // 椭圆弧：rx ry rot large-arc sweep x y → 退化为直线
                _ = number(); _ = number(); _ = number(); _ = number(); _ = number()
                guard let target = point(relative: relative) else { index += 1; continue }
                path.addLine(to: target)
                current = target
                lastControl = nil
            default:
                index += 1
                continue
            }
            lastCommand = String(cmd.uppercased().first ?? " ")
        }
        return path
    }

    private static func tokenize(_ string: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        func flush() {
            if !current.isEmpty {
                tokens.append(current)
                current = ""
            }
        }
        for char in string {
            if char.isLetter {
                flush()
                tokens.append(String(char))
            } else if char == "-" || char == "+" {
                // 符号可能是新数字的开始（SVG 允许 "10-20" 连写）
                if current.isEmpty || current.last == "e" || current.last == "E" {
                    current.append(char)
                } else {
                    flush()
                    current = String(char)
                }
            } else if char.isNumber || char == "." {
                current.append(char)
            } else {
                flush()
            }
        }
        flush()
        return tokens
    }
}

// MARK: - 线条元素

private struct LineElementView: View {
    let element: SlideElement

    private var lineColor: Color {
        Color(hex: element.color ?? "") ?? .primary
    }

    private var strokeStyle: StrokeStyle {
        StrokeStyle(lineWidth: 3, lineCap: .round, dash: element.style == "dashed" ? [10, 8] : [])
    }

    var body: some View {
        Canvas { context, _ in
            let start = elementPoint(element.start) ?? .zero
            let end = elementPoint(element.end) ?? CGPoint(x: 100, y: 0)
            let control = elementPoint(element.curve)
            let corner = elementPoint(element.broken)

            var path = Path()
            path.move(to: start)
            if let control {
                path.addQuadCurve(to: end, control: control)
            } else if let corner {
                path.addLine(to: corner)
                path.addLine(to: end)
            } else {
                path.addLine(to: end)
            }
            context.stroke(path, with: .color(lineColor), style: strokeStyle)

            // 端点装饰：points[0]=起点，points[1]=终点，""/"arrow"/"dot"
            let caps = element.points ?? []
            if caps.count > 0 { drawCap(caps[0], at: start, directionFrom: control ?? corner ?? end, in: &context) }
            if caps.count > 1 { drawCap(caps[1], at: end, directionFrom: control ?? corner ?? start, in: &context) }
        }
    }

    private func elementPoint(_ pair: [Double]?) -> CGPoint? {
        guard let pair, pair.count >= 2 else { return nil }
        return CGPoint(x: pair[0], y: pair[1])
    }

    private func drawCap(_ kind: String, at tip: CGPoint, directionFrom other: CGPoint, in context: inout GraphicsContext) {
        switch kind {
        case "arrow":
            let direction = CGVector(dx: tip.x - other.x, dy: tip.y - other.y)
            let length = max(hypot(direction.dx, direction.dy), 0.0001)
            let unit = CGVector(dx: direction.dx / length, dy: direction.dy / length)
            let arrowLength: CGFloat = 16
            let arrowWidth: CGFloat = 11
            let base = CGPoint(x: tip.x - unit.dx * arrowLength, y: tip.y - unit.dy * arrowLength)
            let normal = CGVector(dx: -unit.dy, dy: unit.dx)
            var triangle = Path()
            triangle.move(to: tip)
            triangle.addLine(to: CGPoint(x: base.x + normal.dx * arrowWidth / 2, y: base.y + normal.dy * arrowWidth / 2))
            triangle.addLine(to: CGPoint(x: base.x - normal.dx * arrowWidth / 2, y: base.y - normal.dy * arrowWidth / 2))
            triangle.closeSubpath()
            context.fill(triangle, with: .color(lineColor))
        case "dot":
            let rect = CGRect(x: tip.x - 5, y: tip.y - 5, width: 10, height: 10)
            context.fill(Path(ellipseIn: rect), with: .color(lineColor))
        default:
            break
        }
    }
}

// MARK: - 图片元素

private struct ImageElementView: View {
    let element: SlideElement

    var body: some View {
        AsyncImage(url: imageURL(element.src)) { phase in
            switch phase {
            case let .success(image):
                image
                    .resizable()
                    .aspectRatio(contentMode: element.fixedRatio == true ? .fit : .fill)
            case .failure:
                PlaceholderElementView(type: "image")
            default:
                ProgressView()
            }
        }
        .scaleEffect(x: element.flipH == true ? -1 : 1, y: element.flipV == true ? -1 : 1)
    }

    private func imageURL(_ src: String?) -> URL? {
        guard let src, !src.isEmpty else { return nil }
        if src.hasPrefix("http://") || src.hasPrefix("https://") {
            return URL(string: src)
        }
        let path = src.hasPrefix("/") ? src : "/" + src
        return URL(string: "https://api.bingo.mido.site" + path)
    }
}

// MARK: - LaTeX 元素（源码 fallback）

private struct LatexElementView: View {
    let element: SlideElement
    let theme: SlideTheme?

    var body: some View {
        Text(element.latex ?? "")
            .font(.system(size: 18, design: .monospaced))
            .foregroundStyle(Color(hex: element.defaultColor ?? theme?.fontColor ?? "") ?? .primary)
            .padding(10)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(uiColor: .secondarySystemGroupedBackground))
            )
    }
}

// MARK: - 未知元素占位

private struct PlaceholderElementView: View {
    let type: String

    var body: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color(uiColor: .systemGray5))
            .overlay {
                Text(type)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
    }
}

// MARK: - 颜色解析

extension Color {
    /// 支持 #rgb / #rrggbb / #rrggbbaa 与少量颜色名；无法解析返回 nil。
    init?(hex: String) {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        switch value.lowercased() {
        case "white": self = .white; return
        case "black": self = .black; return
        case "red": self = .red; return
        case "green": self = .green; return
        case "blue": self = .blue; return
        case "yellow": self = .yellow; return
        case "orange": self = .orange; return
        case "purple": self = .purple; return
        case "pink": self = .pink; return
        case "gray", "grey": self = .gray; return
        case "transparent": self = .clear; return
        default: break
        }
        if value.hasPrefix("#") { value.removeFirst() }
        guard let raw = UInt64(value, radix: 16) else { return nil }
        switch value.count {
        case 3:
            self = Color(
                red: Double((raw >> 8) & 0xF) / 15,
                green: Double((raw >> 4) & 0xF) / 15,
                blue: Double(raw & 0xF) / 15
            )
        case 6:
            self = Color(
                red: Double((raw >> 16) & 0xFF) / 255,
                green: Double((raw >> 8) & 0xFF) / 255,
                blue: Double(raw & 0xFF) / 255
            )
        case 8:
            self = Color(
                red: Double((raw >> 24) & 0xFF) / 255,
                green: Double((raw >> 16) & 0xFF) / 255,
                blue: Double((raw >> 8) & 0xFF) / 255,
                opacity: Double(raw & 0xFF) / 255
            )
        default:
            return nil
        }
    }
}
