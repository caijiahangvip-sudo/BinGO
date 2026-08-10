import CryptoKit
import Foundation
import Observation
import SwiftData

@MainActor
@Observable
final class SyncSessionStore {
    private static let keychainService = "app.bingo.ipad.sync"
    private static let accessAccount = "access-token"
    private static let refreshAccount = "refresh-token"
    private static let accountDefaultsKey = "bingo.sync.account"
    private static let baseURLDefaultsKey = "bingo.sync.base-url"
    private static let cursorDefaultsKey = "bingo.sync.cursor"
    private static let versionDefaultsKey = "bingo.sync.native-version"
    private static let hashDefaultsKey = "bingo.sync.native-hash"
    private static let recordID = "ipados-native-records"

    var baseURLString: String
    var account: SyncAccount?
    var devices: [SyncDevice] = []
    var supportRequests: [SupportAccessRequest] = []
    var teachingBootstrap: TeachingBootstrap?
    var learningTasks: [LearningTask] = []
    var teachingNotifications: [TeachingNotification] = []
    var isOnline = false
    var isBusy = false
    var lastSyncMessage = "尚未同步"

    private let api = SyncAPI()

    init() {
        baseURLString = UserDefaults.standard.string(forKey: Self.baseURLDefaultsKey) ?? "https://bingo.mido.site"
        if let data = UserDefaults.standard.data(forKey: Self.accountDefaultsKey) {
            account = try? JSONDecoder().decode(SyncAccount.self, from: data)
        }
    }

    func bootstrap() async {
        guard account != nil else {
            await checkHealth()
            return
        }
        do {
            account = try await withAccessToken { token, baseURL in
                try await api.me(baseURL: baseURL, accessToken: token)
            }
            persistAccount()
            try await refreshDevices()
            try await refreshSupportRequests()
            try await refreshTeachingNetwork()
            isOnline = true
        } catch {
            isOnline = false
        }
    }

    func checkHealth() async {
        guard let baseURL else { isOnline = false; return }
        isOnline = (try? await api.health(baseURL: baseURL)) == true
    }

    func register(inviteCode: String, username: String, password: String) async throws {
        guard let baseURL else { throw URLError(.badURL) }
        let session = try await api.register(baseURL: baseURL, inviteCode: inviteCode, username: username, password: password)
        save(session)
        try await refreshDevices()
        try await refreshSupportRequests()
        try await refreshTeachingNetwork()
        isOnline = true
    }

    func login(identifier: String, password: String) async throws {
        guard let baseURL else { throw URLError(.badURL) }
        let session = try await api.login(baseURL: baseURL, identifier: identifier, password: password)
        save(session)
        try await refreshDevices()
        try await refreshSupportRequests()
        try await refreshTeachingNetwork()
        isOnline = true
    }

    func logout() async {
        if let accessToken, let baseURL { try? await api.logout(baseURL: baseURL, accessToken: accessToken) }
        clearSession()
    }

    func refreshDevices() async throws {
        devices = try await withAccessToken { token, baseURL in
            try await api.devices(baseURL: baseURL, accessToken: token)
        }
    }

    func revokeDevice(_ id: String) async throws {
        try await withAccessToken { token, baseURL in
            try await api.revokeDevice(baseURL: baseURL, accessToken: token, id: id)
        }
        try await refreshDevices()
    }

    func refreshSupportRequests() async throws {
        supportRequests = try await withAccessToken { token, baseURL in
            try await api.supportRequests(baseURL: baseURL, accessToken: token)
        }
    }

    func decideSupportRequest(_ id: String, approve: Bool, grantType: String = "once") async throws {
        try await withAccessToken { token, baseURL in
            try await api.decideSupportRequest(
                baseURL: baseURL,
                accessToken: token,
                id: id,
                decision: approve ? "approve" : "reject",
                grantType: grantType
            )
        }
        try await refreshSupportRequests()
    }

    func rotateInviteCode(_ inviteCode: String) async throws {
        try await withAccessToken { token, baseURL in
            try await api.rotateInviteCode(baseURL: baseURL, accessToken: token, inviteCode: inviteCode)
        }
    }

    func refreshTeachingNetwork() async throws {
        guard account?.role == "student", let accessToken, let baseURL else { return }
        teachingBootstrap = try await api.teachingBootstrap(baseURL: baseURL, accessToken: accessToken)
        learningTasks = try await api.learningTasks(baseURL: baseURL, accessToken: accessToken)
        teachingNotifications = try await api.teachingNotifications(baseURL: baseURL, accessToken: accessToken)
    }

    func joinPrimaryClass(_ inviteCode: String) async throws {
        try await withAccessToken { token, baseURL in try await api.joinPrimaryClass(baseURL: baseURL, accessToken: token, inviteCode: inviteCode) }
        try await refreshTeachingNetwork()
    }

    func submitLearningTask(_ task: LearningTask, summary: String) async throws {
        try await withAccessToken { token, baseURL in try await api.submitTask(baseURL: baseURL, accessToken: token, id: task.id, summary: summary) }
        try await refreshTeachingNetwork()
    }

    func joinStudyGroup(_ inviteCode: String) async throws {
        try await withAccessToken { token, baseURL in try await api.joinStudyGroup(baseURL: baseURL, accessToken: token, inviteCode: inviteCode) }
        try await refreshTeachingNetwork()
    }

    func markTeachingNotification(_ notification: TeachingNotification) async throws {
        try await withAccessToken { token, baseURL in try await api.markTeachingNotification(baseURL: baseURL, accessToken: token, id: notification.id) }
        try await refreshTeachingNetwork()
    }

    func synchronize(modelContext: ModelContext) async throws {
        isBusy = true
        defer { isBusy = false }
        let defaults = UserDefaults.standard
        var cursor = defaults.integer(forKey: Self.cursorDefaultsKey)
        var version = defaults.object(forKey: Self.versionDefaultsKey) as? Int
        var knownHash = defaults.string(forKey: Self.hashDefaultsKey)

        let pulled = try await withAccessToken { token, baseURL in
            try await api.pull(baseURL: baseURL, accessToken: token, cursor: cursor)
        }
        if let remote = pulled.records.last(where: { $0.entityType == "client-state" && $0.entityId == Self.recordID }),
           let value = remote.payload?.value,
           let data = value.data(using: .utf8) {
            let currentData = try encodeSnapshot(modelContext: modelContext)
            let currentHash = sha256(currentData)
            if knownHash == nil || knownHash == currentHash {
                let snapshot = try JSONDecoder().decode(NativeDataSnapshot.self, from: data)
                try apply(snapshot: snapshot, modelContext: modelContext)
                knownHash = sha256(data)
                version = remote.version
            }
        }
        cursor = pulled.cursor

        let data = try encodeSnapshot(modelContext: modelContext)
        let hash = sha256(data)
        if hash != knownHash {
            let value = String(decoding: data, as: UTF8.self)
            let mutation = SyncRecordMutation(entityType: "client-state", entityId: Self.recordID, baseVersion: version, payload: SyncPayload(value: value), deleted: false, visibility: "private")
            let result = try await withAccessToken { token, baseURL in
                try await api.push(baseURL: baseURL, accessToken: token, records: [mutation])
            }
            guard result.conflicts == 0 else { throw SyncHTTPError(status: 409, message: "检测到其他设备的更新，请再次同步") }
            version = result.version
            knownHash = hash
        }

        defaults.set(cursor, forKey: Self.cursorDefaultsKey)
        defaults.set(version, forKey: Self.versionDefaultsKey)
        defaults.set(knownHash, forKey: Self.hashDefaultsKey)
        lastSyncMessage = "同步完成 · \(Date.now.formatted(date: .omitted, time: .shortened))"
        isOnline = true
    }

    private var baseURL: URL? {
        let value = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: value), url.scheme == "https" || url.host == "localhost" else { return nil }
        UserDefaults.standard.set(value, forKey: Self.baseURLDefaultsKey)
        return url
    }

    private var accessToken: String? { KeychainStore.read(service: Self.keychainService, account: Self.accessAccount) }
    private var refreshToken: String? { KeychainStore.read(service: Self.keychainService, account: Self.refreshAccount) }

    private func withAccessToken<T>(_ work: (String, URL) async throws -> T) async throws -> T {
        guard let baseURL, let token = accessToken else { throw SyncHTTPError(status: 401, message: "请先登录同步账号") }
        do {
            return try await work(token, baseURL)
        } catch let error as SyncHTTPError where error.status == 401 {
            guard let refreshToken else { throw error }
            let session = try await api.refresh(baseURL: baseURL, refreshToken: refreshToken)
            save(session)
            return try await work(session.accessToken, baseURL)
        }
    }

    private func save(_ session: SyncAuthSession) {
        KeychainStore.write(session.accessToken, service: Self.keychainService, account: Self.accessAccount)
        if let refreshToken = session.refreshToken {
            KeychainStore.write(refreshToken, service: Self.keychainService, account: Self.refreshAccount)
        }
        account = session.account
        persistAccount()
    }

    private func persistAccount() {
        UserDefaults.standard.set(try? JSONEncoder().encode(account), forKey: Self.accountDefaultsKey)
    }

    private func clearSession() {
        KeychainStore.delete(service: Self.keychainService, account: Self.accessAccount)
        KeychainStore.delete(service: Self.keychainService, account: Self.refreshAccount)
        account = nil
        devices = []
        supportRequests = []
        UserDefaults.standard.removeObject(forKey: Self.accountDefaultsKey)
    }

    private func encodeSnapshot(modelContext: ModelContext) throws -> Data {
        let classrooms = try modelContext.fetch(FetchDescriptor<ClassroomRecord>()).map {
            ClassroomSnapshot(id: $0.id, remoteID: $0.remoteID, title: $0.title, summary: $0.summary, stageData: $0.stageData, scenesData: $0.scenesData, createdAt: $0.createdAt, updatedAt: $0.updatedAt)
        }
        let homework = try modelContext.fetch(FetchDescriptor<HomeworkRecord>()).map {
            HomeworkSnapshot(id: $0.id, title: $0.title, prompt: $0.prompt, answer: $0.answer, status: $0.status, createdAt: $0.createdAt, updatedAt: $0.updatedAt)
        }
        let books = try modelContext.fetch(FetchDescriptor<BookPlanRecord>()).map {
            BookSnapshot(id: $0.id, remoteID: $0.remoteID, title: $0.title, sourceFileName: $0.sourceFileName, summary: $0.summary, totalLessons: $0.totalLessons, currentLessonIndex: $0.currentLessonIndex, progress: $0.progress, notes: $0.notes, planData: $0.planData, createdAt: $0.createdAt, updatedAt: $0.updatedAt)
        }
        let documents = try modelContext.fetch(FetchDescriptor<ImportedDocument>()).map {
            DocumentSnapshot(id: $0.id, fileName: $0.fileName, localPath: $0.localPath, extractedText: $0.extractedText, pageCount: $0.pageCount, createdAt: $0.createdAt)
        }
        let whiteboards = try modelContext.fetch(FetchDescriptor<WhiteboardRecord>()).map {
            WhiteboardSnapshot(id: $0.id, title: $0.title, drawingData: $0.drawingData, updatedAt: $0.updatedAt)
        }
        return try JSONEncoder().encode(NativeDataSnapshot(classrooms: classrooms, homework: homework, books: books, documents: documents, whiteboards: whiteboards))
    }

    private func apply(snapshot: NativeDataSnapshot, modelContext: ModelContext) throws {
        try replace(modelContext.fetch(FetchDescriptor<ClassroomRecord>()), with: snapshot.classrooms, modelContext: modelContext) { item in
            let record = ClassroomRecord(id: item.id, remoteID: item.remoteID, title: item.title, summary: item.summary, stageData: item.stageData, scenesData: item.scenesData, createdAt: item.createdAt, updatedAt: item.updatedAt)
            return record
        }
        try replace(modelContext.fetch(FetchDescriptor<HomeworkRecord>()), with: snapshot.homework, modelContext: modelContext) { item in
            let record = HomeworkRecord(title: item.title, prompt: item.prompt)
            record.id = item.id; record.answer = item.answer; record.status = item.status; record.createdAt = item.createdAt; record.updatedAt = item.updatedAt
            return record
        }
        try replace(modelContext.fetch(FetchDescriptor<BookPlanRecord>()), with: snapshot.books, modelContext: modelContext) { item in
            let record = BookPlanRecord(title: item.title, sourceFileName: item.sourceFileName, remoteID: item.remoteID, summary: item.summary, totalLessons: item.totalLessons, currentLessonIndex: item.currentLessonIndex, planData: item.planData)
            record.id = item.id; record.progress = item.progress; record.notes = item.notes; record.createdAt = item.createdAt; record.updatedAt = item.updatedAt
            return record
        }
        try replace(modelContext.fetch(FetchDescriptor<ImportedDocument>()), with: snapshot.documents, modelContext: modelContext) { item in
            let record = ImportedDocument(fileName: item.fileName, localPath: item.localPath, extractedText: item.extractedText, pageCount: item.pageCount)
            record.id = item.id; record.createdAt = item.createdAt
            return record
        }
        try replace(modelContext.fetch(FetchDescriptor<WhiteboardRecord>()), with: snapshot.whiteboards, modelContext: modelContext) { item in
            let record = WhiteboardRecord(title: item.title, drawingData: item.drawingData)
            record.id = item.id; record.updatedAt = item.updatedAt
            return record
        }
        try modelContext.save()
    }

    private func replace<Model: PersistentModel, Snapshot>(_ records: [Model], with snapshots: [Snapshot], modelContext: ModelContext, make: (Snapshot) -> Model) throws {
        records.forEach(modelContext.delete)
        snapshots.map(make).forEach(modelContext.insert)
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
