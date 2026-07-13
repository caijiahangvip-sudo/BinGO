@echo off
setlocal

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul 2>nul
if not errorlevel 1 set "ROOT=%CD%"

echo Windows-native CosyVoice startup is disabled. Use scripts\cosyvoice-local-server.ps1 for WSL ROCm.>>"%ROOT%\bingo-cosyvoice.err.log"
exit /b 1
