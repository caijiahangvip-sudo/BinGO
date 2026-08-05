import Foundation
import SwiftData

@Model
final class ClassroomRecord {
    @Attribute(.unique) var id: UUID
    var remoteID: String?
    var title: String
    var summary: String
    var stageData: Data
    var scenesData: Data
    var createdAt: Date
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        remoteID: String? = nil,
        title: String,
        summary: String = "",
        stageData: Data = Data(),
        scenesData: Data = Data(),
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.remoteID = remoteID
        self.title = title
        self.summary = summary
        self.stageData = stageData
        self.scenesData = scenesData
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    var stage: StageDTO? {
        get { try? JSONDecoder().decode(StageDTO.self, from: stageData) }
        set { stageData = (try? JSONEncoder().encode(newValue)) ?? Data() }
    }

    var scenes: [SceneDTO] {
        get { (try? JSONDecoder().decode([SceneDTO].self, from: scenesData)) ?? [] }
        set { scenesData = (try? JSONEncoder().encode(newValue)) ?? Data() }
    }
}

@Model
final class HomeworkRecord {
    @Attribute(.unique) var id: UUID
    var title: String
    var prompt: String
    var answer: String
    var status: String
    var createdAt: Date
    var updatedAt: Date

    init(title: String, prompt: String = "") {
        id = UUID()
        self.title = title
        self.prompt = prompt
        answer = ""
        status = "draft"
        createdAt = .now
        updatedAt = .now
    }
}

@Model
final class BookPlanRecord {
    @Attribute(.unique) var id: UUID
    var remoteID: String?
    var title: String
    var sourceFileName: String
    var summary: String
    var totalLessons: Int
    var currentLessonIndex: Int
    var progress: Double
    var notes: String
    var planData: Data
    var createdAt: Date
    var updatedAt: Date

    init(
        title: String,
        sourceFileName: String,
        remoteID: String? = nil,
        summary: String = "",
        totalLessons: Int = 0,
        currentLessonIndex: Int = 0,
        planData: Data = Data()
    ) {
        id = UUID()
        self.remoteID = remoteID
        self.title = title
        self.sourceFileName = sourceFileName
        self.summary = summary
        self.totalLessons = totalLessons
        self.currentLessonIndex = currentLessonIndex
        progress = 0
        notes = ""
        self.planData = planData
        createdAt = .now
        updatedAt = .now
    }

    var plan: BookLearningPlanDTO? {
        get { try? JSONDecoder().decode(BookLearningPlanDTO.self, from: planData) }
        set { planData = (try? JSONEncoder().encode(newValue)) ?? Data() }
    }
}

@Model
final class ImportedDocument {
    @Attribute(.unique) var id: UUID
    var fileName: String
    var localPath: String
    var extractedText: String
    var pageCount: Int
    var createdAt: Date

    init(fileName: String, localPath: String, extractedText: String = "", pageCount: Int = 0) {
        id = UUID()
        self.fileName = fileName
        self.localPath = localPath
        self.extractedText = extractedText
        self.pageCount = pageCount
        createdAt = .now
    }
}

@Model
final class WhiteboardRecord {
    @Attribute(.unique) var id: UUID
    var title: String
    var drawingData: Data
    var updatedAt: Date

    init(title: String = "默认白板", drawingData: Data = Data()) {
        id = UUID()
        self.title = title
        self.drawingData = drawingData
        updatedAt = .now
    }
}
