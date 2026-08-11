$ErrorActionPreference = 'Stop'
$dotnet = "$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe"
$root = Split-Path -Parent $PSScriptRoot
$publish = "$env:USERPROFILE\Desktop\BinGO-Teacher-1.0.0"
$stage = "$env:LOCALAPPDATA\BinGO\teacher-windows-build"
$iscc = (Get-Command iscc.exe -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
  $iscc = Get-ChildItem "${env:ProgramFiles(x86)}\Inno Setup*\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup*\ISCC.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $iscc) { throw '未找到 Inno Setup 的 ISCC.exe' }
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item "$root\teacher-windows\BinGOTeacher" $stage -Recurse -Force
Push-Location $stage
try {
  & $dotnet publish '.\BinGOTeacher\BinGOTeacher.csproj' -c Release -r win-x64 `
    -p:RuntimeIdentifierOverride=win10-x64 --self-contained true `
    -p:WindowsAppSDKSelfContained=true -o $publish
  if ($LASTEXITCODE -ne 0) { throw "dotnet publish 失败 ($LASTEXITCODE)" }
  Remove-Item "$publish\Microsoft.Web.WebView2.Core.dll",
    "$publish\Microsoft.Web.WebView2.Core.Projection.dll",
    "$publish\WebView2Loader.dll",
    "$publish\Microsoft.UI.Xaml\Assets\map.html" -Force -ErrorAction SilentlyContinue
  & $iscc "$root\teacher-windows\Installer\BinGO-Teacher.iss"
} finally { Pop-Location }
Write-Host "安装包输出：$env:USERPROFILE\Desktop\BinGO-Teacher-Setup-1.0.0.exe"
