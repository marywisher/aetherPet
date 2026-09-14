@echo off
setlocal enabledelayedexpansion
title AetherPet 服务启动
cd /d "%~dp0"

rem ---- 0. 从 .env 读取运行端口 (PORT, 统一一处管理; 没有则用 3000) ----
set "PORT=3000"
if exist .env for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b "PORT=" .env`) do set "PORT=%%b"

echo ============================================
echo   AetherPet 启动
echo   访问地址: http://localhost:!PORT!
echo   停止服务: 运行 停止服务.bat
echo ============================================
echo.

rem ---- 1. 端口 !PORT! 已被占用 = 服务已在运行 ----
set "RUN=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":!PORT! "') do set "RUN=1"
if "!RUN!"=="1" (
  echo [提示] 端口 !PORT! 已被占用, 服务可能已在运行.
  echo        如果打不开, 可运行 停止服务.bat 先停止.
  pause
  exit /b 0
)

rem ---- 2. 确认数据库 (MySQL 3306) 在线, 未检测到则自动拉起 Docker ----
set "DB=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3306 "') do set "DB=1"
if "!DB!"=="0" (
  echo [信息] 未检测到 3306 端口, 正在启动 Docker 数据库...
  docker compose -f docker\docker-compose.dev.yml up -d mysql
  if errorlevel 1 (
    echo [错误] Docker 数据库启动失败, 请确认 Docker Desktop 已打开.
    pause
    exit /b 1
  )
  echo 等待数据库就绪, 约 5 秒.
  timeout /t 5 /nobreak >nul
)

if not exist logs mkdir logs
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set "DLOG=logs\dev-server-%%a.log"
rem ---- 3. 后台启动 next dev, 日志落盘 (端口由 .env 的 PORT 控制) ----
start "AetherPet Dev" /min cmd /c "npm run dev >> %DLOG% 2>&1"
echo 服务已启动 (最小化窗口 AetherPet Dev 即为运行中).
echo 日志: %DLOG%
echo 访问地址: http://localhost:!PORT!
pause
