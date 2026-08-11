# BinGO 教师端（Windows 原生版）

此目录是 WinUI 3 + C# 实现的原生 Windows 教师客户端，不使用 WebView、Tauri、HTML、React 或 JavaScript。

## 构建

```powershell
$dotnet="$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe"
& $dotnet restore .\BinGOTeacher\BinGOTeacher.csproj -r win-x64
& $dotnet publish .\BinGOTeacher\BinGOTeacher.csproj -c Release -r win-x64 `
  -p:RuntimeIdentifierOverride=win10-x64 --self-contained true `
  -p:WindowsAppSDKSelfContained=true `
  -o "$env:USERPROFILE\Desktop\BinGO-Teacher-1.0.0"
```

发布目录中生成的 `BinGOTeacher.exe` 是独立的原生 WinUI 3 程序。安装器脚本位于 `Installer/BinGO-Teacher.iss`。
