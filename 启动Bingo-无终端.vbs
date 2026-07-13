Option Explicit

Dim shell, fso, rootDir, launcher

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = fso.BuildPath(fso.BuildPath(rootDir, "scripts"), "start-bingo-silent.vbs")

shell.CurrentDirectory = rootDir
shell.Run "wscript.exe " & Chr(34) & launcher & Chr(34), 0, False
