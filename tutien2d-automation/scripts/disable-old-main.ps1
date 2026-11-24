param([int]$Profile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$name=$Profile.ToString('00')
$p=Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match "Profile$name(?:[\\\s`"']|$)" -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
$h=(Get-Process -Id $p.ProcessId).MainWindowHandle
for ($i=0;$i -lt 1;$i++) {
 $root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
 $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 $cells=@($nodes | Where-Object { $_.Current.Name -eq '0.9.12' -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.DataItem' })
 if($cells.Count -ne 1) { throw 'Không tìm được duy nhất bản 0.9.12.' }
 $row=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($cells[0])
 $toggles=@($row.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.AutomationId -like '*_enabled' })
 if($toggles.Count -ne 1) { throw 'Không tìm được công tắc script.' }
 $toggles[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
 Start-Sleep -Seconds 1
}
& node (Join-Path $PSScriptRoot 'reload-profile.cjs') $Profile
