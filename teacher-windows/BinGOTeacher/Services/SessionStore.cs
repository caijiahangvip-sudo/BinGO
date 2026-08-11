using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BinGOTeacher.Services;

public sealed class SessionStore
{
    private readonly string _folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BinGO", "Teacher");
    private string SettingsPath => Path.Combine(_folder, "settings.json");
    private string TokenPath => Path.Combine(_folder, "session.bin");

    public string ServerUrl { get; set; } = "https://bingo.mido.site";
    public string? RefreshToken { get; set; }

    public void Load()
    {
        Directory.CreateDirectory(_folder);
        if (File.Exists(SettingsPath))
        {
            var settings = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(SettingsPath));
            if (settings?.TryGetValue("serverUrl", out var serverUrl) == true && Uri.TryCreate(serverUrl, UriKind.Absolute, out _))
            {
                ServerUrl = serverUrl.TrimEnd('/');
            }
        }
        if (File.Exists(TokenPath))
        {
            try
            {
                var protectedBytes = File.ReadAllBytes(TokenPath);
                RefreshToken = Encoding.UTF8.GetString(ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser));
            }
            catch
            {
                RefreshToken = null;
            }
        }
    }

    public void Save()
    {
        Directory.CreateDirectory(_folder);
        File.WriteAllText(SettingsPath, JsonSerializer.Serialize(new Dictionary<string, string> { ["serverUrl"] = ServerUrl }));
        if (string.IsNullOrWhiteSpace(RefreshToken))
        {
            if (File.Exists(TokenPath)) File.Delete(TokenPath);
            return;
        }
        var protectedBytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(RefreshToken), null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(TokenPath, protectedBytes);
    }

    public void ClearSession()
    {
        RefreshToken = null;
        if (File.Exists(TokenPath)) File.Delete(TokenPath);
    }
}
