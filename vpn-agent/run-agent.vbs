Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmdPath = """" & fso.BuildPath(scriptDir, "run-agent.cmd") & """"

shell.Run cmdPath, 0, False
