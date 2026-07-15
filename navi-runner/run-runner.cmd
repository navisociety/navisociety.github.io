@echo off
rem navi-runner launcher - runs the poll once, reading navi-runner\.env.
rem Schedule this file with Task Scheduler for hands-free polling.
rem v43: output is appended to navi-runner\runner.log (gitignored) so
rem scheduled runs leave a trail. Arguments pass through to poll.js
rem (e.g. run-runner.cmd --loop 900).
echo [%date% %time%] runner poll >> "%~dp0runner.log"
node --env-file="%~dp0.env" "%~dp0poll.js" %* >> "%~dp0runner.log" 2>&1
