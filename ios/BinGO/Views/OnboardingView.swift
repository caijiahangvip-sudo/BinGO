import SwiftUI

struct OnboardingPage: Identifiable {
    let id = UUID()
    let icon: String
    let color: Color
    let title: String
    let paragraphs: [String]
}

let onboardingPages: [OnboardingPage] = [
    OnboardingPage(
        icon: "hand.wave.fill",
        color: .blue,
        title: "欢迎来到 BinGO",
        paragraphs: [
            "BinGO 是你的学习小助手。老师布置的学习目标、练习和作业会发到这台 iPad 上，你完成的作品也可以直接交给老师批改。",
            "这套系统一共有三个部分：你手上这个学生端 App、老师用的教师端、还有学校管理员用的后台。你只需要学会用这个 App 就够了。",
            "你的账号和学习数据保存在服务器上，所以就算换一台 iPad，只要登录同一个账号，所有内容都还在。",
            "接下来花一两分钟，跟着这几页了解一下怎么用。以后也可以在「设置 → 新手教程」里随时重新看。",
        ]
    ),
    OnboardingPage(
        icon: "person.badge.key.fill",
        color: .orange,
        title: "第一步：注册和登录",
        paragraphs: [
            "第一次打开 App，需要先有一个账号。",
            "注册方法：① 在登录页面点「注册」；② 输入老师给你的「邀请码」；③ 设置你自己的用户名和密码，就完成啦。",
            "邀请码要找老师或管理员领取。如果提示邀请码不对或已过期，告诉老师，老师会换一个新的给你。",
            "已经有账号的同学，直接输入用户名和密码登录就可以。",
            "小提醒：密码要字母加数字组合，不要告诉同学，也不要写在便签上贴在屏幕边。",
        ]
    ),
    OnboardingPage(
        icon: "person.3.fill",
        color: .green,
        title: "第二步：加入班级",
        paragraphs: [
            "登录之后最重要的一件事：加入你的班级。",
            "打开左边栏最下面的「设置」，找到「学习网络」，点进去。",
            "在「主要班级」一栏输入老师发的班级邀请码，点「加入班级」。看到班级名字出现，就说明加入成功了。",
            "只有加入班级之后，老师发布的学习目标、练习和测评才会送到你的 iPad 上，千万不要跳过这一步。",
            "在同一个页面还可以输入小组邀请码，加入「学习小组」，和同学一起完成任务、讨论问题。",
        ]
    ),
    OnboardingPage(
        icon: "house.fill",
        color: .blue,
        title: "首页：今天该做什么",
        paragraphs: [
            "打开 App 最先看到的就是「首页」。",
            "这里会汇总你当前的学习情况：待完成的任务、老师新发的内容、同步状态等。",
            "每天早上到校后，先看一眼首页，确认今天有哪些学习任务，做完一项就少一项。",
            "如果首页显示服务器离线，先检查 iPad 的 Wi-Fi 是不是连接正常。",
        ]
    ),
    OnboardingPage(
        icon: "rectangle.on.rectangle.angled",
        color: .purple,
        title: "课堂",
        paragraphs: [
            "「课堂」里是老师上课用的内容。",
            "上课时可以在这里跟着老师的节奏学习，查看课堂资料和练习。",
            "如果老师开了课堂互动，按屏幕上的提示参加就可以。",
        ]
    ),
    OnboardingPage(
        icon: "pencil.and.scribble",
        color: .pink,
        title: "白板：你的草稿纸",
        paragraphs: [
            "「白板」就像一张用不完的草稿纸。",
            "数学演算、画思维导图、随手记灵感，都可以直接用手指或 Apple Pencil 在上面写画。",
            "白板内容会保存在你的账号里，换设备登录也能找回来，不用拍照备份。",
        ]
    ),
    OnboardingPage(
        icon: "doc.viewfinder",
        color: .teal,
        title: "PDF 与 OCR：把纸搬进 iPad",
        paragraphs: [
            "纸质练习册、试卷上的题目，可以用「PDF 与 OCR」变成电子版。",
            "OCR 的意思是「文字识别」：拍一张照片，App 会把图里的文字认出来，变成可以复制、可以搜索的文字。",
            "拍照时注意：光线亮一点、纸放平、镜头正对纸面，识别会更准。",
            "识别出来的内容可以保存下来，配合其他功能继续学习。",
        ]
    ),
    OnboardingPage(
        icon: "checklist",
        color: .red,
        title: "作业：按时提交",
        paragraphs: [
            "「作业」里是老师布置给你的任务列表。",
            "点进一个任务，可以看到老师的要求和截止时间，完成后按页面提示提交你的成果。",
            "提交之后老师就能看到并批改，批改结果也会返回到这里，记得回来看老师的评语。",
            "如果有 AI 评分建议功能，它只负责给参考意见，最终成绩由老师决定。",
        ]
    ),
    OnboardingPage(
        icon: "books.vertical",
        color: .brown,
        title: "书本学习",
        paragraphs: [
            "「书本学习」用来跟着教材和电子书学习。",
            "把课本内容导进来之后，可以按章节阅读、做笔记，安排自己的学习进度。",
            "配合白板和 PDF 扫描，可以把书上的重点整理成自己的学习资料。",
        ]
    ),
    OnboardingPage(
        icon: "brain.head.profile",
        color: .indigo,
        title: "学习工具：AI 小帮手",
        paragraphs: [
            "「学习工具」里是 AI 学习功能，比如讲解题目、练习对话等。",
            "使用小原则：AI 是来帮你「学会」的，不是替你「做完」的。先自己思考，再问 AI，效果最好。",
            "AI 的回答偶尔也会出错，重要内容要和课本、老师讲的核对一下。",
        ]
    ),
    OnboardingPage(
        icon: "arrow.triangle.2.circlepath",
        color: .green,
        title: "同步：数据不怕丢",
        paragraphs: [
            "App 会自动把学习数据同步到服务器，回到前台时也会自动同步一次，一般不用你操心。",
            "想立刻同步：打开「设置」，在「服务器与同步」里点「立即同步」，下面会显示上一次同步的结果。",
            "换 iPad 或重装 App 时，只要重新登录账号，数据就会下载回来。",
            "在「设置 → 学习网络 → 已登录设备」里能看到你的账号登录了哪些设备；不用的设备点「撤销」把它踢下线。",
            "注意：如果两台设备同时离线改同一份内容，后同步的会覆盖先同步的。重要修改完记得及时联网同步。",
        ]
    ),
    OnboardingPage(
        icon: "questionmark.circle.fill",
        color: .gray,
        title: "遇到问题怎么办",
        paragraphs: [
            "忘记密码：找老师或管理员帮你重置，不要自己乱试太多次。",
            "收不到老师的任务：先确认已经加入班级（设置 → 学习网络），再点一次「立即同步」。",
            "邀请码失效：邀请码会定期更换，找老师要最新的。",
            "App 卡在某个页面：从屏幕底部上滑把 App 关掉，重新打开一般就好了。",
            "网络不好时：白板、书本学习等本地功能照样能用，联网后数据会自动补同步。",
            "其他解决不了的问题：直接告诉老师，老师会联系管理员处理。",
        ]
    ),
]

struct OnboardingView: View {
    let onFinish: () -> Void
    @State private var pageIndex = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                if pageIndex < onboardingPages.count - 1 {
                    Button("跳过") { onFinish() }
                        .padding()
                }
            }
            TabView(selection: $pageIndex) {
                ForEach(Array(onboardingPages.enumerated()), id: \.element.id) { index, page in
                    OnboardingPageView(page: page)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            Button(buttonTitle) {
                if pageIndex < onboardingPages.count - 1 {
                    withAnimation { pageIndex += 1 }
                } else {
                    onFinish()
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.bottom, 34)
        }
    }

    private var buttonTitle: String {
        pageIndex < onboardingPages.count - 1 ? "下一步" : "开始使用"
    }
}

private struct OnboardingPageView: View {
    let page: OnboardingPage

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                Image(systemName: page.icon)
                    .font(.system(size: 64))
                    .foregroundStyle(page.color)
                    .padding(.top, 12)
                Text(page.title)
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(page.paragraphs, id: \.self) { paragraph in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(page.color)
                                .padding(.top, 2)
                            Text(paragraph)
                                .font(.body)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .padding(.horizontal, 8)
            }
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 28)
            .padding(.bottom, 30)
        }
    }
}
