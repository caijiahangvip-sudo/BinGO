#define MyAppName "BinGO 教师端"
#define MyAppVersion "1.0.1"
#define MyAppPublisher "BinGO"
#define MyAppExeName "BinGOTeacher.exe"
#define PublishDir GetEnv("USERPROFILE") + "\Desktop\BinGO-Teacher-1.0.0"
#define ReleaseDir GetEnv("USERPROFILE") + "\Desktop"

[Setup]
AppId={{B5B86CB7-90A4-4D5F-9DF2-4F3B8F7EA21C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\BinGO\Teacher
DefaultGroupName=BinGO
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#ReleaseDir}
OutputBaseFilename=BinGO-Teacher-Setup-1.0.1
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesInstallIn64BitMode=x64
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: unchecked

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "Microsoft.Web.WebView2.*,WebView2Loader.dll,*.html"

[Icons]
Name: "{group}\BinGO 教师端"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\BinGO 教师端"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 BinGO 教师端"; Flags: nowait postinstall skipifsilent

[Code]
const
  OldUninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{B5B86CB7-90A4-4D5F-9DF2-4F3B8F7EA21C}_is1';

function GetOldUninstallString(): String;
var
  Value: String;
begin
  Result := '';
  if RegQueryStringValue(HKCU, OldUninstallKey, 'UninstallString', Value) or
     RegQueryStringValue(HKLM, OldUninstallKey, 'UninstallString', Value) then
    Result := Value;
end;

function InitializeSetup(): Boolean;
var
  Uninstaller: String;
  ResultCode: Integer;
begin
  Result := True;
  Uninstaller := GetOldUninstallString();
  if Uninstaller = '' then
    exit;
  if MsgBox('检测到已安装旧版本的 BinGO 教师端。' #13#10
    + '继续安装将自动卸载旧版本（你的账号和设置会保留），然后安装新版本。',
    mbConfirmation, MB_OKCANCEL) = IDCANCEL then
  begin
    Result := False;
    exit;
  end;
  Exec(RemoveQuotes(Uninstaller), '/VERYSILENT /NORESTART /SUPPRESSMSGBOXES',
    '', SW_SHOW, ewWaitUntilTerminated, ResultCode);
end;
