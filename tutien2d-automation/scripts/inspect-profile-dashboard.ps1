param([int]$Profile=4)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class DashFocus {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr p);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool x);
}
'@
$name=$Profile.ToString('00');$port=19300+$Profile
$url=[uri]::EscapeDataString('chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#nav=dashboard')
Invoke-WebRequest -UseBasicParsing -Method Put -Uri "http://127.0.0.1:$port/json/new?$url" | Out-Null
$p=Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match "Profile$name(?:[\\\s`"']|$)" -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
$h=(Get-Process -Id $p.ProcessId).MainWindowHandle
$fg=[DashFocus]::GetWindowThreadProcessId([DashFocus]::GetForegroundWindow(),[IntPtr]::Zero);$me=[DashFocus]::GetCurrentThreadId()
[DashFocus]::AttachThreadInput($me,$fg,$true)|Out-Null
[DashFocus]::SetForegroundWindow($h)|Out-Null
[DashFocus]::AttachThreadInput($me,$fg,$false)|Out-Null
Start-Sleep -Seconds 2
$root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
$nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
foreach($cell in @($nodes | Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.DataItem' -and $_.Current.Name -like 'TuTien2D*' })) {
 $row=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($cell)
 $children=$row.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
 Write-Output (($children | ForEach-Object { $_.Current.Name }) -join ' | ')
}
