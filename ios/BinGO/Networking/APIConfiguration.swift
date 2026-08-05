import Foundation

struct APIConfiguration: Codable, Equatable, Sendable {
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
