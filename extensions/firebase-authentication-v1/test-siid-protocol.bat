@echo off
echo Testing SIID protocol handling...
echo Command line: %*
echo About to call SIID with arguments...

cd "C:\Users\Aman\Documents\DEV\AIpexium2"
call scripts\code.bat "C:\Users\Aman\Documents\DEV\AIpexium2" "--open-url" "--" "%1"
