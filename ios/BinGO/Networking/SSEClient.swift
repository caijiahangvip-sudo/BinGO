import Foundation

struct ServerSentEvent: Equatable, Sendable {
    var event: String?
    var id: String?
    var data: String
}

enum SSEParser {
    static func parse(block: String) -> ServerSentEvent? {
        var event: String?
        var id: String?
        var dataLines: [String] = []
        for rawLine in block.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.hasSuffix("\r") ? rawLine.dropLast() : rawLine[...]
            if line.hasPrefix(":") { continue }
            if line.hasPrefix("event:") { event = value(after: "event:", in: line) }
            else if line.hasPrefix("id:") { id = value(after: "id:", in: line) }
            else if line.hasPrefix("data:") { dataLines.append(value(after: "data:", in: line)) }
        }
        guard !dataLines.isEmpty || event != nil else { return nil }
        return ServerSentEvent(event: event, id: id, data: dataLines.joined(separator: "\n"))
    }

    private static func value(after prefix: String, in line: Substring) -> String {
        String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
    }
}

enum SSEClient {
    static func stream(
        request: URLRequest,
        session: URLSession
    ) -> AsyncThrowingStream<ServerSentEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
                    guard (200..<300).contains(http.statusCode) else {
                        if http.statusCode == 401 { throw APIError.unauthorized }
                        throw APIError.server(status: http.statusCode, message: "流式请求失败")
                    }
                    var block = ""
                    for try await line in bytes.lines {
                        if line.isEmpty {
                            if let event = SSEParser.parse(block: block) { continuation.yield(event) }
                            block = ""
                        } else {
                            block += line + "\n"
                        }
                    }
                    if let event = SSEParser.parse(block: block) { continuation.yield(event) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
