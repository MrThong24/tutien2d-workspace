param(
  [int]$First = 1,
  [int]$Last = 1
)
$ErrorActionPreference = 'Stop'
if ($First -lt 1 -or $Last -gt 20 -or $First -gt $Last) { throw 'Profile range must be from 1 to 20.' }

$root = 'D:\Auto\tutien2d-automation'
$serverScript = Join-Path $root 'scripts\local-userscript-server.cjs'
$reloadScript = Join-Path $root 'scripts\reload-profile.cjs'
$node = 'C:\Program Files\nodejs\node.exe'
$url = 'http://127.0.0.1:19444/auto-quai.user.js'
$expectedTitle = 'TuTien2D - Auto quai, duoc cong va linh thach'

# Restart only this helper so the new 2.0.26 route is loaded.
$serverPattern = [regex]::Escape($serverScript)
$servers = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match $serverPattern }
foreach ($server in $servers) { Stop-Process -Id $server.ProcessId -Force }
Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList ('"' + $serverScript + '"')

$served = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 250
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -Proxy $null -TimeoutSec 2
    if ($response.StatusCode -eq 200 -and $response.Content -match '@version\s+2\.0\.26') { $served = $true; break }
  } catch {}
}
if (-not $served) { throw 'Local server did not serve Auto quái 2.0.26.' }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AutoTotalInstallFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
}
'@

function Focus-Profile([IntPtr]$handle) {
  $foregroundThread = [AutoTotalInstallFocus]::GetWindowThreadProcessId([AutoTotalInstallFocus]::GetForegroundWindow(), [IntPtr]::Zero)
  $currentThread = [AutoTotalInstallFocus]::GetCurrentThreadId()
  [AutoTotalInstallFocus]::AttachThreadInput($currentThread, $foregroundThread, $true) | Out-Null
  [AutoTotalInstallFocus]::SetForegroundWindow($handle) | Out-Null
  [AutoTotalInstallFocus]::AttachThreadInput($currentThread, $foregroundThread, $false) | Out-Null
}

function Get-UiElements([IntPtr]$handle) {
  $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  return ,$rootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
}

function Open-Tab([int]$port, [string]$targetUrl) {
  $escapedUrl = [uri]::EscapeDataString($targetUrl)
  $reply = Invoke-WebRequest -UseBasicParsing -Method Put -Uri "http://127.0.0.1:$port/json/new?$escapedUrl" -TimeoutSec 3
  return ($reply.Content | ConvertFrom-Json).id
}

function ConvertFrom-CodePoints([int[]]$points) { return -join ($points | ForEach-Object { [char]$_ }) }
function Update-Profile([int]$number) {
  $label = 'Profile' + $number.ToString('00')
  $port = 19300 + $number
  $profilePath = [regex]::Escape("D:\Auto\ChromeProxy\Profile" + $number.ToString('00'))
  $chrome = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -match $profilePath -and $_.CommandLine -notmatch '--type=' } |
    Select-Object -First 1
  if (-not $chrome) { return "$label : skipped, Chrome is not open." }
  $process = Get-Process -Id $chrome.ProcessId -ErrorAction SilentlyContinue
  if (-not $process -or $process.MainWindowHandle -eq [IntPtr]::Zero) { return "$label : error, Chrome window not found." }

  $tabId = Open-Tab $port $url
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 250
    Focus-Profile $process.MainWindowHandle
    $elements = Get-UiElements $process.MainWindowHandle
    $title = @($elements | Where-Object { $_.Current.Name -like "*$expectedTitle*" -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.DataItem' })
    $buttonLabels = @((ConvertFrom-CodePoints @(0x43,0xE0,0x69,0x20,0x111,0x1EB7,0x74)), (ConvertFrom-CodePoints @(0x47,0x68,0x69,0x20,0x111,0xE8)), (ConvertFrom-CodePoints @(0x43,0x1EAD,0x70,0x20,0x6E,0x68,0x1EAD,0x74)), (ConvertFrom-CodePoints @(0x43,0xE0,0x69,0x20,0x6C,0x1EA1,0x69)), 'Install', 'Reinstall', 'Update')
    $buttons = @($elements | Where-Object {
      $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and
      $_.Current.Name -in $buttonLabels -and
      $_.Current.IsEnabled
      })
    if ($title.Count -gt 0 -and $buttons.Count -eq 1) {
      $buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Start-Sleep -Milliseconds 700
      & $node $reloadScript $number | Out-Null
      if ($LASTEXITCODE -ne 0) { return "$label : script updated, but game reload failed." }
      return "$label : đã cập nhật Auto quái 2.0.26 và tải lại game."
    }
  }
  return "$label : could not confirm Tampermonkey update button; update tab remains open ($tabId)."
}

for ($number = $First; $number -le $Last; $number++) {
  try { Update-Profile $number } catch { "Profile$($number.ToString('00')) : ERROR - $($_.Exception.Message)" }
}



