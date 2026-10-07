@echo off
rem 一键构建安装包（Windows）。可双击运行，也可在命令行带参数，例如：build.cmd --bundles nsis,msi
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js。请从 https://nodejs.org 安装 20 或更高版本（LTS），然后重新运行 build.cmd
  goto :end
)
node scripts\package.mjs %*
:end
rem 双击运行时保留窗口，方便查看结果
echo %cmdcmdline% | find /i "/c" >nul && pause
