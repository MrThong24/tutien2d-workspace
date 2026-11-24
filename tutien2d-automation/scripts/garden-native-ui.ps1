$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GardenNativeInput {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
}
'@
[GardenNativeInput]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$until=(Get-Date).AddHours(1)
while((Get-Date) -lt $until){
  try {
    $chrome=Get-Process chrome -ErrorAction SilentlyContinue|Where-Object MainWindowHandle -ne 0|Select-Object -First 1
    if(-not $chrome){break}
    if([GardenNativeInput]::IsIconic($chrome.MainWindowHandle)){Start-Sleep -Milliseconds 300;continue}
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($chrome.MainWindowHandle)
    $addressCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'view_1012')
    $address=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$addressCondition)
    $url=$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
    if($url -notmatch '^(https://)?tutien2d\.com/\?choi(?:[=&]|$)'){Start-Sleep -Milliseconds 300;continue}
    $markerCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'tta-native-action')
    $marker=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$markerCondition)
    if(-not $marker -or $marker.Current.IsOffscreen){Start-Sleep -Milliseconds 250;continue}
    $request=$marker.Current.Name -split '\|',3
    if($request.Length -ne 3 -or $request[0] -ne 'TTA_NATIVE' -or $request[2] -notmatch '^(Gieo Hạt .+|Vẫn đổi Gói Hạt .+|Bắt Đầu Phá Quan)$' -or $seen.Contains($request[1])){Start-Sleep -Milliseconds 250;continue}
    $buttonCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)
    $buttons=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$buttonCondition)
    $targets=@($buttons|Where-Object { -not $_.Current.IsOffscreen -and $_.Current.IsEnabled -and $_.Current.Name.StartsWith($request[2]) })
    if($targets.Count -eq 1 -and -not $marker.Current.IsOffscreen -and $marker.Current.Name -eq ('TTA_NATIVE|'+$request[1]+'|'+$request[2])){
      # InvokePattern may acknowledge without committing certain seed choices in
      # Chrome. Activate the verified game window first, then confirm foreground
      # ownership before clicking; never click through another application.
      [uint32]$foregroundId=0
      [GardenNativeInput]::GetWindowThreadProcessId([GardenNativeInput]::GetForegroundWindow(),[ref]$foregroundId)|Out-Null
      if($foregroundId -ne $chrome.Id){
        [GardenNativeInput]::SetForegroundWindow($chrome.MainWindowHandle)|Out-Null
        Start-Sleep -Milliseconds 150
        [GardenNativeInput]::GetWindowThreadProcessId([GardenNativeInput]::GetForegroundWindow(),[ref]$foregroundId)|Out-Null
        if($foregroundId -ne $chrome.Id){
          $gameActivation=New-Object -ComObject WScript.Shell
          $gameActivation.AppActivate($chrome.Id)|Out-Null
          Start-Sleep -Milliseconds 150
          [GardenNativeInput]::GetWindowThreadProcessId([GardenNativeInput]::GetForegroundWindow(),[ref]$foregroundId)|Out-Null
        }
        if($foregroundId -ne $chrome.Id){continue}
      }
      $bounds=$targets[0].Current.BoundingRectangle
      $windowBounds=$root.Current.BoundingRectangle
      $targetX=$bounds.X+$bounds.Width/2
      $targetY=$bounds.Y+$bounds.Height/2
      if($bounds.Width -le 0 -or $bounds.Height -le 0 -or $targetX -lt $windowBounds.X -or $targetX -ge $windowBounds.Right -or $targetY -lt $windowBounds.Y -or $targetY -ge $windowBounds.Bottom){continue}
      if(-not [GardenNativeInput]::SetCursorPos([int]$targetX,[int]$targetY)){continue}
      $seen.Add($request[1])|Out-Null
      [GardenNativeInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
      [GardenNativeInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
      $marker.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    }
  } catch { # A disappearing dialog/window is retried; no fallback clicks or keys.
  }
  Start-Sleep -Milliseconds 250
}
