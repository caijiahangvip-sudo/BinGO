import Foundation

/// `SceneDTO.content` round-trip 解码后的载荷。
/// 服务端会按 `type` 产出 slide / quiz / interactive / pbl 等不同结构，
/// 全部字段可选，未知字段直接忽略，解码失败返回 nil。
struct SceneContentPayload: Decodable, Sendable {
    var type: String?
    var canvas: SlideCanvas?
    var questions: [QuizQuestionPayload]?
    var html: String?
    var projectConfig: JSONValue?
}

struct SlideCanvas: Decodable, Sendable {
    var id: String?
    var viewportSize: Double?
    var viewportRatio: Double?
    var theme: SlideTheme?
    var elements: [SlideElement]?

    /// 逻辑画布尺寸，默认 1000 × 562.5（16:9）。
    var logicalSize: CGSize {
        let width = viewportSize ?? 1000
        return CGSize(width: width, height: width * (viewportRatio ?? 0.5625))
    }
}

struct SlideTheme: Decodable, Sendable {
    var backgroundColor: String?
    var themeColors: [String]?
    var fontColor: String?
    var fontName: String?
    var outline: SlideOutline?
    var shadow: SlideShadow?
}

struct SlideOutline: Decodable, Sendable {
    var color: String?
    var width: Double?
    var style: String?
}

struct SlideShadow: Decodable, Sendable {
    var h: Double?
    var v: Double?
    var blur: Double?
    var color: String?
}

struct SlideElement: Decodable, Sendable {
    var id: String?
    var type: String?
    var left: Double?
    var top: Double?
    var width: Double?
    var height: Double?
    var rotate: Double?

    // text
    var content: String?
    var defaultFontName: String?
    var defaultColor: String?
    var fill: String?
    var lineHeight: Double?
    var textType: String?

    // shape
    var viewBox: [Double]?
    var path: String?
    var outline: SlideOutline?
    var fixedRatio: Bool?

    // line
    var start: [Double]?
    var end: [Double]?
    var style: String?
    var color: String?
    var points: [String]?
    var curve: [Double]?
    var broken: [Double]?

    // image
    var src: String?
    var flipH: Bool?
    var flipV: Bool?

    // latex
    var latex: String?
}

struct QuizQuestionPayload: Decodable, Identifiable, Sendable {
    var id: String?
    var question: String?
    var stem: String?
    var title: String?
    var options: [JSONValue]?
    var answer: JSONValue?
    var explanation: String?
    var analysis: String?

    var displayID: String { id ?? stemText }
    var stemText: String {
        question?.nonEmpty ?? stem?.nonEmpty ?? title?.nonEmpty ?? "题目"
    }
    var explanationText: String? {
        explanation?.nonEmpty ?? analysis?.nonEmpty
    }
    var optionTexts: [String] {
        (options ?? []).map { $0.displayString }
    }
}

extension JSONValue {
    /// 把任意 JSONValue 转成可读的字符串（用于容错显示答案、选项等）。
    var displayString: String {
        switch self {
        case let .string(value): return value
        case let .number(value):
            return value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(value)
        case let .bool(value): return value ? "true" : "false"
        case .null: return ""
        case .object, .array: return prettyPrinted
        }
    }
}

extension SceneDTO {
    /// 把 `content: JSONValue` 重新编码后再解码成结构化载荷；失败返回 nil，不抛错。
    func decodedContentPayload() -> SceneContentPayload? {
        guard let content,
              let data = try? JSONEncoder().encode(content)
        else { return nil }
        return try? JSONDecoder().decode(SceneContentPayload.self, from: data)
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
