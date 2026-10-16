@echo off
chcp 65001 >nul
call "%KINGU_WINDOWS_VSDEVCMD%" -no_logo -arch=%KINGU_WINDOWS_NATIVE_ARCH% -host_arch=%KINGU_WINDOWS_NATIVE_ARCH%
if errorlevel 1 exit /b 1
echo KINGU_WINDOWS_NATIVE_ENVIRONMENT
set
