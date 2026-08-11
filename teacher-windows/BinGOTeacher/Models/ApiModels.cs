using System.Text.Json;
using System.Text.Json.Serialization;

namespace BinGOTeacher.Models;

public sealed record Account(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("username")] string? Username,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("displayName")] string DisplayName);

public sealed record AuthSession(
    [property: JsonPropertyName("accessToken")] string AccessToken,
    [property: JsonPropertyName("refreshToken")] string? RefreshToken,
    [property: JsonPropertyName("account")] Account Account);

public sealed record Assignment(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("classId")] string ClassId,
    [property: JsonPropertyName("className")] string ClassName,
    [property: JsonPropertyName("subjectName")] string SubjectName,
    [property: JsonPropertyName("roleName")] string RoleName,
    [property: JsonPropertyName("capabilities")] string[] Capabilities);

public sealed record GroupSummary(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("description")] string Description,
    [property: JsonPropertyName("memberRole")] string MemberRole);

public sealed record Bootstrap(
    [property: JsonPropertyName("account")] Account Account,
    [property: JsonPropertyName("teacherAssignments")] Assignment[] TeacherAssignments,
    [property: JsonPropertyName("groups")] GroupSummary[] Groups,
    [property: JsonPropertyName("unreadNotifications")] int UnreadNotifications);

public sealed record LearningTask(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("description")] string Description,
    [property: JsonPropertyName("className")] string? ClassName,
    [property: JsonPropertyName("groupName")] string? GroupName,
    [property: JsonPropertyName("task_kind")] string? TaskKindSnake,
    [property: JsonPropertyName("taskKind")] string? TaskKind,
    [property: JsonPropertyName("requirement")] string Requirement,
    [property: JsonPropertyName("due_at")] string? DueAtSnake,
    [property: JsonPropertyName("dueAt")] string? DueAt,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("submissionCount")] int SubmissionCount);

public sealed record Student(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("username")] string Username,
    [property: JsonPropertyName("assignedCount")] int AssignedCount,
    [property: JsonPropertyName("submittedCount")] int SubmittedCount,
    [property: JsonPropertyName("gradedCount")] int GradedCount);

public sealed record Submission(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("username")] string Username,
    [property: JsonPropertyName("summary")] string Summary,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("submitted_at")] string? SubmittedAt,
    [property: JsonPropertyName("teacher_grade")] JsonElement? TeacherGrade,
    [property: JsonPropertyName("evidence")] JsonElement Evidence);

public sealed record GroupMember(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("username")] string Username,
    [property: JsonPropertyName("displayName")] string DisplayName,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("memberRole")] string MemberRole,
    [property: JsonPropertyName("joinedAt")] string JoinedAt);

public sealed record Attachment(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("fileName")] string FileName,
    [property: JsonPropertyName("mimeType")] string MimeType,
    [property: JsonPropertyName("sizeBytes")] long SizeBytes);

public sealed record ChatMessage(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("senderId")] string SenderId,
    [property: JsonPropertyName("text")] string Text,
    [property: JsonPropertyName("attachments")] string[] Attachments,
    [property: JsonPropertyName("attachmentDetails")] Attachment[]? AttachmentDetails,
    [property: JsonPropertyName("createdAt")] string CreatedAt);

public sealed record TeacherNotification(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("body")] string Body,
    [property: JsonPropertyName("createdAt")] string CreatedAt,
    [property: JsonPropertyName("readAt")] string? ReadAt);

public sealed record TasksResponse([property: JsonPropertyName("tasks")] LearningTask[] Tasks);
public sealed record StudentsResponse([property: JsonPropertyName("students")] Student[] Students);
public sealed record SubmissionsResponse([property: JsonPropertyName("submissions")] Submission[] Submissions);
public sealed record MembersResponse([property: JsonPropertyName("members")] GroupMember[] Members);
public sealed record MessagesResponse([property: JsonPropertyName("messages")] ChatMessage[] Messages);
public sealed record NotificationsResponse([property: JsonPropertyName("notifications")] TeacherNotification[] Notifications);
public sealed record GroupCreated([property: JsonPropertyName("id")] string Id, [property: JsonPropertyName("code")] string Code);
public sealed record InviteRotated([property: JsonPropertyName("code")] string Code);
public sealed record ErrorResponse([property: JsonPropertyName("error")] string? Error, [property: JsonPropertyName("message")] string? Message);
public sealed record AiSuggestionResponse([property: JsonPropertyName("status")] string Status, [property: JsonPropertyName("suggestion")] string? Suggestion);
