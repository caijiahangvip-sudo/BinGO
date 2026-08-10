import CoreGraphics
import Foundation

struct HealthResponse: Decodable, Sendable {
    let success: Bool
    let status: String
    let version: String
    let desktop: Bool?
    let startedAt: String?
    let capabilities: ServerCapabilities?
}

struct ServerCapabilities: Decodable, Sendable {
    let webSearch: Bool?
    let tts: Bool?
    let vector: Bool?
}

struct ChatMessageDTO: Codable, Identifiable, Sendable {
    let id: String
    let role: String
    var content: String
    var createdAt: Date?
}

struct StatelessChatMessageDTO: Codable, Sendable {
    let id: String
    let role: String
    let parts: [ChatMessagePartDTO]
}

struct ChatMessagePartDTO: Codable, Sendable {
    let type: String
    let text: String
}

struct ChatRequestDTO: Codable, Sendable {
    let messages: [StatelessChatMessageDTO]
    let storeState: ChatStoreStateDTO
    let config: ChatConfigDTO
    let apiKey: String
    let requiresApiKey: Bool
}

struct ChatStoreStateDTO: Codable, Sendable {
    let stage: StageDTO?
    let scenes: [SceneDTO]
    let currentSceneId: String?
    let mode: String
    let whiteboardOpen: Bool
}

struct ChatConfigDTO: Codable, Sendable {
    let agentIds: [String]
    let sessionType: String
    let studentQuestion: String?
}

struct ClassroomDTO: Codable, Identifiable, Sendable {
    let id: String
    let stage: StageDTO
    let scenes: [SceneDTO]
}

struct StageDTO: Codable, Identifiable, Sendable {
    let id: String
    var name: String?
    var description: String?
    var createdAt: Double?
    var updatedAt: Double?
    var language: String?
    var agentIds: [String]?

    var displayName: String { name?.nonEmpty ?? "课堂" }
}

struct SceneDTO: Codable, Equatable, Identifiable, Sendable {
    let id: String
    var stageId: String?
    var type: String?
    var title: String?
    var order: Int?
    var content: JSONValue?
    var actions: [SceneActionDTO]?
    var whiteboards: JSONValue?
    var createdAt: Double?
    var updatedAt: Double?
}

struct SceneActionDTO: Codable, Equatable, Identifiable, Sendable {
    let id: String
    var type: String
    var title: String?
    var description: String?
    var text: String?
    var content: String?
    var audioId: String?
    var audioUrl: String?
    var duration: Double?
    var elementId: String?
    var x: Double?
    var y: Double?
    var width: Double?
    var height: Double?
    var color: String?

    var displayText: String? { text?.nonEmpty ?? content?.nonEmpty ?? description?.nonEmpty }
}

struct GenerationRequestDTO: Codable, Sendable {
    let requirement: String
    let language: String
    var enableWebSearch = false
    var enableTTS = false
    var agentMode: String? = nil
    var visualTheme: String? = nil
    var slideLayoutReviewEnabled = true
}

struct GenerationStartResponse: Decodable, Sendable {
    let success: Bool
    let jobId: String
    let status: String
    let step: String
    let message: String
    let pollUrl: String?
    let pollIntervalMs: Int?
}

struct GenerationJobResponse: Decodable, Sendable {
    let success: Bool
    let jobId: String
    let status: String
    let step: String
    let progress: Double
    let message: String
    let pollIntervalMs: Int?
    let scenesGenerated: Int
    let totalScenes: Int?
    let result: GenerationResultDTO?
    let error: String?
    let done: Bool
}

struct GenerationResultDTO: Decodable, Sendable {
    let classroomId: String
    let url: String?
    let scenesCount: Int
}

struct ClassroomReadResponse: Decodable, Sendable {
    let success: Bool
    let classroom: ClassroomDTO
}

struct ClassroomSaveRequest: Encodable, Sendable {
    let stage: StageDTO
    let scenes: [SceneDTO]
}

struct ClassroomSaveResponse: Decodable, Sendable {
    let success: Bool
    let id: String
    let url: String?
}

struct HomeworkJobResponse: Decodable, Sendable {
    let success: Bool
    let jobId: String
    let status: String
    let stage: String
    let progress: Double
    let message: String
    let pollIntervalMs: Int?
    let done: Bool
    let result: HomeworkSolveResultDTO?
    let error: String?
}

struct HomeworkCancelResponse: Decodable, Sendable {
    let success: Bool
    let jobId: String
    let status: String
    let stage: String
    let message: String
    let cancelledTasks: Int?
}

struct HomeworkSolveResultDTO: Decodable, Sendable {
    let title: String
    let fileName: String
    let fileType: String
    let language: String
    let questions: [HomeworkQuestionSolutionDTO]
    let model: String?

    var formattedAnswer: String {
        questions.enumerated().map { index, question in
            """
            \(index + 1). \(question.question)
            答案：\(question.answer)
            解题过程：\(question.solution)
            """
        }.joined(separator: "\n\n")
    }
}

struct HomeworkQuestionSolutionDTO: Decodable, Sendable, Identifiable {
    let id: String
    let question: String
    let answer: String
    let solution: String
    let knowledgePoints: [String]
    let difficulty: String?
    let confidence: String?
}

struct WebSearchRequest: Encodable, Sendable {
    let query: String
    var pdfText: String? = nil
    var apiKey: String? = nil
    var baseUrl: String? = nil
}

struct WebSearchResponse: Decodable, Sendable {
    let success: Bool
    let answer: String?
    let sources: [WebSearchSource]
    let context: String
    let query: String
    let responseTime: Double?
}

struct WebSearchSource: Decodable, Sendable, Identifiable {
    let url: String
    let title: String?
    let content: String?
    let score: Double?

    var id: String { url }
}

struct QuizGradeRequest: Encodable, Sendable {
    let question: String
    let userAnswer: String
    let points: Int
    let commentPrompt: String?
    let language: String
}

struct QuizGradeResponse: Decodable, Sendable {
    let success: Bool
    let score: Int
    let comment: String
}

struct CloudTextResponse: Decodable, Sendable {
    let success: Bool?
    let text: String?
    let markdown: String?
    let content: String?
    let result: CloudTextPayload?

    var resolvedText: String? {
        [text, markdown, content, result?.text, result?.markdown, result?.content]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty })
    }
}

struct CloudTextPayload: Decodable, Sendable {
    let text: String?
    let markdown: String?
    let content: String?
}

struct BookPlanRequest: Encodable, Sendable {
    let fileName: String
    let fileSize: Int
    let pdfStorageKey: String
    let pdfText: String
    let language: String
}

struct BookPlanResponse: Decodable, Sendable {
    let success: Bool
    let plan: BookLearningPlanDTO
    let warning: String?
}

struct BookLearningPlanDTO: Codable, Sendable, Identifiable {
    let id: String
    let title: String
    let fileName: String
    let summary: String
    let totalLessons: Int
    let currentLessonIndex: Int
    let lessons: [BookLessonDTO]
}

struct BookLessonDTO: Codable, Sendable, Identifiable {
    let id: String
    let order: Int
    let title: String
    let objective: String
    let knowledgePointIds: [String]
    let status: String
}

indirect enum JSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value") }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .bool(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    var prettyPrinted: String {
        guard let data = try? JSONEncoder().encode(self),
              let object = try? JSONSerialization.jsonObject(with: data),
              let formatted = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]),
              let text = String(data: formatted, encoding: .utf8)
        else { return "" }
        return text
    }
}

struct OCRResult: Sendable {
    let text: String
    let observations: [OCRObservation]
}

struct OCRObservation: Sendable {
    let text: String
    let confidence: Float
    let boundingBox: CGRect
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
