#define AppName "MC Servicos VPN Agent"
#define AppVersion "0.1.0"
#define AppPublisher "MC Servicos"
#define AppExeName "run-agent.vbs"

[Setup]
AppId={{A53ED6D5-3F41-4D13-B46D-ABF45860F4F1}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\MCServicos\VpnAgent
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=mcservicos-vpn-agent-installer
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "payload\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "node_modules\mcservicos-vpn-agent\*"

[Icons]
Name: "{userstartup}\MC Servicos VPN Agent"; Filename: "{app}\{#AppExeName}"
Name: "{userdesktop}\MC Servicos VPN Agent"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na area de trabalho"; GroupDescription: "Atalhos adicionais:"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Iniciar agente local agora"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\agent.log"
