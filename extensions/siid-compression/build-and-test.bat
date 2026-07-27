@echo off
setlocal

REM ============================================================
REM  SIID Compression - build & test WITHOUT rebuilding the IDE
REM
REM  1. Compiles ONLY the siid-compression extension (gulp task)
REM  2. Runs a headless smoke test of the compression manager
REM  3. Copies the built extension into the installed SIID app
REM  4. Clears the builtin extension cache and relaunches SIID
REM
REM  Flags:
REM    build-and-test.bat            full flow (compile + test + deploy + relaunch)
REM    build-and-test.bat /test      compile + headless test only, no deploy/relaunch
REM    build-and-test.bat /nolaunch  compile + test + deploy, but do not relaunch
REM ============================================================

set "PROJECT_DIR=C:\Users\Aman\Documents\DEV\AIpexiumProjectFolder\AIpexium2"
set "EXT_NAME=siid-compression"
set "INSTALL_DIR=C:\Users\Aman\AppData\Local\Programs\Siid"
set "EXT_DIR=%INSTALL_DIR%\resources\app\extensions"
set "SIID_EXE=%INSTALL_DIR%\Siid.exe"

set "TEST_ONLY="
set "NO_LAUNCH="
if /I "%~1"=="/test" set "TEST_ONLY=1"
if /I "%~1"=="/nolaunch" set "NO_LAUNCH=1"

cd /d "%PROJECT_DIR%"

echo === Compiling %EXT_NAME% (gulp) ===
call npx gulp compile-extension:%EXT_NAME%
if %ERRORLEVEL% neq 0 (
  echo Compilation failed!
  pause
  exit /b 1
)

echo.
echo === Headless smoke test ===
call node "%PROJECT_DIR%\extensions\%EXT_NAME%\test\smoke.js"
if %ERRORLEVEL% neq 0 (
  echo Smoke test FAILED!
  pause
  exit /b 1
)
echo Smoke test passed.

if defined TEST_ONLY (
  echo.
  echo /test flag set - skipping deploy and relaunch.
  echo Done.
  pause
  exit /b 0
)

echo.
echo === Closing SIID (if running) ===
taskkill /IM Siid.exe /F >nul 2>&1
taskkill /IM salesforce-intelligence-ide.exe /F >nul 2>&1

echo.
echo === Copying %EXT_NAME% into installed app ===
set "SRC=%PROJECT_DIR%\extensions\%EXT_NAME%"
set "DEST=%EXT_DIR%\%EXT_NAME%"
if not exist "%SRC%" (
  echo   [error] source folder missing: %SRC%
  pause
  exit /b 1
)
if not exist "%DEST%" mkdir "%DEST%"
REM Copy manifest + compiled output only (skip node_modules / src to keep it lean).
xcopy /Y "%SRC%\package.json" "%DEST%\" >nul
xcopy /E /I /Y "%SRC%\out" "%DEST%\out\" >nul
echo   - %EXT_NAME% copied.

echo.
echo === Clearing builtin extension cache ===
if exist "%APPDATA%\Siid\extensions.builtin.cache" del /f /q "%APPDATA%\Siid\extensions.builtin.cache"
if exist "%APPDATA%\Siid\CachedProfilesData" (
  for /d %%D in ("%APPDATA%\Siid\CachedProfilesData\*") do (
    if exist "%%D\extensions.builtin.cache" del /f /q "%%D\extensions.builtin.cache"
  )
)

if defined NO_LAUNCH (
  echo.
  echo /nolaunch flag set - not relaunching.
  echo Done.
  pause
  exit /b 0
)

echo.
echo === Relaunching SIID ===
if exist "%SIID_EXE%" (
  start "" "%SIID_EXE%"
) else (
  echo Could not find "%SIID_EXE%" - please start SIID manually.
)

echo.
echo Done.
pause
exit /b 0
