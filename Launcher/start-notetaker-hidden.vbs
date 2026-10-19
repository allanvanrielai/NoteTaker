' Starts the NoteTaker server with no window. Optional argument: port (default 47613).
Dim sh, port, cmd
Set sh = CreateObject("WScript.Shell")
port = ""
If WScript.Arguments.Count > 0 Then port = " " & WScript.Arguments(0)
cmd = "cmd /c """"F:\OneDrive\AI\NoteTaker\Launcher\start-notetaker-server.bat""" & port & """"
sh.Run cmd, 0, False
