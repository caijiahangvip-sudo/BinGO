import Foundation

enum APIError: LocalizedError, Equatable {
    case missingBaseURL
    case invalidResponse
    case unauthorized
    case server(status: Int, message: String)
    case decoding(String)
    case offline

    var errorDescription: String? {
        switch self {
        case .missingBaseURL: "请先在设置中配置 BinGO API 地址。"
        case .invalidResponse: "服务器返回了无效响应。"
        case .unauthorized: "API Token 无效或已过期。"
        case let .server(status, message): "服务器错误（\(status)）：\(message)"
        case let .decoding(message): "无法解析服务器数据：\(message)"
        case .offline: "当前网络不可用，本地功能仍可使用。"
        }
    }
}

struct APIErrorPayload: Decodable {
    let error: String?
    let details: String?
    let message: String?
}
