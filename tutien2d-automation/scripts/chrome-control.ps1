param(
  [ValidateSet('Inspect','Click','ClickAt','Keys','Capture','Navigate','PasteFile')][string]$Action='Inspect',
  [string]$Name,
  [string]$Value,
  [long]$WindowHandle=0,
  [int]$WaitMs=500
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ChromeDesktop {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
}
'@
[ChromeDesktop]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
$chrome=Get-Process chrome | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
if(-not $chrome){throw 'No interactive Chrome window'}
$handle=if($WindowHandle){[IntPtr]$WindowHandle}else{$chrome.MainWindowHandle}
[uint32]$targetProcess=0
[ChromeDesktop]::GetWindowThreadProcessId($handle,[ref]$targetProcess) | Out-Null
if(-not $targetProcess -or (Get-Process -Id $targetProcess).ProcessName -ne 'chrome'){throw 'Target is not a Chrome window'}
if([ChromeDesktop]::IsIconic($handle)){[ChromeDesktop]::ShowWindow($handle,9) | Out-Null}
if($Action -ne 'Inspect') {
  [uint32]$foregroundProcess=0
  [ChromeDesktop]::GetWindowThreadProcessId([ChromeDesktop]::GetForegroundWindow(),[ref]$foregroundProcess) | Out-Null
  if([ChromeDesktop]::GetForegroundWindow() -ne $handle){
    [ChromeDesktop]::SetForegroundWindow($handle) | Out-Null
    Start-Sleep -Milliseconds 150
    [ChromeDesktop]::GetWindowThreadProcessId([ChromeDesktop]::GetForegroundWindow(),[ref]$foregroundProcess) | Out-Null
    if([ChromeDesktop]::GetForegroundWindow() -ne $handle){
      $activation=New-Object -ComObject WScript.Shell
      $activation.AppActivate([int]$targetProcess) | Out-Null
      Start-Sleep -Milliseconds 150
      [ChromeDesktop]::SetForegroundWindow($handle) | Out-Null
      Start-Sleep -Milliseconds 150
    }
  }
  [ChromeDesktop]::GetWindowThreadProcessId([ChromeDesktop]::GetForegroundWindow(),[ref]$foregroundProcess) | Out-Null
  if([ChromeDesktop]::GetForegroundWindow() -ne $handle){throw 'Target Chrome window did not become foreground; no input sent'}
}
$root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
switch($Action){
  'ClickAt' {
    $xy=$Value.Split(',')
    if($xy.Length -ne 2){throw 'ClickAt expects window-relative x,y'}
    $r=$root.Current.BoundingRectangle
    $x=[int]$xy[0];$y=[int]$xy[1]
    if($x -lt 0 -or $y -lt 0 -or $x -ge $r.Width -or $y -ge $r.Height){throw 'Click outside Chrome bounds'}
    [ChromeDesktop]::SetCursorPos([int]($r.X+$x),[int]($r.Y+$y)) | Out-Null
    [ChromeDesktop]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [ChromeDesktop]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  }
  'Click' {
    $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$Name)
    $element=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
    if(-not $element){throw ('Element missing: '+$Name)}
    $r=$element.Current.BoundingRectangle
    if($r.Width -le 0 -or $r.Height -le 0){throw 'Element has no clickable bounds'}
    $windowBounds=$root.Current.BoundingRectangle
    $centerX=$r.X+$r.Width/2;$centerY=$r.Y+$r.Height/2
    if($element.Current.IsOffscreen -or $centerX -lt $windowBounds.X -or $centerX -ge $windowBounds.Right -or $centerY -lt $windowBounds.Y -or $centerY -ge $windowBounds.Bottom){throw 'Element center is outside the visible Chrome window; no click sent'}
    [ChromeDesktop]::SetCursorPos([int]($r.X+$r.Width/2),[int]($r.Y+$r.Height/2)) | Out-Null
    [ChromeDesktop]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [ChromeDesktop]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  }
  'Keys' { [System.Windows.Forms.SendKeys]::SendWait($Value) }
  'Navigate' {
    [System.Windows.Forms.SendKeys]::SendWait('^t')
    Start-Sleep -Milliseconds 200
    Set-Clipboard -Value $Value
    [System.Windows.Forms.SendKeys]::SendWait('^v{ENTER}')
  }
  'PasteFile' {
    if(-not (Test-Path -LiteralPath $Value -PathType Leaf)){throw 'Input file missing'}
    Set-Clipboard -Value (Get-Content -LiteralPath $Value -Encoding UTF8 -Raw)
    [System.Windows.Forms.SendKeys]::SendWait('^a^v')
  }
  'Capture' {
    $r=$root.Current.BoundingRectangle
    $bitmap=New-Object System.Drawing.Bitmap([int]$r.Width,[int]$r.Height)
    $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen([int]$r.X,[int]$r.Y,0,0,$bitmap.Size)
      $bitmap.Save($Value,[System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    Write-Output $Value
  }
}
if($WaitMs -gt 0){Start-Sleep -Milliseconds $WaitMs}
if($Action -eq 'Inspect'){
  $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $out=foreach($node in $nodes){
    $kind=$node.Current.ControlType.ProgrammaticName
    $r=$node.Current.BoundingRectangle
    if($kind -in @('ControlType.Button','ControlType.Hyperlink','ControlType.Edit','ControlType.MenuItem','ControlType.CheckBox','ControlType.TabItem','ControlType.Document','ControlType.Text') -and $r.Width -gt 0 -and $r.Height -gt 0){
      if($Name -and $node.Current.Name -notmatch $Name){continue}
      [pscustomobject]@{Name=$node.Current.Name.Substring(0,[Math]::Min(200,$node.Current.Name.Length));Type=$kind;Id=$node.Current.AutomationId;X=[Math]::Round($r.X);Y=[Math]::Round($r.Y);W=[Math]::Round($r.Width);H=[Math]::Round($r.Height)}
    }
  }
  $out | Select-Object -First 140 | ConvertTo-Json -Depth 3
}
