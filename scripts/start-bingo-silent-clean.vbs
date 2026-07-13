Option Explicit

Dim shell, fso, scriptDir, rootDir, psScript, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)
psScript = fso.BuildPath(scriptDir, "start-bingo.ps1")

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & psScript & Chr(34) & " -CleanNextCache"

shell.CurrentDirectory = rootDir
shell.Run command, 0, False
WScript.Sleep 2500
shell.Run "http://localhost:4000", 1, False
