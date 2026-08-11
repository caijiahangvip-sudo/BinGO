using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BinGOTeacher.Models;

namespace BinGOTeacher.Services;

public sealed class ApiException(string message, HttpStatusCode statusCode = 0) : Exception(message)
{
    public HttpStatusCode StatusCode { get; } = statusCode;
}

public sealed class TeacherApiClient
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(45) };
    private readonly SessionStore _store;
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true };
    private string? _accessToken;

    public TeacherApiClient(SessionStore store) => _store = store;

    public async Task<AuthSession> LoginAsync(string username, string password) => await AuthenticateAsync("/v1/auth/login", new
    {
        identifier = username,
        password,
        deviceName = Environment.MachineName,
        platform = "teacher-windows"
    });

    public async Task<AuthSession> RegisterAsync(string inviteCode, string username, string password) => await AuthenticateAsync("/v1/auth/register-teacher", new
    {
        inviteCode,
        username,
        password,
        deviceName = Environment.MachineName,
        platform = "teacher-windows"
    });

    private async Task<AuthSession> AuthenticateAsync(string path, object body)
    {
        var session = await SendAsync<AuthSession>(HttpMethod.Post, path, body, false, false);
        AcceptSession(session);
        return session;
    }

    public async Task<bool> RestoreAsync()
    {
        if (string.IsNullOrWhiteSpace(_store.RefreshToken)) return false;
        try
        {
            var session = await SendAsync<AuthSession>(HttpMethod.Post, "/v1/auth/refresh", new { refreshToken = _store.RefreshToken }, false, false);
            AcceptSession(session);
            return session.Account.Role == "teacher";
        }
        catch
        {
            _store.ClearSession();
            return false;
        }
    }

    private void AcceptSession(AuthSession session)
    {
        if (session.Account.Role != "teacher") throw new ApiException("该账号不是教师账号");
        _accessToken = session.AccessToken;
        if (!string.IsNullOrWhiteSpace(session.RefreshToken)) _store.RefreshToken = session.RefreshToken;
        _store.Save();
    }

    public void Logout()
    {
        _accessToken = null;
        _store.ClearSession();
    }

    public Task<Bootstrap> BootstrapAsync() => SendAsync<Bootstrap>(HttpMethod.Get, "/v1/teaching/bootstrap");
    public async Task<LearningTask[]> TasksAsync() => (await SendAsync<TasksResponse>(HttpMethod.Get, "/v1/tasks")).Tasks;
    public async Task<Student[]> StudentsAsync(string classId) => (await SendAsync<StudentsResponse>(HttpMethod.Get, $"/v1/teacher/classes/{classId}/students")).Students;
    public async Task<Submission[]> SubmissionsAsync(string taskId) => (await SendAsync<SubmissionsResponse>(HttpMethod.Get, $"/v1/teacher/tasks/{taskId}/submissions")).Submissions;
    public async Task<GroupMember[]> GroupMembersAsync(string groupId) => (await SendAsync<MembersResponse>(HttpMethod.Get, $"/v1/groups/{groupId}/members")).Members;
    public async Task<ChatMessage[]> DirectMessagesAsync(string accountId) => (await SendAsync<MessagesResponse>(HttpMethod.Get, $"/v1/messages/direct/{accountId}")).Messages;
    public async Task<ChatMessage[]> GroupMessagesAsync(string groupId) => (await SendAsync<MessagesResponse>(HttpMethod.Get, $"/v1/groups/{groupId}/messages")).Messages;
    public async Task<TeacherNotification[]> NotificationsAsync() => (await SendAsync<NotificationsResponse>(HttpMethod.Get, "/v1/notifications")).Notifications;

    public Task CreateTaskAsync(object payload) => SendEmptyAsync(HttpMethod.Post, "/v1/teacher/tasks", payload);
    public Task PublishTaskAsync(string taskId) => SendEmptyAsync(HttpMethod.Post, $"/v1/teacher/tasks/{taskId}/publish", new { });
    public Task GradeAsync(string submissionId, double? score, string feedback) => SendEmptyAsync(HttpMethod.Post, $"/v1/teacher/submissions/{submissionId}/grade", new { score, rubric = Array.Empty<object>(), feedback });

    public async Task<string> AiSuggestionAsync(string submissionId)
    {
        try
        {
            var result = await SendAsync<AiSuggestionResponse>(HttpMethod.Post, $"/v1/teacher/submissions/{submissionId}/ai-suggestion", new { });
            return result.Suggestion ?? "服务器未返回评分建议内容";
        }
        catch (ApiException error) when (error.StatusCode == HttpStatusCode.NotImplemented)
        {
            return error.Message;
        }
    }
    public Task<GroupCreated> CreateGroupAsync(string name, string description) => SendAsync<GroupCreated>(HttpMethod.Post, "/v1/groups", new { name, description });
    public Task JoinGroupAsync(string inviteCode) => SendEmptyAsync(HttpMethod.Post, "/v1/groups/join", new { inviteCode });
    public Task<InviteRotated> RotateInviteAsync(string groupId) => SendAsync<InviteRotated>(HttpMethod.Post, $"/v1/groups/{groupId}/invite/rotate", new { });
    public Task RemoveGroupMemberAsync(string groupId, string accountId) => SendEmptyAsync(HttpMethod.Delete, $"/v1/groups/{groupId}/members/{accountId}");
    public Task DeleteGroupAsync(string groupId) => SendEmptyAsync(HttpMethod.Delete, $"/v1/groups/{groupId}");
    public Task SendDirectAsync(string recipientId, string text, string[] attachments) => SendEmptyAsync(HttpMethod.Post, "/v1/messages/direct", new { recipientId, text, attachments });
    public Task SendGroupAsync(string groupId, string text, string[] attachments) => SendEmptyAsync(HttpMethod.Post, $"/v1/groups/{groupId}/messages", new { text, attachments });
    public Task DeleteMessageAsync(string messageId) => SendEmptyAsync(HttpMethod.Delete, $"/v1/messages/{messageId}");
    public Task MarkNotificationReadAsync(string notificationId) => SendEmptyAsync(HttpMethod.Post, $"/v1/notifications/{notificationId}/read", new { });

    public Task<Attachment> UploadAsync(string fileName, string mimeType, byte[] bytes) => SendAsync<Attachment>(HttpMethod.Post, "/v1/objects", new
    {
        fileName,
        mimeType,
        dataBase64 = Convert.ToBase64String(bytes)
    });

    public async Task<byte[]> DownloadAsync(string objectId)
    {
        var response = await SendRawAsync(HttpMethod.Get, $"/v1/objects/{objectId}", null, true);
        return await response.Content.ReadAsByteArrayAsync();
    }

    private async Task SendEmptyAsync(HttpMethod method, string path, object? body = null) => await SendRawAsync(method, path, body, true);

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body = null, bool authenticated = true, bool retry = true)
    {
        var response = await SendRawAsync(method, path, body, authenticated, retry);
        if (response.Content.Headers.ContentLength == 0) return Activator.CreateInstance<T>();
        return await response.Content.ReadFromJsonAsync<T>(_json) ?? throw new ApiException("服务器返回了空数据", response.StatusCode);
    }

    private async Task<HttpResponseMessage> SendRawAsync(HttpMethod method, string path, object? body, bool authenticated, bool retry = true)
    {
        using var request = new HttpRequestMessage(method, new Uri(new Uri(_store.ServerUrl.TrimEnd('/') + "/"), path.TrimStart('/')));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (authenticated && !string.IsNullOrWhiteSpace(_accessToken)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _accessToken);
        if (body is not null) request.Content = new StringContent(JsonSerializer.Serialize(body, _json), Encoding.UTF8, "application/json");
        HttpResponseMessage response;
        try { response = await _http.SendAsync(request); }
        catch (TaskCanceledException) { throw new ApiException("连接服务器超时，请检查网络或服务器地址"); }
        catch (HttpRequestException error) { throw new ApiException($"无法连接 BinGO 服务器：{error.Message}"); }

        if (response.StatusCode == HttpStatusCode.Unauthorized && authenticated && retry && await RestoreAsync())
        {
            response.Dispose();
            return await SendRawAsync(method, path, body, authenticated, false);
        }
        if (!response.IsSuccessStatusCode)
        {
            var text = await response.Content.ReadAsStringAsync();
            var error = string.IsNullOrWhiteSpace(text) ? null : JsonSerializer.Deserialize<ErrorResponse>(text, _json);
            var message = error?.Error ?? error?.Message ?? $"服务器请求失败（{(int)response.StatusCode}）";
            response.Dispose();
            throw new ApiException(message, response.StatusCode);
        }
        return response;
    }
}
