import Foundation

struct TeacherAccount: Codable, Identifiable {
    let id: String
    let username: String?
    let role: String
    let displayName: String
}

struct TeacherAuthSession: Codable {
    let accessToken: String
    let refreshToken: String?
    let account: TeacherAccount
}

struct TeacherAssignment: Codable, Identifiable {
    let id: String
    let classId: String
    let className: String
    let subjectName: String
    let roleName: String
    let capabilities: [String]
}

struct StudyGroupSummary: Codable, Identifiable {
    let id: String
    let name: String
    let description: String
    let memberRole: String
}

struct TeacherBootstrap: Codable {
    let account: TeacherAccount
    let teacherAssignments: [TeacherAssignment]
    let groups: [StudyGroupSummary]
    let unreadNotifications: Int
}

struct LearningTaskDTO: Codable, Identifiable {
    let id: String
    let title: String
    let description: String
    let className: String?
    let groupName: String?
    let taskKind: String?
    let requirement: String
    let dueAt: String?
    let status: String
    let submissionCount: Int?

    enum CodingKeys: String, CodingKey {
        case id, title, description, className, groupName, requirement, status, submissionCount
        case taskKind = "task_kind"
        case dueAt = "due_at"
    }
}

struct TeacherStudent: Codable, Identifiable {
    let id: String
    let username: String
    let assignedCount: Int
    let submittedCount: Int
    let gradedCount: Int
}

struct TeacherNotification: Codable, Identifiable {
    let id: String
    let type: String
    let title: String
    let body: String
    let createdAt: String
    let readAt: String?
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    let senderId: String
    let text: String
    let attachments: [String]
    let createdAt: String
}

struct TaskListResponse: Codable { let tasks: [LearningTaskDTO] }
struct StudentListResponse: Codable { let students: [TeacherStudent] }
struct NotificationListResponse: Codable { let notifications: [TeacherNotification] }
struct MessageListResponse: Codable { let messages: [ChatMessage] }
struct GroupCreateResponse: Codable { let id: String; let code: String }
