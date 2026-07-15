@echo off
rem navi-runner launcher - runs the poll once, reading navi-runner\.env.
rem Schedule this file with Task Scheduler for hands-free polling.
node --env-file="%~dp0.env" "%~dp0poll.js"
