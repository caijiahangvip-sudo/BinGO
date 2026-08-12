import Foundation

struct APIConfiguration: Codable, Equatable, Sendable {
    /// Built-in default BinGO AI API endpoint; used when the user has not
    /// stored a custom server address.
    static let defaultBaseURL = "https://api.bingo.mido.site"

    var baseURLString: String
    var token: String

    var baseURL: URL? {
        URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func normalized() -> APIConfiguration {
        var value = self
        value.baseURLString = value.baseURLString
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        value.token = value.token.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.baseURLString.isEmpty {
            value.baseURLString = Self.defaultBaseURL
        }
        return value
    }

    static func load() -> APIConfiguration {
        let baseURL = UserDefaults.standard.string(forKey: "bingo.api.baseURL") ?? ""
        let token = KeychainStore.read(service: "app.bingo.ipad", account: "api-token") ?? ""
        return APIConfiguration(baseURLString: baseURL, token: token).normalized()
    }

    func save() {
        let value = normalized()
        UserDefaults.standard.set(value.baseURLString, forKey: "bingo.api.baseURL")
        if value.token.isEmpty {
            KeychainStore.delete(service: "app.bingo.ipad", account: "api-token")
        } else {
            KeychainStore.write(value.token, service: "app.bingo.ipad", account: "api-token")
        }
    }
}
