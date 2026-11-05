@echo off
rem Starts Split Chamber from the project folder (no Node.js needed; uses the bundled Electron runtime).
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron runtime not found. Run "npm install" in this folder first,
  echo or use the portable build in the "dist" folder.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
