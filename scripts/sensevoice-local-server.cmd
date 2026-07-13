@echo off
setlocal

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul 2>nul
if not errorlevel 1 set "ROOT=%CD%"

echo Windows-native SenseVoice startup is disabled. Use scripts\sensevoice-local-server.ps1 for WSL ROCm.>>"%ROOT%\bingo-sensevoice.err.log"
exit /b 1
