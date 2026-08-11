import Foundation

struct SyncHTTPError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

actor SyncAPI {
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(session: URLSession = .shared) {
        self.session = session
    }

    func health(baseURL: URL) async throws -> Bool {
        struct Response: Codable { let ok: Bool }
        let response: Response = try await request(baseURL: baseURL, path: "/health")
        return response.ok
    }

    func register(baseURL: URL, inviteCode: String, username: String, password: String) async throws -> SyncAuthSession {
        try await request(baseURL: baseURL, path: "/v1/auth/register", method: "POST", body: [
            "inviteCode": inviteCode,
            "username": username,
            "password": password,
            "deviceName": ProcessInfo.processInfo.hostName,
            "platform": "ipados",
        ])
    }

    func login(baseURL: URL, identifier: String, password: String) async throws -> SyncAuthSession {
        try await request(baseURL: baseURL, path: "/v1/auth/login", method: "POST", body: [
            "identifier": identifier,
            "password": password,
            "deviceName": ProcessInfo.processInfo.hostName,
            "platform": "ipados",
        ])
    }

    func refresh(baseURL: URL, refreshToken: String) async throws -> SyncAuthSession {
        try await request(baseURL: baseURL, path: "/v1/auth/refresh", method: "POST", body: ["refreshToken": refreshToken])
    }

    func me(baseURL: URL, accessToken: String) async throws -> SyncAccount {
        struct Response: Codable { let account: SyncAccount }
        let response: Response = try await request(baseURL: baseURL, path: "/v1/me", accessToken: accessToken)
        return response.account
    }

    func devices(baseURL: URL, accessToken: String) async throws -> [SyncDevice] {
        struct Response: Codable { let devices: [SyncDevice] }
        let response: Response = try await request(baseURL: baseURL, path: "/v1/devices", accessToken: accessToken)
        return response.devices
    }

    func logout(baseURL: URL, accessToken: String) async throws {
        try await requestWithoutResponse(baseURL: baseURL, path: "/v1/auth/logout", method: "POST", accessToken: accessToken)
    }

    func revokeDevice(baseURL: URL, accessToken: String, id: String) async throws {
        try await requestWithoutResponse(baseURL: baseURL, path: "/v1/devices/\(id)", method: "DELETE", accessToken: accessToken)
    }

    func supportRequests(baseURL: URL, accessToken: String) async throws -> [SupportAccessRequest] {
        struct Response: Codable { let requests: [SupportAccessRequest] }
        let response: Response = try await request(baseURL: baseURL, path: "/v1/support/requests", accessToken: accessToken)
        return response.requests
    }

    func teachingBootstrap(baseURL: URL, accessToken: String) async throws -> TeachingBootstrap {
        try await request(baseURL: baseURL, path: "/v1/teaching/bootstrap", accessToken: accessToken)
    }

    func learningTasks(baseURL: URL, accessToken: String) async throws -> [LearningTask] {
        struct Response: Codable { let tasks: [LearningTask] }
        let response: Response = try await request(baseURL: baseURL, path: "/v1/tasks", accessToken: accessToken)
        return response.tasks
    }

    func joinPrimaryClass(baseURL: URL, accessToken: String, inviteCode: String) async throws {
        struct Response: Codable { let ok: Bool }
        let _: Response = try await request(baseURL: baseURL, path: "/v1/classes/join", method: "POST", accessToken: accessToken, body: ["inviteCode": inviteCode])
    }

    func submitTask(baseURL: URL, accessToken: String, id: String, summary: String) async throws {
        struct Response: Decodable {
            struct Submission: Decodable { let id: String }
            let submission: Submission
        }
        struct Body: Encodable { let summary: String; let evidence: [[String: String]] }
        let _: Response = try await request(baseURL: baseURL, path: "/v1/tasks/\(id)/submissions", method: "POST", accessToken: accessToken, body: Body(summary: summary, evidence: []))
    }

    func joinStudyGroup(baseURL: URL, accessToken: String, inviteCode: String) async throws {
        struct Response: Codable { let ok: Bool }
        let _: Response = try await request(baseURL: baseURL, path: "/v1/groups/join", method: "POST", accessToken: accessToken, body: ["inviteCode": inviteCode])
    }

    func teachingNotifications(baseURL: URL, accessToken: String) async throws -> [TeachingNotification] {
        struct Response: Codable { let notifications: [TeachingNotification] }
        let response: Response = try await request(baseURL: baseURL, path: "/v1/notifications", accessToken: accessToken)
        return response.notifications
    }

    func markTeachingNotification(baseURL: URL, accessToken: String, id: String) async throws {
        struct Response: Codable { let ok: Bool }
        let _: Response = try await request(baseURL: baseURL, path: "/v1/notifications/\(id)/read", method: "POST", accessToken: accessToken, body: [String: String]())
    }

    func decideSupportRequest(baseURL: URL, accessToken: String, id: String, decision: String, grantType: String) async throws {
        struct Response: Codable { let ok: Bool }
        let _: Response = try await request(
            baseURL: baseURL,
            path: "/v1/support/requests/\(id)/decision",
            method: "POST",
            accessToken: accessToken,
            body: ["decision": decision, "grantType": grantType]
        )
    }

    func rotateInviteCode(baseURL: URL, accessToken: String, inviteCode: String) async throws {
        struct Response: Codable { let enabled: Bool }
        let _: Response = try await request(baseURL: baseURL, path: "/v1/admin/invite-code/rotate", method: "POST", accessToken: accessToken, body: ["inviteCode": inviteCode])
    }

    func pull(baseURL: URL, accessToken: String, cursor: Int) async throws -> (records: [SyncRecordDTO], cursor: Int) {
        struct Response: Codable { let records: [SyncRecordDTO]; let cursor: Int }
        let response: Response = try await request(baseURL: baseURL, path: "/v1/sync/records?cursor=\(cursor)", accessToken: accessToken)
        return (response.records, response.cursor)
    }

    func push(baseURL: URL, accessToken: String, records: [SyncRecordMutation]) async throws -> (version: Int?, conflicts: Int) {
        struct Accepted: Codable { let version: Int }
        struct Response: Codable { let accepted: [Accepted]; let conflicts: [Conflict] }
        struct Conflict: Codable {}
        let response: Response = try await request(baseURL: baseURL, path: "/v1/sync/records", method: "POST", accessToken: accessToken, body: PushBody(records: records))
        return (response.accepted.first?.version, response.conflicts.count)
    }

    private struct PushBody: Codable { let records: [SyncRecordMutation] }

    private func request<Response: Decodable, Body: Encodable>(baseURL: URL, path: String, method: String = "GET", accessToken: String? = nil, body: Body? = nil) async throws -> Response {
        var request = try makeRequest(baseURL: baseURL, path: path, method: method, accessToken: accessToken)
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        return try decoder.decode(Response.self, from: data)
    }

    private func request<Response: Decodable>(baseURL: URL, path: String, method: String = "GET", accessToken: String? = nil) async throws -> Response {
        let body: String? = nil
        return try await request(baseURL: baseURL, path: path, method: method, accessToken: accessToken, body: body)
    }

    private func requestWithoutResponse(baseURL: URL, path: String, method: String, accessToken: String) async throws {
        let request = try makeRequest(baseURL: baseURL, path: path, method: method, accessToken: accessToken)
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
    }

    private func makeRequest(baseURL: URL, path: String, method: String, accessToken: String?) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let accessToken { request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization") }
        return request
    }

    private func validate(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? decoder.decode(ErrorPayload.self, from: data)
            throw SyncHTTPError(status: http.statusCode, message: payload?.error ?? "服务器请求失败（\(http.statusCode)）")
        }
    }

    private struct ErrorPayload: Codable { let error: String? }
}
