import Foundation

actor BinGOAPI {
    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func generateClassroom(
        request: GenerationRequestDTO,
        progress: (@Sendable (GenerationJobResponse) async -> Void)? = nil
    ) async throws -> ClassroomDTO {
        let start: GenerationStartResponse = try await client.post("/api/generate-classroom", body: request)
        var delay = start.pollIntervalMs ?? 5_000

        while !Task.isCancelled {
            try await Task.sleep(for: .milliseconds(delay))
            let job: GenerationJobResponse = try await client.get("/api/generate-classroom/\(start.jobId)")
            await progress?(job)
            delay = job.pollIntervalMs ?? delay

            if job.status == "failed" {
                throw APIError.server(status: 500, message: job.error ?? job.message)
            }
            if job.done {
                guard let classroomID = job.result?.classroomId else {
                    throw APIError.decoding("课堂生成完成，但响应中没有课堂 ID。")
                }
                return try await classroom(id: classroomID)
            }
        }
        throw CancellationError()
    }

    func classroom(id: String) async throws -> ClassroomDTO {
        guard let encodedID = id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            throw APIError.invalidResponse
        }
        let response: ClassroomReadResponse = try await client.get("/api/classroom?id=\(encodedID)")
        return response.classroom
    }

    func saveClassroom(stage: StageDTO, scenes: [SceneDTO]) async throws -> ClassroomSaveResponse {
        try await client.post("/api/classroom", body: ClassroomSaveRequest(stage: stage, scenes: scenes))
    }

    func solveHomework(
        file: UploadFile,
        language: String = "zh-CN",
        progress: (@Sendable (HomeworkJobResponse) async -> Void)? = nil
    ) async throws -> HomeworkJobResponse {
        let start = try await startHomework(file: file, language: language)
        var delay = start.pollIntervalMs ?? 3_000

        while !Task.isCancelled {
            if start.done { return start }
            try await Task.sleep(for: .milliseconds(delay))
            let job = try await homeworkJob(id: start.jobId)
            await progress?(job)
            delay = job.pollIntervalMs ?? delay
            if job.status == "failed" {
                throw APIError.server(status: 500, message: job.error ?? job.message)
            }
            if job.done { return job }
        }
        throw CancellationError()
    }

    func startHomework(file: UploadFile, language: String = "zh-CN") async throws -> HomeworkJobResponse {
        try await client.upload(
            "/api/homework/solve",
            fields: ["language": language],
            file: file
        )
    }

    func homeworkJob(id: String) async throws -> HomeworkJobResponse {
        try await client.get("/api/homework/solve/\(id)")
    }

    func cancelHomework(jobID: String) async throws -> HomeworkCancelResponse {
        try await client.post("/api/homework/solve/\(jobID)/cancel")
    }

    func generateBookPlan(request: BookPlanRequest) async throws -> BookPlanResponse {
        try await client.post("/api/generate/book-plan", body: request)
    }

    func webSearch(query: String, pdfText: String? = nil) async throws -> WebSearchResponse {
        try await client.post("/api/web-search", body: WebSearchRequest(query: query, pdfText: pdfText))
    }

    func gradeQuiz(request: QuizGradeRequest) async throws -> QuizGradeResponse {
        try await client.post("/api/quiz-grade", body: request)
    }

    func cloudOCR(file: UploadFile) async throws -> String {
        let response: CloudTextResponse = try await client.upload(
            "/api/local-services/specialized/ocr",
            fields: [:],
            file: file
        )
        guard let text = response.resolvedText else {
            throw APIError.decoding("云端 OCR 返回了空结果")
        }
        return text
    }

    func cloudDocumentParsing(file: UploadFile) async throws -> String {
        let response: CloudTextResponse = try await client.upload(
            "/api/local-services/specialized/document",
            fields: [:],
            file: file
        )
        guard let text = response.resolvedText else {
            throw APIError.decoding("云端文档解析返回了空结果")
        }
        return text
    }

    func textbookCatalog() async throws -> [TextbookCatalogNode] {
        let response: TextbookCatalogResponse = try await client.get("/api/textbooks/catalog")
        return response.catalog
    }

    func textbookSearch(keyword: String) async throws -> [TextbookSearchResult] {
        let encoded = keyword.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? keyword
        let response: TextbookSearchResponse = try await client.get("/api/textbooks/search?keyword=\(encoded)")
        return response.results
    }

    func downloadTextbook(
        contentId: String,
        contentType: String,
        progress: (@Sendable (Double) -> Void)? = nil
    ) async throws -> Data {
        let body = TextbookDownloadRequest(contentId: contentId, contentType: contentType)
        if let progress {
            return try await client.downloadData("/api/textbooks/download", body: body, progress: progress)
        }
        return try await client.downloadData("/api/textbooks/download", body: body)
    }
}

