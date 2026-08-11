using System.Diagnostics;
using BinGOTeacher.Models;
using BinGOTeacher.Services;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.System;
using WinRT.Interop;

namespace BinGOTeacher;

public sealed partial class MainWindow : Window
{
    private readonly SessionStore _session = new();
    private readonly TeacherApiClient _api;
    private Bootstrap? _bootstrap;
    private LearningTask[] _tasks = [];
    private Attachment? _pendingAttachment;
    private bool _initialized;

    public MainWindow()
    {
        InitializeComponent();
        _session.Load();
        _api = new TeacherApiClient(_session);
        ConfigureWindow();
    }

    private void ConfigureWindow()
    {
        var windowHandle = WindowNative.GetWindowHandle(this);
        var windowId = Win32Interop.GetWindowIdFromWindow(windowHandle);
        var appWindow = AppWindow.GetFromWindowId(windowId);
        appWindow.Resize(new Windows.Graphics.SizeInt32(1360, 860));
    }

    private async void RootGrid_Loaded(object sender, RoutedEventArgs e)
    {
        if (_initialized) return;
        _initialized = true;
        SetBusy(true);
        if (await _api.RestoreAsync()) await EnterWorkspaceAsync();
        SetBusy(false);
    }

    private async void LoginButton_Click(object sender, RoutedEventArgs e)
    {
        await AuthenticateAsync(false);
    }

    private async void RegisterButton_Click(object sender, RoutedEventArgs e)
    {
        await AuthenticateAsync(true);
    }

    private async Task AuthenticateAsync(bool register)
    {
        LoginStatus.Text = "";
        if (string.IsNullOrWhiteSpace(UsernameBox.Text) || string.IsNullOrWhiteSpace(PasswordBox.Password))
        {
            LoginStatus.Text = "请输入用户名和密码。";
            return;
        }
        if (register && string.IsNullOrWhiteSpace(InviteBox.Text))
        {
            LoginStatus.Text = "注册教师账号需要填写教师邀请码。";
            return;
        }
        try
        {
            LoginButton.IsEnabled = false;
            LoginStatus.Text = register ? "正在注册…" : "正在登录…";
            if (register)
                await _api.RegisterAsync(InviteBox.Text.Trim(), UsernameBox.Text.Trim(), PasswordBox.Password);
            else
                await _api.LoginAsync(UsernameBox.Text.Trim(), PasswordBox.Password);
            PasswordBox.Password = "";
            await EnterWorkspaceAsync();
        }
        catch (Exception error)
        {
            LoginStatus.Text = error.Message;
        }
        finally
        {
            LoginButton.IsEnabled = true;
        }
    }

    private async Task EnterWorkspaceAsync()
    {
        try
        {
            SetBusy(true);
            _bootstrap = await _api.BootstrapAsync();
            LoginView.Visibility = Visibility.Collapsed;
            Navigation.Visibility = Visibility.Visible;
            Navigation.SelectedItem = Navigation.MenuItems[0];
            await ShowDashboardAsync();
        }
        catch (Exception error)
        {
            _api.Logout();
            LoginView.Visibility = Visibility.Visible;
            Navigation.Visibility = Visibility.Collapsed;
            LoginStatus.Text = error.Message;
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void Navigation_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItemContainer?.Tag is not string tag || LoginView.Visibility == Visibility.Visible) return;
        await RunPageAsync(async () =>
        {
            switch (tag)
            {
                case "dashboard": await ShowDashboardAsync(); break;
                case "students": await ShowStudentsAsync(); break;
                case "tasks": await ShowTasksAsync(); break;
                case "submissions": await ShowSubmissionsAsync(); break;
                case "groups": await ShowGroupsAsync(); break;
                case "messages": await ShowMessagesAsync(); break;
                case "notifications": await ShowNotificationsAsync(); break;
                case "settings": ShowSettings(); break;
            }
        });
    }

    private async Task RunPageAsync(Func<Task> action)
    {
        try { SetBusy(true); await action(); }
        catch (Exception error) { ShowStatus(error.Message, InfoBarSeverity.Error); }
        finally { SetBusy(false); }
    }

    private async Task ShowDashboardAsync()
    {
        _bootstrap = await _api.BootstrapAsync();
        _tasks = await _api.TasksAsync();
        var page = PagePanel("教学总览", $"欢迎回来，{_bootstrap.Account.DisplayName}");
        var metrics = new Grid { ColumnSpacing = 16 };
        for (var index = 0; index < 4; index++) metrics.ColumnDefinitions.Add(new ColumnDefinition());
        AddMetric(metrics, 0, "教学班级", _bootstrap.TeacherAssignments.Select(item => item.ClassId).Distinct().Count().ToString(), "当前有效任课关系");
        AddMetric(metrics, 1, "教学任务", _tasks.Length.ToString(), $"{_tasks.Count(item => item.Status == "draft")} 个草稿");
        AddMetric(metrics, 2, "学习小组", _bootstrap.Groups.Length.ToString(), "参与及管理的小组");
        AddMetric(metrics, 3, "未读通知", _bootstrap.UnreadNotifications.ToString(), "提交、批改和消息提醒");
        page.Children.Add(metrics);

        var recent = new StackPanel { Spacing = 10 };
        recent.Children.Add(SectionTitle("最近任务"));
        foreach (var task in _tasks.Take(6)) recent.Children.Add(TaskCard(task, false));
        if (!_tasks.Any()) recent.Children.Add(EmptyState("尚未创建教学任务", "前往“教学任务”创建学习目标、练习或测评。"));
        page.Children.Add(recent);
        Workspace.Content = Scroll(page);
    }

    private async Task ShowStudentsAsync()
    {
        _bootstrap ??= await _api.BootstrapAsync();
        var page = PagePanel("班级与学生", "查看班级成员及任务完成情况");
        var assignments = _bootstrap.TeacherAssignments.GroupBy(item => item.ClassId).Select(group => group.First()).ToArray();
        if (!assignments.Any())
        {
            page.Children.Add(EmptyState("暂无教学班级", "管理员分配教师角色后，班级会显示在这里。"));
            Workspace.Content = Scroll(page);
            return;
        }
        var picker = new ComboBox { Header = "选择班级", Width = 360, ItemsSource = assignments, DisplayMemberPath = "ClassName", SelectedIndex = 0 };
        var list = new StackPanel { Spacing = 10 };
        async Task LoadAsync()
        {
            list.Children.Clear();
            var assignment = (Assignment)picker.SelectedItem;
            var students = await _api.StudentsAsync(assignment.ClassId);
            foreach (var student in students)
            {
                var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
                actions.Children.Add(Badge($"已分配 {student.AssignedCount}"));
                actions.Children.Add(Badge($"已提交 {student.SubmittedCount}"));
                actions.Children.Add(Badge($"已批改 {student.GradedCount}"));
                list.Children.Add(RowCard(student.Username, $"完成率：{(student.AssignedCount == 0 ? 0 : student.SubmittedCount * 100 / student.AssignedCount)}%", actions));
            }
            if (!students.Any()) list.Children.Add(EmptyState("班级暂无学生", "学生使用班级邀请码加入后会显示在这里。"));
        }
        picker.SelectionChanged += async (_, _) => await RunPageAsync(LoadAsync);
        page.Children.Add(picker);
        page.Children.Add(list);
        Workspace.Content = Scroll(page);
        await LoadAsync();
    }

    private async Task ShowTasksAsync()
    {
        _bootstrap ??= await _api.BootstrapAsync();
        _tasks = await _api.TasksAsync();
        var page = PagePanel("教学任务", "创建学习目标、练习和测评并发布给班级或小组");
        var commands = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        var create = AccentButton("新建任务", "\uE710");
        create.Click += async (_, _) => await CreateTaskDialogAsync();
        var refresh = StandardButton("刷新", "\uE72C");
        refresh.Click += async (_, _) => await RunPageAsync(ShowTasksAsync);
        commands.Children.Add(create);
        commands.Children.Add(refresh);
        page.Children.Add(commands);
        var list = new StackPanel { Spacing = 10 };
        foreach (var task in _tasks) list.Children.Add(TaskCard(task, true));
        if (!_tasks.Any()) list.Children.Add(EmptyState("尚无教学任务", "点击“新建任务”创建第一项教学活动。"));
        page.Children.Add(list);
        Workspace.Content = Scroll(page);
    }

    private Border TaskCard(LearningTask task, bool withActions)
    {
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        actions.Children.Add(Badge(TaskKindLabel(task.TaskKind ?? task.TaskKindSnake)));
        actions.Children.Add(Badge(task.Requirement == "required" ? "必做" : "选做"));
        actions.Children.Add(Badge(StatusLabel(task.Status)));
        if (withActions && task.Status == "draft")
        {
            var publish = StandardButton("发布", "\uE768");
            publish.Click += async (_, _) => await RunPageAsync(async () => { await _api.PublishTaskAsync(task.Id); ShowStatus("任务已发布", InfoBarSeverity.Success); await ShowTasksAsync(); });
            actions.Children.Add(publish);
        }
        if (withActions)
        {
            var submissions = StandardButton($"成果 {task.SubmissionCount}", "\uE8F1");
            submissions.Click += async (_, _) => await RunPageAsync(async () => await ShowSubmissionListAsync(task));
            actions.Children.Add(submissions);
        }
        return RowCard(task.Title, $"{task.ClassName ?? task.GroupName ?? "未指定"} · {task.Description}", actions);
    }

    private async Task CreateTaskDialogAsync()
    {
        if (_bootstrap is null) return;
        var targets = _bootstrap.TeacherAssignments.GroupBy(item => item.ClassId).Select(group => new TargetOption(group.Key, group.First().ClassName, true, group.First().SubjectName))
            .Concat(_bootstrap.Groups.Select(group => new TargetOption(group.Id, group.Name, false, ""))).ToArray();
        if (!targets.Any()) { ShowStatus("请先由管理员分配班级，或创建学习小组。", InfoBarSeverity.Warning); return; }
        var title = new TextBox { Header = "任务标题", PlaceholderText = "例如：二次函数阶段练习" };
        var description = new TextBox { Header = "说明", AcceptsReturn = true, Height = 90, TextWrapping = TextWrapping.Wrap };
        var target = new ComboBox { Header = "发布对象", ItemsSource = targets, DisplayMemberPath = "Name", SelectedIndex = 0 };
        var kind = new ComboBox { Header = "类型", ItemsSource = new[] { "学习目标", "练习", "测评" }, SelectedIndex = 1 };
        var requirement = new ComboBox { Header = "要求", ItemsSource = new[] { "必做", "选做" }, SelectedIndex = 0 };
        var due = new CalendarDatePicker { Header = "截止日期（可选）", PlaceholderText = "不设置截止日期" };
        var content = new StackPanel { Spacing = 12 };
        foreach (var control in new Control[] { title, description, target, kind, requirement, due }) content.Children.Add(control);
        var dialog = Dialog("新建教学任务", content, "保存草稿");
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        if (string.IsNullOrWhiteSpace(title.Text)) { ShowStatus("任务标题不能为空", InfoBarSeverity.Warning); return; }
        var selected = (TargetOption)target.SelectedItem;
        var payload = new
        {
            classId = selected.IsClass ? selected.Id : null,
            groupId = selected.IsClass ? null : selected.Id,
            title = title.Text.Trim(),
            description = description.Text.Trim(),
            resources = Array.Empty<object>(),
            rubric = Array.Empty<object>(),
            taskKind = new[] { "goal", "practice", "assessment" }[kind.SelectedIndex],
            requirement = requirement.SelectedIndex == 0 ? "required" : "optional",
            subjectName = selected.Subject,
            dueAt = due.Date?.DateTime.ToUniversalTime().ToString("O")
        };
        await RunPageAsync(async () => { await _api.CreateTaskAsync(payload); ShowStatus("任务草稿已创建", InfoBarSeverity.Success); await ShowTasksAsync(); });
    }

    private async Task ShowSubmissionsAsync()
    {
        _tasks = await _api.TasksAsync();
        var page = PagePanel("成果与批改", "查看学生成果包并给出分数与反馈");
        if (!_tasks.Any())
        {
            page.Children.Add(EmptyState("暂无任务", "创建并发布任务后，学生成果会出现在这里。"));
            Workspace.Content = Scroll(page);
            return;
        }
        var picker = new ComboBox { Header = "选择任务", Width = 520, ItemsSource = _tasks, DisplayMemberPath = "Title", SelectedIndex = 0 };
        var content = new StackPanel { Spacing = 10 };
        picker.SelectionChanged += async (_, _) => await RunPageAsync(async () => await PopulateSubmissionsAsync((LearningTask)picker.SelectedItem, content));
        page.Children.Add(picker);
        page.Children.Add(content);
        Workspace.Content = Scroll(page);
        await PopulateSubmissionsAsync(_tasks[0], content);
    }

    private async Task ShowSubmissionListAsync(LearningTask task)
    {
        var page = PagePanel(task.Title, "学生成果包与教师评价");
        var back = StandardButton("返回教学任务", "\uE72B");
        back.Click += async (_, _) => await RunPageAsync(ShowTasksAsync);
        page.Children.Add(back);
        var content = new StackPanel { Spacing = 10 };
        page.Children.Add(content);
        Workspace.Content = Scroll(page);
        await PopulateSubmissionsAsync(task, content);
    }

    private async Task PopulateSubmissionsAsync(LearningTask task, StackPanel content)
    {
        content.Children.Clear();
        var submissions = await _api.SubmissionsAsync(task.Id);
        foreach (var submission in submissions)
        {
            var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            actions.Children.Add(Badge(StatusLabel(submission.Status)));
            var grade = AccentButton("批改", "\uE70F");
            grade.Click += async (_, _) => await GradeDialogAsync(task, submission, content);
            actions.Children.Add(grade);
            content.Children.Add(RowCard(submission.Username, string.IsNullOrWhiteSpace(submission.Summary) ? "学生未填写文字总结" : submission.Summary, actions));
        }
        if (!submissions.Any()) content.Children.Add(EmptyState("暂无学生提交", "学生提交成果包后会显示在这里。"));
    }

    private async Task GradeDialogAsync(LearningTask task, Submission submission, StackPanel list)
    {
        var score = new NumberBox { Header = "分数（0–100，可留空）", Minimum = 0, Maximum = 100, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact };
        var feedback = new TextBox { Header = "教师反馈", AcceptsReturn = true, Height = 150, TextWrapping = TextWrapping.Wrap };
        var panel = new StackPanel { Spacing = 12 };
        panel.Children.Add(new TextBlock { Text = submission.Summary, TextWrapping = TextWrapping.Wrap, Foreground = Brush("#FF475569") });
        var aiResult = new TextBlock { TextWrapping = TextWrapping.Wrap, Foreground = Brush("#FF64748B"), FontSize = 13, Visibility = Visibility.Collapsed };
        var aiButton = StandardButton("获取 AI 评分建议", "\uE945");
        aiButton.Click += async (_, _) =>
        {
            aiButton.IsEnabled = false;
            try
            {
                aiResult.Text = await _api.AiSuggestionAsync(submission.Id);
                aiResult.Visibility = Visibility.Visible;
            }
            catch (Exception error) { ShowStatus(error.Message, InfoBarSeverity.Error); }
            finally { aiButton.IsEnabled = true; }
        };
        panel.Children.Add(score);
        panel.Children.Add(feedback);
        panel.Children.Add(aiButton);
        panel.Children.Add(aiResult);
        var dialog = Dialog($"批改 · {submission.Username}", panel, "提交评价");
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        await RunPageAsync(async () =>
        {
            await _api.GradeAsync(submission.Id, double.IsNaN(score.Value) ? null : score.Value, feedback.Text.Trim());
            ShowStatus("评价已提交", InfoBarSeverity.Success);
            await PopulateSubmissionsAsync(task, list);
        });
    }

    private async Task ShowGroupsAsync()
    {
        _bootstrap = await _api.BootstrapAsync();
        var page = PagePanel("学习小组", "创建、加入和管理跨班学习协作空间");
        var commands = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        var create = AccentButton("创建小组", "\uE710");
        create.Click += async (_, _) => await CreateGroupDialogAsync();
        var join = StandardButton("加入小组", "\uE8FA");
        join.Click += async (_, _) => await JoinGroupDialogAsync();
        commands.Children.Add(create);
        commands.Children.Add(join);
        page.Children.Add(commands);
        foreach (var group in _bootstrap.Groups)
        {
            var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var members = StandardButton("成员", "\uE716");
            members.Click += async (_, _) => await RunPageAsync(async () => await ShowGroupMembersAsync(group));
            var messages = StandardButton("小组消息", "\uE8BD");
            messages.Click += async (_, _) => await RunPageAsync(async () => await ShowGroupConversationAsync(group));
            actions.Children.Add(Badge(group.MemberRole == "owner" ? "创建者" : "成员"));
            actions.Children.Add(members);
            actions.Children.Add(messages);
            if (group.MemberRole == "owner")
            {
                var rotate = StandardButton("更换邀请码", "\uE72C");
                rotate.Click += async (_, _) => await RotateGroupInviteAsync(group);
                var delete = StandardButton("删除小组", "\uE74D");
                delete.Click += async (_, _) => await DeleteGroupAsync(group);
                actions.Children.Add(rotate);
                actions.Children.Add(delete);
            }
            page.Children.Add(RowCard(group.Name, group.Description, actions));
        }
        if (!_bootstrap.Groups.Any()) page.Children.Add(EmptyState("尚未加入学习小组", "创建小组或输入其他成员分享的邀请码。"));
        Workspace.Content = Scroll(page);
    }

    private async Task CreateGroupDialogAsync()
    {
        var name = new TextBox { Header = "小组名称" };
        var description = new TextBox { Header = "小组说明", AcceptsReturn = true, Height = 100 };
        var panel = new StackPanel { Spacing = 12 }; panel.Children.Add(name); panel.Children.Add(description);
        if (await Dialog("创建学习小组", panel, "创建").ShowAsync() != ContentDialogResult.Primary) return;
        await RunPageAsync(async () =>
        {
            var created = await _api.CreateGroupAsync(name.Text.Trim(), description.Text.Trim());
            await ShowTextDialogAsync("小组创建成功", $"邀请码：{created.Code}\n请安全地分享给需要加入的成员。", "知道了");
            await ShowGroupsAsync();
        });
    }

    private async Task JoinGroupDialogAsync()
    {
        var code = new TextBox { Header = "小组邀请码", PlaceholderText = "输入小组创建者提供的邀请码" };
        if (await Dialog("加入学习小组", code, "加入").ShowAsync() != ContentDialogResult.Primary) return;
        await RunPageAsync(async () => { await _api.JoinGroupAsync(code.Text.Trim()); ShowStatus("已加入学习小组", InfoBarSeverity.Success); await ShowGroupsAsync(); });
    }

    private async Task ShowGroupMembersAsync(GroupSummary group)
    {
        var page = PagePanel(group.Name, "学习小组成员管理");
        var back = StandardButton("返回小组", "\uE72B"); back.Click += async (_, _) => await RunPageAsync(ShowGroupsAsync); page.Children.Add(back);
        var members = await _api.GroupMembersAsync(group.Id);
        foreach (var member in members)
        {
            var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            actions.Children.Add(Badge(member.MemberRole == "owner" ? "创建者" : member.Role == "teacher" ? "教师" : "学生"));
            if (group.MemberRole == "owner" && member.MemberRole != "owner")
            {
                var remove = StandardButton("移出", "\uE74D");
                remove.Click += async (_, _) => await RunPageAsync(async () => { await _api.RemoveGroupMemberAsync(group.Id, member.Id); await ShowGroupMembersAsync(group); });
                actions.Children.Add(remove);
            }
            page.Children.Add(RowCard(member.DisplayName, member.Username, actions));
        }
        Workspace.Content = Scroll(page);
    }

    private async Task RotateGroupInviteAsync(GroupSummary group)
    {
        await RunPageAsync(async () =>
        {
            var invite = await _api.RotateInviteAsync(group.Id);
            await ShowTextDialogAsync("新邀请码", invite.Code, "关闭");
        });
    }

    private async Task DeleteGroupAsync(GroupSummary group)
    {
        var confirm = new ContentDialog { XamlRoot = RootGrid.XamlRoot, Title = $"删除“{group.Name}”？", Content = "小组将停止使用，现有邀请码也会立即失效。", PrimaryButtonText = "删除", CloseButtonText = "取消", DefaultButton = ContentDialogButton.Close };
        if (await confirm.ShowAsync() != ContentDialogResult.Primary) return;
        await RunPageAsync(async () => { await _api.DeleteGroupAsync(group.Id); ShowStatus("学习小组已删除", InfoBarSeverity.Success); await ShowGroupsAsync(); });
    }

    private async Task ShowMessagesAsync()
    {
        _bootstrap ??= await _api.BootstrapAsync();
        var page = PagePanel("消息", "教师与学生一对一沟通，或进入学习小组讨论");
        var tabs = new TabView();
        var direct = new TabViewItem { Header = "学生私聊", IconSource = new SymbolIconSource { Symbol = Symbol.Contact } };
        var groups = new TabViewItem { Header = "小组消息", IconSource = new SymbolIconSource { Symbol = Symbol.Message } };
        tabs.TabItems.Add(direct); tabs.TabItems.Add(groups);
        direct.Content = await BuildDirectMessagesPanelAsync();
        groups.Content = BuildGroupChooserPanel();
        page.Children.Add(tabs);
        Workspace.Content = page;
    }

    private async Task<UIElement> BuildDirectMessagesPanelAsync()
    {
        var panel = new StackPanel { Spacing = 12, Padding = new Thickness(0, 16, 0, 0) };
        var students = new List<Student>();
        foreach (var assignment in (_bootstrap?.TeacherAssignments ?? []).GroupBy(item => item.ClassId).Select(group => group.First()))
            students.AddRange(await _api.StudentsAsync(assignment.ClassId));
        var unique = students.GroupBy(item => item.Id).Select(group => group.First()).ToArray();
        if (!unique.Any()) { panel.Children.Add(EmptyState("暂无可联系学生", "班级有学生后即可进行一对一沟通。")); return panel; }
        var picker = new ComboBox { Header = "选择学生", Width = 360, ItemsSource = unique, DisplayMemberPath = "Username", SelectedIndex = 0 };
        var conversation = new StackPanel { Spacing = 8 };
        var composer = MessageComposer(async (text, attachment) =>
        {
            var student = (Student)picker.SelectedItem;
            await _api.SendDirectAsync(student.Id, text, attachment is null ? [] : [attachment.Id]);
            await PopulateConversationAsync(conversation, await _api.DirectMessagesAsync(student.Id), student.Id, false);
        });
        async Task LoadAsync() { var student = (Student)picker.SelectedItem; await PopulateConversationAsync(conversation, await _api.DirectMessagesAsync(student.Id), student.Id, false); }
        picker.SelectionChanged += async (_, _) => await RunPageAsync(LoadAsync);
        panel.Children.Add(picker); panel.Children.Add(conversation); panel.Children.Add(composer);
        await LoadAsync();
        return panel;
    }

    private UIElement BuildGroupChooserPanel()
    {
        var panel = new StackPanel { Spacing = 10, Padding = new Thickness(0, 16, 0, 0) };
        foreach (var group in _bootstrap?.Groups ?? [])
        {
            var open = AccentButton("打开对话", "\uE8BD");
            open.Click += async (_, _) => await RunPageAsync(async () => await ShowGroupConversationAsync(group));
            panel.Children.Add(RowCard(group.Name, group.Description, open));
        }
        if (!(_bootstrap?.Groups.Any() ?? false)) panel.Children.Add(EmptyState("暂无学习小组", "进入“学习小组”创建或加入小组。"));
        return panel;
    }

    private async Task ShowGroupConversationAsync(GroupSummary group)
    {
        var page = PagePanel(group.Name, "加密小组消息与附件");
        var back = StandardButton("返回消息", "\uE72B"); back.Click += async (_, _) => await RunPageAsync(ShowMessagesAsync); page.Children.Add(back);
        var conversation = new StackPanel { Spacing = 8 };
        page.Children.Add(conversation);
        page.Children.Add(MessageComposer(async (text, attachment) =>
        {
            await _api.SendGroupAsync(group.Id, text, attachment is null ? [] : [attachment.Id]);
            await PopulateConversationAsync(conversation, await _api.GroupMessagesAsync(group.Id), "", true);
        }));
        Workspace.Content = Scroll(page);
        await PopulateConversationAsync(conversation, await _api.GroupMessagesAsync(group.Id), "", true);
    }

    private UIElement MessageComposer(Func<string, Attachment?, Task> send)
    {
        var text = new TextBox { PlaceholderText = "输入消息…", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 72 };
        var attachmentStatus = new TextBlock { Foreground = Brush("#FF64748B") };
        var commands = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var attach = StandardButton("添加附件", "\uE723");
        attach.Click += async (_, _) =>
        {
            try
            {
                _pendingAttachment = await PickAndUploadAsync();
                attachmentStatus.Text = _pendingAttachment is null ? "" : $"待发送：{_pendingAttachment.FileName}";
            }
            catch (Exception error) { ShowStatus(error.Message, InfoBarSeverity.Error); }
        };
        var sendButton = AccentButton("发送", "\uE724");
        sendButton.Click += async (_, _) => await RunPageAsync(async () =>
        {
            if (string.IsNullOrWhiteSpace(text.Text) && _pendingAttachment is null) return;
            await send(text.Text.Trim(), _pendingAttachment);
            text.Text = ""; _pendingAttachment = null; attachmentStatus.Text = "";
        });
        commands.Children.Add(attach); commands.Children.Add(sendButton);
        var panel = new StackPanel { Spacing = 8, Margin = new Thickness(0, 12, 0, 0) };
        panel.Children.Add(text); panel.Children.Add(attachmentStatus); panel.Children.Add(commands);
        return panel;
    }

    private async Task PopulateConversationAsync(StackPanel panel, ChatMessage[] messages, string otherId, bool group)
    {
        panel.Children.Clear();
        var selfId = _bootstrap?.Account.Id;
        foreach (var message in messages)
        {
            var self = message.SenderId == selfId;
            var body = new StackPanel { Spacing = 6, MaxWidth = 700, HorizontalAlignment = self ? HorizontalAlignment.Right : HorizontalAlignment.Left };
            body.Children.Add(new TextBlock { Text = group ? (self ? "我" : $"成员 {message.SenderId[..Math.Min(8, message.SenderId.Length)]}") : (self ? "我" : "学生"), FontSize = 12, Foreground = Brush("#FF64748B") });
            if (!string.IsNullOrWhiteSpace(message.Text)) body.Children.Add(new TextBlock { Text = message.Text, TextWrapping = TextWrapping.Wrap, FontSize = 15 });
            foreach (var attachment in message.AttachmentDetails ?? [])
            {
                var download = StandardButton($"{attachment.FileName} · {FormatBytes(attachment.SizeBytes)}", "\uE896");
                download.Click += async (_, _) => await DownloadAttachmentAsync(attachment);
                body.Children.Add(download);
            }
            if (self && !group)
            {
                var delete = new HyperlinkButton { Content = "删除消息", FontSize = 12, Padding = new Thickness(0) };
                delete.Click += async (_, _) => await RunPageAsync(async () => { await _api.DeleteMessageAsync(message.Id); await PopulateConversationAsync(panel, await _api.DirectMessagesAsync(otherId), otherId, false); });
                body.Children.Add(delete);
            }
            panel.Children.Add(new Border { Background = Brush(self ? "#FFDCE8FF" : "#FFFFFFFF"), CornerRadius = new CornerRadius(14), Padding = new Thickness(14), Child = body, HorizontalAlignment = self ? HorizontalAlignment.Right : HorizontalAlignment.Left, MaxWidth = 760 });
        }
        if (!messages.Any()) panel.Children.Add(EmptyState("暂无消息", "发送第一条消息开始对话。"));
    }

    private async Task<Attachment?> PickAndUploadAsync()
    {
        var picker = new FileOpenPicker();
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
        picker.FileTypeFilter.Add("*");
        var file = await picker.PickSingleFileAsync();
        if (file is null) return null;
        using var stream = await file.OpenStreamForReadAsync();
        if (stream.Length > 16 * 1024 * 1024) throw new ApiException("单个附件不能超过 16MB");
        using var memory = new MemoryStream(); await stream.CopyToAsync(memory);
        return await _api.UploadAsync(file.Name, file.ContentType ?? "application/octet-stream", memory.ToArray());
    }

    private async Task DownloadAttachmentAsync(Attachment attachment)
    {
        await RunPageAsync(async () =>
        {
            var bytes = await _api.DownloadAsync(attachment.Id);
            var folder = await StorageFolder.GetFolderFromPathAsync(Path.GetTempPath());
            var file = await folder.CreateFileAsync(attachment.FileName, CreationCollisionOption.GenerateUniqueName);
            await FileIO.WriteBytesAsync(file, bytes);
            await Launcher.LaunchFileAsync(file);
        });
    }

    private async Task ShowNotificationsAsync()
    {
        var notifications = await _api.NotificationsAsync();
        var page = PagePanel("通知", "任务发布、学生提交、教师评价和消息提醒");
        foreach (var notification in notifications)
        {
            var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            actions.Children.Add(Badge(notification.ReadAt is null ? "未读" : "已读"));
            if (notification.ReadAt is null)
            {
                var read = StandardButton("标为已读", "\uE73E");
                read.Click += async (_, _) => await RunPageAsync(async () => { await _api.MarkNotificationReadAsync(notification.Id); await ShowNotificationsAsync(); });
                actions.Children.Add(read);
            }
            page.Children.Add(RowCard(notification.Title, notification.Body, actions));
        }
        if (!notifications.Any()) page.Children.Add(EmptyState("暂无通知", "新的教学动态会显示在这里。"));
        Workspace.Content = Scroll(page);
    }

    private void ShowSettings()
    {
        var page = PagePanel("设置", "服务器连接、账号和本机数据");
        var server = new TextBox { Header = "BinGO 服务器地址", Text = _session.ServerUrl, Width = 520, HorizontalAlignment = HorizontalAlignment.Left };
        var save = AccentButton("保存服务器地址", "\uE74E");
        save.Click += (_, _) =>
        {
            if (!Uri.TryCreate(server.Text.Trim(), UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            {
                ShowStatus("服务器地址必须是有效的 HTTPS 地址", InfoBarSeverity.Warning); return;
            }
            _session.ServerUrl = server.Text.TrimEnd('/'); _session.Save(); ShowStatus("服务器地址已保存，重新登录后生效", InfoBarSeverity.Success);
        };
        var logout = StandardButton("退出登录", "\uE8AC");
        logout.Click += (_, _) =>
        {
            _api.Logout(); _bootstrap = null; _tasks = []; Navigation.Visibility = Visibility.Collapsed; LoginView.Visibility = Visibility.Visible; LoginStatus.Text = "已安全退出登录。";
        };
        page.Children.Add(new Border { Background = Brush("#FFFFFFFF"), CornerRadius = new CornerRadius(16), Padding = new Thickness(22), Child = new StackPanel { Spacing = 12, Children = { server, save } } });
        page.Children.Add(new Border { Background = Brush("#FFFFFFFF"), CornerRadius = new CornerRadius(16), Padding = new Thickness(22), Child = new StackPanel { Spacing = 10, Children = { new TextBlock { Text = $"当前账号：{_bootstrap?.Account.DisplayName}", FontSize = 18, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold }, new TextBlock { Text = "刷新令牌使用 Windows DPAPI 按当前用户加密，仅本机当前 Windows 账号可解密。", TextWrapping = TextWrapping.Wrap, Foreground = Brush("#FF64748B") }, logout } } });
        Workspace.Content = Scroll(page);
    }

    private StackPanel PagePanel(string title, string subtitle)
    {
        var panel = new StackPanel { Spacing = 20, Padding = new Thickness(32, 28, 32, 40), MaxWidth = 1220, HorizontalAlignment = HorizontalAlignment.Stretch };
        panel.Children.Add(new StackPanel { Spacing = 4, Children = { new TextBlock { Text = title, FontSize = 30, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold }, new TextBlock { Text = subtitle, FontSize = 15, Foreground = Brush("#FF64748B") } } });
        return panel;
    }

    private static ScrollViewer Scroll(UIElement content) => new() { Content = content, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
    private static TextBlock SectionTitle(string text) => new() { Text = text, FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Margin = new Thickness(0, 8, 0, 0) };

    private static void AddMetric(Grid grid, int column, string title, string value, string hint)
    {
        var card = new Border { Background = Brush("#FFFFFFFF"), CornerRadius = new CornerRadius(16), Padding = new Thickness(20), Child = new StackPanel { Spacing = 8, Children = { new TextBlock { Text = title, Foreground = Brush("#FF64748B") }, new TextBlock { Text = value, FontSize = 32, FontWeight = Microsoft.UI.Text.FontWeights.Bold }, new TextBlock { Text = hint, FontSize = 12, Foreground = Brush("#FF94A3B8") } } } };
        Grid.SetColumn(card, column); grid.Children.Add(card);
    }

    private static Border RowCard(string title, string subtitle, UIElement actions) => new Border
    {
        Background = Brush("#FFFFFFFF"), CornerRadius = new CornerRadius(15), Padding = new Thickness(18),
        Child = new Grid
        {
            ColumnDefinitions = { new ColumnDefinition(), new ColumnDefinition { Width = GridLength.Auto } },
            Children =
            {
                new StackPanel { Spacing = 5, Children = { new TextBlock { Text = title, FontSize = 17, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold }, new TextBlock { Text = subtitle, TextWrapping = TextWrapping.Wrap, Foreground = Brush("#FF64748B"), MaxWidth = 720 } } },
                actions
            }
        }
    }.Tap(border => Grid.SetColumn((FrameworkElement)((Grid)border.Child).Children[1], 1));

    private static Border EmptyState(string title, string description) => new() { Background = Brush("#FFFFFFFF"), CornerRadius = new CornerRadius(16), Padding = new Thickness(34), Child = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, Spacing = 8, Children = { new FontIcon { Glyph = "\uE946", FontSize = 32, Foreground = Brush("#FF94A3B8") }, new TextBlock { Text = title, FontSize = 18, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center }, new TextBlock { Text = description, Foreground = Brush("#FF64748B"), TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center } } } };
    private static Border Badge(string text) => new() { Background = Brush("#FFE9F0FF"), CornerRadius = new CornerRadius(999), Padding = new Thickness(10, 5, 10, 5), Child = new TextBlock { Text = text, FontSize = 12, Foreground = Brush("#FF234EAA") }, VerticalAlignment = VerticalAlignment.Center };
    private static Button AccentButton(string text, string glyph) => Button(text, glyph, true);
    private static Button StandardButton(string text, string glyph) => Button(text, glyph, false);
    private static Button Button(string text, string glyph, bool accent)
    {
        var button = new Button { Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7, Children = { new FontIcon { Glyph = glyph, FontSize = 14 }, new TextBlock { Text = text } } }, VerticalAlignment = VerticalAlignment.Center };
        if (accent) button.Style = (Style)Application.Current.Resources["AccentButtonStyle"];
        return button;
    }

    private ContentDialog Dialog(string title, object content, string primary) => new() { XamlRoot = RootGrid.XamlRoot, Title = title, Content = content, PrimaryButtonText = primary, CloseButtonText = "取消", DefaultButton = ContentDialogButton.Primary };
    private async Task ShowTextDialogAsync(string title, string text, string close) => await new ContentDialog { XamlRoot = RootGrid.XamlRoot, Title = title, Content = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true }, CloseButtonText = close }.ShowAsync();

    private void SetBusy(bool active) { BusyRing.IsActive = active; BusyRing.Visibility = active ? Visibility.Visible : Visibility.Collapsed; }
    private void ShowStatus(string message, InfoBarSeverity severity) { StatusBar.Message = message; StatusBar.Severity = severity; StatusBar.IsOpen = true; }
    private static SolidColorBrush Brush(string hex) => new(ColorHelper.FromArgb(Convert.ToByte(hex[1..3], 16), Convert.ToByte(hex[3..5], 16), Convert.ToByte(hex[5..7], 16), Convert.ToByte(hex[7..9], 16)));
    private static string TaskKindLabel(string? kind) => kind switch { "goal" => "学习目标", "assessment" => "测评", _ => "练习" };
    private static string StatusLabel(string status) => status switch { "draft" => "草稿", "published" => "已发布", "submitted" => "已提交", "graded" => "已批改", "closed" => "已关闭", _ => status };
    private static string FormatBytes(long bytes) => bytes >= 1024 * 1024 ? $"{bytes / 1024d / 1024d:F1} MB" : $"{Math.Max(1, bytes / 1024d):F0} KB";

    private sealed record TargetOption(string Id, string Name, bool IsClass, string Subject);
}

internal static class UIElementExtensions
{
    public static T Tap<T>(this T value, Action<T> action) { action(value); return value; }
}
