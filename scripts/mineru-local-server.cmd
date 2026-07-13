@echo off
setlocal

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul 2>nul
if not errorlevel 1 set "ROOT=%CD%"

echo Windows-native MinerU startup is disabled. Use scripts\mineru-local-server.ps1 for WSL ROCm.>>"%ROOT%\bingo-mineru.err.log"
exit /b 1
