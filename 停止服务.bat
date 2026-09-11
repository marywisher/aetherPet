@echo off
title AetherPet 服务停止
cd /d "%~dp0"
echo ============================================
echo   AetherPet 停止服务
echo ============================================
echo.
set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3000 "') do (
  set "FOUND=1"
  echo   终止进程: %%a
  taskkill /F /PID %%a >nul 2>&1
)
echo.
if "%FOUND%"=="1" (
  echo 端口 3000 上的服务已停止.
) else (
  echo 未检测到端口 3000 上运行的服务, 无需停止.
)
pause
