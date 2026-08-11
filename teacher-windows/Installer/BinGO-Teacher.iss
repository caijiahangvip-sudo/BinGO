#define MyAppName "BinGO 教师端"
#define MyAppVersion "1.0.0"
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
OutputBaseFilename=BinGO-Teacher-Setup-1.0.0
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
