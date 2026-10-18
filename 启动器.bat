@echo off
title SPT 模组管理器 & 服务器启动器
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

echo.
echo   正在启动 SPT 模组管理器...
echo   界面地址: http://127.0.0.1:7317
echo   关闭这个窗口即可停止管理器。
echo.
node server.js
if errorlevel 1 goto failed
exit /b 0

:nonode
echo.
echo   [错误] 没有找到 Node.js，请先安装 Node.js 18 或更高版本。
echo   下载地址: https://nodejs.org/
echo.
pause
exit /b 1

:failed
echo.
echo   [错误] 管理器异常退出，请把上面的报错信息截图反馈。
pause
exit /b 1
