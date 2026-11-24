param([string]$Output='intro-live.json')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$cp=Get-Process chrome|Where-Object MainWindowHandle -ne 0|Select-Object -First 1
$root=[System.Windows.Automation.AutomationElement]::FromHandle($cp.MainWindowHandle)
$c=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Copy Log')
$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$c).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
Start-Sleep -Milliseconds 100
$raw=Get-Clipboard -Raw
$d=$raw|ConvertFrom-Json
if($d.schema -ne 'tutien2d-diagnostic-v1'){throw 'Unexpected clipboard contents'}
$raw|Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot "../evidence/$Output")
[pscustomobject]@{version=$d.version;intro=$d.intro;player=$d.snapshot.player;map=$d.snapshot.map;quest=$d.snapshot.quest;dialog=$d.snapshot.dialog;caption=$d.snapshot.caption}|ConvertTo-Json -Depth 6
