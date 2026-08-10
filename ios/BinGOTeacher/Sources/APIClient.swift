import Foundation

struct TeacherAPIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

actor TeacherAPIClient {
    private let baseURL: URL
    private let decoder: JSONDecoder
    private let encoder = JSONEncoder()

    init(baseURL: URL = URL(string: "https://bingo.mido.site")!) {
        self.baseURL = baseURL
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        self.decoder = decoder
    }

    func login(username: String, password: String) async throws -> TeacherAuthSession {
        try await request(path: "/v1/auth/login", method: "POST", body: [
            "identifier": username, "password": password,
            "deviceName": Host.current().localizedName ?? "Apple 设备", "platform": platformName,
        ])
    }

    func register(inviteCode: String, username: String, password: String) async throws -> TeacherAuthSession {
        try await request(path: "/v1/auth/register-teacher", method: "POST", body: [
            "inviteCode": inviteCode, "username": username, "password": password,
            "deviceName": Host.current().localizedName ?? "Apple 设备", "platform": platformName,
        ])
    }

    func bootstrap(token: String) async throws -> TeacherBootstrap { try await request(path: "/v1/teaching/bootstrap", token: token) }
    func tasks(token: String) async throws -> [LearningTaskDTO] { let value: TaskListResponse = try await request(path: "/v1/tasks", token: token); return value.tasks }
    func students(classId: String, token: String) async throws -> [TeacherStudent] { let value: StudentListResponse = try await request(path: "/v1/teacher/classes/\(classId)/students", token: token); return value.students }
    func notifications(token: String) async throws -> [TeacherNotification] { let value: NotificationListResponse = try await request(path: "/v1/notifications", token: token); return value.notifications }
    func messages(accountId: String, token: String) async throws -> [ChatMessage] { let value: MessageListResponse = try await request(path: "/v1/messages/direct/\(accountId)", token: token); return value.messages }

    func createTask(payload: [String: JSONValue], token: String) async throws {
        let _: EmptyResponse = try await request(path: "/v1/teacher/tasks", method: "POST", token: token, body: payload)
    }
    func publishTask(id: String, token: String) async throws { let _: EmptyResponse = try await request(path: "/v1/teacher/tasks/\(id)/publish", method: "POST", token: token, body: [:]) }
    func createGroup(name: String, description: String, token: String) async throws -> GroupCreateResponse { try await request(path: "/v1/groups", method: "POST", token: token, body: ["name": name, "description": description]) }
    func joinGroup(code: String, token: String) async throws { let _: EmptyResponse = try await request(path: "/v1/groups/join", method: "POST", token: token, body: ["inviteCode": code]) }
    func sendMessage(accountId: String, text: String, token: String) async throws { let _: EmptyResponse = try await request(path: "/v1/messages/direct", method: "POST", token: token, body: ["recipientId": accountId, "text": text, "attachments": [String]()]) }
    func markRead(id: String, token: String) async throws { let _: EmptyResponse = try await request(path: "/v1/notifications/\(id)/read", method: "POST", token: token, body: [:]) }

    private var platformName: String {
        #if os(macOS)
        "teacher-macos"
        #else
        "teacher-ipados"
        #endif
    }

    private func request<Response: Decodable, Body: Encodable>(path: String, method: String = "GET", token: String? = nil, body: Body? = nil) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try encoder.encode(body) }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw TeacherAPIError(message: "服务器响应无效") }
        guard (200..<300).contains(http.statusCode) else {
            let error = try? decoder.decode(ErrorResponse.self, from: data)
            throw TeacherAPIError(message: error?.error ?? "请求失败：\(http.statusCode)")
        }
        if data.isEmpty, let empty = EmptyResponse() as? Response { return empty }
        return try decoder.decode(Response.self, from: data)
    }
}

struct ErrorResponse: Codable { let error: String }
struct EmptyResponse: Codable { init() {} }

enum JSONValue: Codable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self { case .string(let value): try container.encode(value); case .number(let value): try container.encode(value); case .bool(let value): try container.encode(value); case .object(let value): try container.encode(value); case .array(let value): try container.encode(value); case .null: try container.encodeNil() }
    }
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else { self = .array(try container.decode([JSONValue].self)) }
    }
}
