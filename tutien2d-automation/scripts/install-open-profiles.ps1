param([int]$First = 2, [int]$Last = 10, [switch]$OnlyFarm, [switch]$NoReload)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class InstallFocus {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr p);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool x);
}
'@
function Focus-Profile([IntPtr]$handle) {
 $fg=[InstallFocus]::GetWindowThreadProcessId([InstallFocus]::GetForegroundWindow(),[IntPtr]::Zero)
 $me=[InstallFocus]::GetCurrentThreadId()
 [InstallFocus]::AttachThreadInput($me,$fg,$true) | Out-Null
 [InstallFocus]::SetForegroundWindow($handle) | Out-Null
 [InstallFocus]::AttachThreadInput($me,$fg,$false) | Out-Null
}
function Elements([IntPtr]$handle) {
 $root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
 return ,$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
}
function Open-Tab([int]$port,[string]$url) {
 $query=[uri]::EscapeDataString($url)
 $raw=Invoke-WebRequest -UseBasicParsing -Method Put -Uri ("http://127.0.0.1:$port/json/new?$query")
 return ($raw.Content | ConvertFrom-Json).id
}
function Install-File([int]$port,[IntPtr]$handle,[string]$url,[string]$expected) {
 $id=Open-Tab $port $url
 for ($i=0; $i -lt 25; $i++) {
  Start-Sleep -Milliseconds 250
  Focus-Profile $handle
  $nodes=Elements $handle
  $title=@($nodes | Where-Object { $_.Current.Name -like "*$expected*" -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.DataItem' })
  $buttons=@($nodes | Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and $_.Current.Name -in @('Cài đặt','Ghi đè','Cập nhật','Install','Reinstall','Update') -and $_.Current.IsEnabled })
  if ($title.Count -gt 0 -and $buttons.Count -eq 1) { $buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return $id }
 }
 throw "Profile $port không xác nhận được trang cài $expected; không tự bấm."
}
for ($index=$First; $index -le $Last; $index++) {
 $number=$index.ToString('00'); $port=19300+$index
 try {
  $p=Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match "Profile$number(?:[\\\s`"']|$)" -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
  if (!$p) { throw 'Không tìm thấy Chrome của profile.' }
  $handle=(Get-Process -Id $p.ProcessId).MainWindowHandle
  if ($handle -eq [IntPtr]::Zero) { throw 'Không tìm thấy cửa sổ profile.' }
  Focus-Profile $handle
  if (!$OnlyFarm) {Install-File $port $handle 'http://127.0.0.1:19444/auto-total.user.js' 'TuTien2D Auto tong an giao dien' | Out-Null }
  Install-File $port $handle 'http://127.0.0.1:19444/auto-quai.user.js' 'TuTien2D - Auto quai, duoc cong va linh thach' | Out-Null
  if ($OnlyFarm) {
   if (!$NoReload) {
    & node (Join-Path $PSScriptRoot 'reload-profile.cjs') $index | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Không tải lại được game.' }
   }
   Write-Output "Profile$number : đã cập nhật Auto quái."
   continue
  }
  $dashboard=Open-Tab $port 'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#nav=dashboard'
  $cell=$null
  for($i=0; $i -lt 25; $i++) {
   Start-Sleep -Milliseconds 250
   Focus-Profile $handle
   $nodes=Elements $handle
   $found=@($nodes | Where-Object { $_.Current.Name -eq 'TuTien2D - Rút bí tịch miễn phí' -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.DataItem' })
   if ($found.Count -eq 1) { $cell=$found[0]; break }
  }
  if (!$cell) { throw 'Không xác định được hàng Bí tịch cũ; chưa tắt.' }
  $row=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($cell)
  $children=$row.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $toggle=@($children | Where-Object { $_.Current.AutomationId -like '*_enabled' })
  if ($toggle.Count -ne 1) { throw 'Không xác định được nút Bí tịch cũ.' }
  $toggle[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  & node (Join-Path $PSScriptRoot 'reload-profile.cjs') $index | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Không tải lại được game.' }
  try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/json/close/$dashboard" | Out-Null } catch {}
  Write-Output "Profile$number : đã cài và tải lại, cần xác minh trạng thái game."
 } catch { Write-Output "Profile$number : LỖI - $($_.Exception.Message)" }
}

