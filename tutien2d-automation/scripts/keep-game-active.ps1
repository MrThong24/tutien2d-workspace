param([int]$First = 2, [int]$Last = 10)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class KeepGameFocus {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr p);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool x);
}
'@
function Get-Elements([IntPtr]$handle) {
 $root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
 return ,$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
}
function Focus-Profile([IntPtr]$handle) {
 $fg=[KeepGameFocus]::GetWindowThreadProcessId([KeepGameFocus]::GetForegroundWindow(),[IntPtr]::Zero)
 $me=[KeepGameFocus]::GetCurrentThreadId()
 [KeepGameFocus]::AttachThreadInput($me,$fg,$true)|Out-Null
 [KeepGameFocus]::SetForegroundWindow($handle)|Out-Null
 [KeepGameFocus]::AttachThreadInput($me,$fg,$false)|Out-Null
}
for($i=$First;$i -le $Last;$i++) {
 $name=$i.ToString('00');$port=19300+$i;$tab=$null
 try {
  $p=Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match "Profile$name(?:[\\\s`"']|$)" -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
  if(!$p){throw 'Không thấy Chrome'}
  $h=(Get-Process -Id $p.ProcessId).MainWindowHandle
  if($h -eq [IntPtr]::Zero){throw 'Không thấy cửa sổ Chrome'}
  $response=Invoke-WebRequest -UseBasicParsing -Method Put -Uri "http://127.0.0.1:$port/json/new?chrome%3A%2F%2Fsettings%2Fperformance"
  $tab=($response.Content|ConvertFrom-Json).id
  $button=$null
  for($n=0;$n -lt 35;$n++) {
   Start-Sleep -Milliseconds 300; Focus-Profile $h; $nodes=Get-Elements $h
   $found=@($nodes|Where-Object { $_.Current.Name -like 'Thêm vào danh sách*' -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and $_.Current.AutomationId -ne 'actionButton' })
   if($found.Count -eq 1){$button=$found[0];break}
  }
  if(!$button){throw 'Không thấy trang cài đặt hiệu suất'}
  $already=@($nodes|Where-Object { $_.Current.Name -eq 'tutien2d.com' -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Text' })
  if($already.Count -gt 0){Write-Output "Profile$name : đã có ngoại lệ";continue}
  $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  $check=$null
  for($n=0;$n -lt 20;$n++) {
   Start-Sleep -Milliseconds 200; $nodes=Get-Elements $h
   $found=@($nodes|Where-Object { $_.Current.Name -eq 'tutien2d.com' -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.CheckBox' })
   if($found.Count -eq 1){$check=$found[0];break}
  }
  if(!$check){throw 'Không thấy game trong danh sách tab đang mở'}
  $toggle=$check.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  if($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On){$toggle.Toggle()}
  $action=@()
  for($n=0;$n -lt 15;$n++) {
   Start-Sleep -Milliseconds 200; $nodes=Get-Elements $h
   $action=@($nodes|Where-Object { $_.Current.AutomationId -eq 'actionButton' -and $_.Current.IsEnabled })
   if($action.Count -eq 1){break}
  }
  if($action.Count -ne 1){throw 'Không xác nhận được nút thêm'}
  $action[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  $ok=$false
  for($n=0;$n -lt 20;$n++) {
   Start-Sleep -Milliseconds 200; $nodes=Get-Elements $h
   $result=@($nodes|Where-Object { $_.Current.Name -eq 'tutien2d.com' -and $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Text' })
   if($result.Count -gt 0){$ok=$true;break}
  }
  if(!$ok){throw 'Chưa xác nhận ngoại lệ đã lưu'}
  Write-Output "Profile$name : đã thêm ngoại lệ"
 } catch {Write-Output "Profile$name : LỖI - $($_.Exception.Message)"}
 finally {if($tab){try{Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/json/close/$tab"|Out-Null}catch{}}}
}
