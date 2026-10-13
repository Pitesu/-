@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 极光音乐 - 局域网服务
cd /d "%~dp0"

echo ============================================
echo    极光音乐 - 局域网启动
echo ============================================
echo.

REM ---------- 定位 Python ----------
set "PY="

REM 1) PATH 里的 python
for /f "delims=" %%p in ('where python 2^>nul') do (
    if not defined PY set "PY=%%p"
)

REM 2) Windows 应用商店别名（可能是空壳，需要排除）
if defined PY (
    echo "%PY%" | findstr /i "WindowsApps" >nul && set "PY="
)

REM 3) py 启动器
if not defined PY (
    for /f "delims=" %%p in ('where py 2^>nul') do (
        if not defined PY set "PY=%%p"
    )
)

REM 4) 常见安装目录
if not defined PY (
    for %%d in (
        "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
        "%ProgramFiles%\Python313\python.exe"
        "%ProgramFiles%\Python312\python.exe"
        "%ProgramFiles%\Python311\python.exe"
    ) do (
        if exist %%d if not defined PY set "PY=%%~d"
    )
)

REM 5) WorkBuddy 内置 Python
if not defined PY (
    for /f "delims=" %%p in ('dir /b /ad "%USERPROFILE%\.workbuddy\binaries\python\versions" 2^>nul') do (
        if exist "%USERPROFILE%\.workbuddy\binaries\python\versions\%%p\python.exe" (
            set "PY=%USERPROFILE%\.workbuddy\binaries\python\versions\%%p\python.exe"
        )
    )
)

if not defined PY (
    echo [错误] 没有找到 Python
    echo.
    echo 请任选一种方式解决：
    echo   1. 安装 Python 3: https://www.python.org/downloads/
    echo      安装时务必勾选 "Add Python to PATH"
    echo   2. 或安装 Node.js 后在项目目录执行: npx serve -l 8848
    echo.
    pause
    exit /b 1
)

echo [OK] Python: %PY%
echo.

REM ---------- 检测局域网 IP ----------
echo [OK] 正在检测局域网地址...
set "LANIP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=* delims= " %%b in ("%%a") do (
        set "CAND=%%b"
        echo "!CAND!" | findstr /c:"192.168." >nul && if not defined LANIP set "LANIP=!CAND!"
    )
)
if not defined LANIP (
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
        for /f "tokens=* delims= " %%b in ("%%a") do (
            set "CAND=%%b"
            echo "!CAND!" | findstr /c:"10." >nul && if not defined LANIP set "LANIP=!CAND!"
        )
    )
)
if not defined LANIP set "LANIP=127.0.0.1"

echo.
echo ============================================
echo    手机安装步骤
echo ============================================
echo.
echo    1. 手机与电脑连同一个 WiFi
echo    2. 手机浏览器打开下面这个地址：
echo.
echo        http://!LANIP!:8848
echo.
echo    3. Android Chrome: 右上角 ⋮ -^> 添加到主屏幕
echo       iPhone Safari : 底部分享 -^> 添加到主屏幕
echo.
echo    注意：局域网 HTTP 下录音会被浏览器限制
echo          界面浏览不受影响
echo.
echo ============================================
echo    按 Ctrl+C 停止服务
echo ============================================
echo.

"%PY%" -m http.server 8848 --bind 0.0.0.0

echo.
echo 服务已停止。
pause