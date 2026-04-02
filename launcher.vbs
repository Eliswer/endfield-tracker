Set WshShell = CreateObject("WScript.Shell")
Dim scriptDir
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' Check if tracker is already running by looking for node.exe running tracker.js
Dim objWMI, colProcesses
Set objWMI = GetObject("winmgmts:\\.\root\cimv2")
Set colProcesses = objWMI.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name = 'node.exe'")
For Each objProcess In colProcesses
    If InStr(LCase(objProcess.CommandLine), "tracker.js") > 0 Then
        ' Already running, just open the dashboard and exit
        WshShell.Run "cmd /c start http://127.0.0.1:27182", 0, False
        WScript.Quit
    End If
Next

WshShell.Run "node.exe """ & scriptDir & "tracker.js""", 0, False
