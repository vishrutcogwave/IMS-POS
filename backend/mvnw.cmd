@echo off
setlocal
set "MAVEN=%~dp0..\.tools\apache-maven-3.9.9\bin\mvn.cmd"
if exist "%MAVEN%" (
  call "%MAVEN%" "-Dmaven.repo.local=%~dp0..\.tools\m2" -f "%~dp0pom.xml" %*
) else (
  call mvn -f "%~dp0pom.xml" %*
)
exit /b %ERRORLEVEL%
