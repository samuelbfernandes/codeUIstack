@echo off
rem Thin launcher for native Windows: runs the Python installer next to this file. Example:  install.cmd --plan
setlocal
set "HERE=%~dp0"
set "PYTHONPATH=%HERE%src;%PYTHONPATH%"
where py >nul 2>nul && (py -3 -m cctk %* & goto :end)
where python >nul 2>nul && (python -m cctk %* & goto :end)
echo Python 3.9 or newer is needed. Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then run this again.
:end
endlocal
