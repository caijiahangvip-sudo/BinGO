import SwiftData
import SwiftUI

struct HomeView: View {
    @Environment(AppState.self) private var appState
    @Query(sort: \ClassroomRecord.updatedAt, order: .reverse) private var classrooms: [ClassroomRecord]

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: 16)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("BinGO 学习工作台")
                            .font(.largeTitle.bold())
                        Text("与 Windows 版共享任务和云端能力，同时使用原生 iPad 文档、语音与手写体验。")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    ConnectionBadge(connectivity: appState.connectivity)
                }

                LazyVGrid(columns: columns, spacing: 16) {
                    DashboardCard(title: "新建课堂", subtitle: "从主题开始生成课堂", icon: "sparkles") {
                        appState.selectedSection = .classrooms
                    }
                    DashboardCard(title: "打开白板", subtitle: "使用 Apple Pencil 书写", icon: "pencil.and.scribble") {
                        appState.selectedSection = .whiteboard
                    }
                    DashboardCard(title: "导入 PDF", subtitle: "本地阅读、提取和批注", icon: "doc.richtext") {
                        appState.selectedSection = .documents
                    }
                    DashboardCard(title: "拍照 OCR", subtitle: "使用 Vision 中英文识别", icon: "viewfinder") {
                        appState.selectedSection = .documents
                    }
                    DashboardCard(title: "作业模式", subtitle: "拍照识题、解题与进度管理", icon: "checklist") {
                        appState.selectedSection = .homework
                    }
                    DashboardCard(title: "书本学习", subtitle: "从教材生成分课学习计划", icon: "books.vertical") {
                        appState.selectedSection = .books
                    }
                    DashboardCard(title: "学习工具", subtitle: "联网搜索、主观题批改与能力检测", icon: "brain.head.profile") {
                        appState.selectedSection = .learningTools
                    }
                    DashboardCard(title: "处理设置", subtitle: "自动选择本地或云端能力", icon: "cpu") {
                        appState.selectedSection = .settings
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("当前处理策略").font(.title2.bold())
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(ProcessingCapability.allCases) { capability in
                            let decision = appState.processingMode(for: capability)
                            HStack {
                                Image(systemName: capability.systemImage).foregroundStyle(.blue)
                                VStack(alignment: .leading) {
                                    Text(capability.title).font(.headline)
                                    Text(decision.mode == .cloud ? "云端" : "本地")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(decision.mode == .cloud ? .blue : .green)
                                }
                                Spacer()
                            }
                            .padding()
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("最近课堂").font(.title2.bold())
                    if classrooms.isEmpty {
                        ContentUnavailableView("还没有课堂", systemImage: "rectangle.on.rectangle.angled", description: Text("创建的课堂会保存在这台 iPad。"))
                    } else {
                        ForEach(classrooms.prefix(5)) { classroom in
                            HStack {
                                Image(systemName: "rectangle.on.rectangle.angled")
                                    .foregroundStyle(.blue)
                                VStack(alignment: .leading) {
                                    Text(classroom.title).font(.headline)
                                    Text(classroom.updatedAt, style: .relative).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                            .padding()
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                        }
                    }
                }
            }
            .padding(24)
        }
        .navigationTitle("首页")
    }
}

private struct DashboardCard: View {
    let title: String
    let subtitle: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: icon).font(.system(size: 30)).foregroundStyle(.blue)
                Text(title).font(.headline)
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 120, alignment: .leading)
            .padding()
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
    }
}

private struct ConnectionBadge: View {
    let connectivity: AppState.Connectivity

    var body: some View {
        HStack(spacing: 7) {
            Circle().fill(color).frame(width: 9, height: 9)
            Text(label).font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.thinMaterial, in: Capsule())
    }

    private var color: Color {
        switch connectivity {
        case .checking: .orange
        case .online: .green
        case .offline: .gray
        }
    }

    private var label: String {
        switch connectivity {
        case .checking: "检查 API"
        case let .online(version): "API \(version)"
        case .offline: "本地模式"
        }
    }
}
