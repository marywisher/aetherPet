@echo off
title AetherPet 服务启动
cd /d "%~dp0"
echo ============================================
echo   AetherPet 启动
echo   访问地址: http://localhost:3000
echo   停止服务: 运行 停止服务.bat
echo ============================================
echo.

rem ---- 1. 端口 3000 已被占用 = 服务已在运行 ----
set "RUN=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3000 "') do set "RUN=1"
if "%RUN%"=="1" (
  echo [提示] 端口 3000 已被占用, 服务可能已在运行.
  echo        如浏览器打不开, 请先运行 停止服务.bat 再启动.
  pause
  exit /b 0
)

rem ---- 2. 确认数据库 (MySQL 3306) 可用, 未运行则自动拉起 Docker ----
set "DB=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3306 "') do set "DB=1"
if "%DB%"=="0" (
  echo [信息] 未检测到 3306 端口, 尝试启动 Docker 数据库...
  docker compose -f docker\docker-compose.dev.yml up -d mysql
  if errorlevel 1 (
    echo [错误] Docker 数据库启动失败, 请确认 Docker Desktop 已运行.
    pause
    exit /b 1
  )
  echo 等待数据库就绪, 约 5 秒.
  timeout /t 5 /nobreak >nul
)

if not exist logs mkdir logs
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set "DLOG=logs\dev-server-%%a.log"
rem ---- 3. 后台启动 next dev, 日志按日期写入 logs\dev-server-YYYYMMDD.log ----
start "AetherPet Dev" /min cmd /c "npm run dev >> %DLOG% 2>&1"
echo 服务正在启动 (出现名为 AetherPet Dev 的最小化窗口即为运行中).
echo 日志: %DLOG%
pause
