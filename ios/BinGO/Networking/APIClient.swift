import Foundation

actor APIClient {
    private let configuration: APIConfiguration
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(configuration: APIConfiguration, session: URLSession = .shared) {
        self.configuration = configuration.normalized()
        self.session = session
        encoder = JSONEncoder()
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    func get<Response: Decodable & Sendable>(_ path: String) async throws -> Response {
        try await send(path, method: "GET", body: Optional<EmptyBody>.none)
    }

    func post<Response: Decodable & Sendable, Body: Encodable & Sendable>(
        _ path: String,
        body: Body
    ) async throws -> Response {
        try await send(path, method: "POST", body: body)
    }

    func post<Response: Decodable & Sendable>(_ path: String) async throws -> Response {
        try await send(path, method: "POST", body: Optional<EmptyBody>.none)
    }

    func delete<Response: Decodable & Sendable>(_ path: String) async throws -> Response {
        try await send(path, method: "DELETE", body: Optional<EmptyBody>.none)
    }

    func send<Response: Decodable & Sendable, Body: Encodable & Sendable>(
        _ path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        var request = try request(path: path, method: method)
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }

    func upload<Response: Decodable & Sendable>(
        _ path: String,
        fields: [String: String],
        file: UploadFile
    ) async throws -> Response {
        let boundary = "BinGO-\(UUID().uuidString)"
        var request = try request(path: path, method: "POST")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = MultipartFormData(boundary: boundary)
            .adding(fields: fields)
            .adding(file: file)
            .data
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }

    func stream<Body: Encodable & Sendable>(
        _ path: String,
        body: Body
    ) throws -> AsyncThrowingStream<ServerSentEvent, Error> {
        var request = try request(path: path, method: "POST")
        request.httpBody = try encoder.encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        return SSEClient.stream(request: request, session: session)
    }

    private func request(path: String, method: String) throws -> URLRequest {
        guard let baseURL = configuration.baseURL else { throw APIError.missingBaseURL }
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw APIError.missingBaseURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 120
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !configuration.token.isEmpty {
            request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { throw APIError.unauthorized }
            let payload = try? decoder.decode(APIErrorPayload.self, from: data)
            let message = payload?.details ?? payload?.error ?? payload?.message
                ?? String(data: data, encoding: .utf8)
                ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw APIError.server(status: http.statusCode, message: message)
        }
    }
}

private struct EmptyBody: Codable, Sendable {}

struct UploadFile: Sendable {
    let fieldName: String
    let fileName: String
    let mimeType: String
    let data: Data
}

private struct MultipartFormData {
    let boundary: String
    private(set) var data = Data()

    func adding(fields: [String: String]) -> MultipartFormData {
        var copy = self
        for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
            copy.append("--\(boundary)\r\n")
            copy.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            copy.append("\(value)\r\n")
        }
        return copy
    }

    func adding(file: UploadFile) -> MultipartFormData {
        var copy = self
        copy.append("--\(boundary)\r\n")
        copy.append("Content-Disposition: form-data; name=\"\(file.fieldName)\"; filename=\"\(file.fileName)\"\r\n")
        copy.append("Content-Type: \(file.mimeType)\r\n\r\n")
        copy.data.append(file.data)
        copy.append("\r\n--\(boundary)--\r\n")
        return copy
    }

    private mutating func append(_ string: String) {
        data.append(Data(string.utf8))
    }
}
