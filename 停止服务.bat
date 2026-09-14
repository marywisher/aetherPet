@echo off
setlocal enabledelayedexpansion
title AetherPet 服务停止
cd /d "%~dp0"

rem ---- 0. 从 .env 读取运行端口 (PORT, 统一一处管理) ----
set "PORT=3000"
if exist .env for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b "PORT=" .env`) do set "PORT=%%b"

echo ============================================
echo   AetherPet 停止服务
echo ============================================
echo.
set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":!PORT! "') do (
  set "FOUND=1"
  echo   终止进程: %%a
  taskkill /F /PID %%a >nul 2>&1
)
echo.
if "!FOUND!"=="1" (
  echo 端口 !PORT! 上的服务已停止.
) else (
  echo 未检测到端口 !PORT! 运行中的服务, 无需停止.
)
pause
