Set shell = CreateObject("Shell.Application")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript = fso.BuildPath(scriptDir, "install-wsl-rocm-admin.ps1")
args = "-NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & psScript & Chr(34)
shell.ShellExecute "powershell.exe", args, scriptDir, "runas", 1
