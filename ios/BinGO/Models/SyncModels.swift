import Foundation

struct SyncAccount: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let organizationId: String
    let username: String?
    let role: String
    let displayName: String
}

struct SyncAuthSession: Codable, Sendable {
    let accessToken: String
    let refreshToken: String?
    let account: SyncAccount
}

struct SyncDevice: Codable, Sendable, Identifiable {
    let id: String
    let deviceName: String
    let platform: String
    let createdAt: String
    let lastSeenAt: String
    let revoked: Bool
}

struct SupportAccessRequest: Codable, Sendable, Identifiable {
    let id: String
    let administratorName: String
    let entityType: String
    let entityId: String
    let status: String
    let requestedAt: String
    let decidedAt: String?
    let consumedAt: String?
}

struct LearningClassSummary: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let description: String
}

struct TeachingBootstrap: Codable, Sendable {
    let account: SyncAccount
    let primaryClass: LearningClassSummary?
    let teacherAssignments: [TeacherAssignmentSummary]
    let groups: [StudyGroupSummary]
    let unreadNotifications: Int
}

struct TeacherAssignmentSummary: Codable, Sendable, Identifiable {
    let id: String
    let classId: String
    let className: String
    let subjectName: String
    let roleName: String
    let capabilities: [String]
}

struct StudyGroupSummary: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let description: String
    let memberRole: String
}

struct LearningTask: Codable, Sendable, Identifiable {
    let id: String
    let title: String
    let description: String
    let className: String?
    let groupName: String?
    let taskKind: String?
    let requirement: String
    let dueAt: String?
    let status: String
    let submissionStatus: String?

    enum CodingKeys: String, CodingKey {
        case id, title, description, className, groupName, requirement, status, submissionStatus
        case taskKind = "task_kind"
        case dueAt = "due_at"
    }
}

struct TeachingNotification: Codable, Sendable, Identifiable {
    let id: String
    let type: String
    let title: String
    let body: String
    let createdAt: String
    let readAt: String?
}

struct SyncRecordDTO: Codable, Sendable {
    let entityType: String
    let entityId: String
    let payload: SyncPayload?
    let version: Int
    let visibility: String
    let deletedAt: String?
    let updatedAt: String
}

struct SyncPayload: Codable, Sendable {
    let value: String
}

struct SyncRecordMutation: Codable, Sendable {
    let entityType: String
    let entityId: String
    let baseVersion: Int?
    let payload: SyncPayload?
    let deleted: Bool
    let visibility: String
}

struct NativeDataSnapshot: Codable, Sendable {
    var classrooms: [ClassroomSnapshot]
    var homework: [HomeworkSnapshot]
    var books: [BookSnapshot]
    var documents: [DocumentSnapshot]
    var whiteboards: [WhiteboardSnapshot]
}

struct ClassroomSnapshot: Codable, Sendable {
    let id: UUID
    let remoteID: String?
    let title: String
    let summary: String
    let stageData: Data
    let scenesData: Data
    let createdAt: Date
    let updatedAt: Date
}

struct HomeworkSnapshot: Codable, Sendable {
    let id: UUID
    let title: String
    let prompt: String
    let answer: String
    let status: String
    let createdAt: Date
    let updatedAt: Date
}

struct BookSnapshot: Codable, Sendable {
    let id: UUID
    let remoteID: String?
    let title: String
    let sourceFileName: String
    let summary: String
    let totalLessons: Int
    let currentLessonIndex: Int
    let progress: Double
    let notes: String
    let planData: Data
    let createdAt: Date
    let updatedAt: Date
}

struct DocumentSnapshot: Codable, Sendable {
    let id: UUID
    let fileName: String
    let localPath: String
    let extractedText: String
    let pageCount: Int
    let createdAt: Date
}

struct WhiteboardSnapshot: Codable, Sendable {
    let id: UUID
    let title: String
    let drawingData: Data
    let updatedAt: Date
}
