$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GardenForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$window = Get-Process -Name browser -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match '2D' } | Select-Object -First 1
if (-not $window) { Write-Output 'GAME_WINDOW_NOT_FOUND'; exit 1 }
$oldClipboard = Get-Clipboard -Raw -ErrorAction SilentlyContinue
$shell = New-Object -ComObject WScript.Shell
try {
  if (-not $shell.AppActivate($window.Id)) { Write-Output 'WINDOW_ACTIVATION_FAILED'; exit 1 }
  Start-Sleep -Milliseconds 300
  if ([GardenForeground]::GetForegroundWindow() -ne $window.MainWindowHandle) { Write-Output 'WINDOW_NOT_FOREGROUND'; exit 1 }
  $payload = @'
copy(JSON.stringify((()=>{let d=JSON.parse(localStorage.getItem('pntt_progress_v1')||'{}');let ids=['bich_van_diep','long_huyet_thao','pha_canh_dan','hat_bich_van','hat_long_huyet','linh_thuy'];let e=id=>document.getElementById(id),t=id=>e(id)?.textContent?.trim()||null,v=x=>!!x&&!x.hidden&&!x.classList.contains('hidden')&&!!x.getClientRects().length,dlg=e('dialog');return {time:Date.now(),map:t('hud-map'),position:t('hud-pos'),realm:t('hud-realm'),interact:e('btn-attack')?.getAttribute('aria-label')||null,enemy:v(e('hud-target'))?t('target-name'):null,autoCombat:e('btn-auto-touch')?.classList.contains('active')??null,dialog:v(dlg)?{title:t('dialog-title'),text:t('dialog-text'),choices:[...dlg.querySelectorAll('#dialog-choices button,#dialog-action')].filter(v).map(b=>({label:b.textContent.trim(),disabled:b.disabled}))}:null,saved:{realm:d.realm??null,farm:d.farm??null,items:Object.fromEntries(ids.map(id=>[id,d.bag?.[id]??0]))}}})()))
'@
  Set-Clipboard -Value $payload
  $shell.SendKeys('^+j')
  Start-Sleep -Milliseconds 1400
  $shell.SendKeys('^v')
  Start-Sleep -Milliseconds 300
  $shell.SendKeys('{ENTER}')
  Start-Sleep -Milliseconds 1500
  $result = Get-Clipboard -Raw
  try {
    $data = $result | ConvertFrom-Json -ErrorAction Stop
    if ($data.saved.farm -and $data.map) { $data | ConvertTo-Json -Depth 8 }
    else { Write-Output 'DIAGNOSTIC_NOT_RECEIVED' }
  } catch { Write-Output 'CONSOLE_PASTE_OR_SCRIPT_FAILED' }
} finally {
  if ($null -ne $oldClipboard) { Set-Clipboard -Value $oldClipboard }
}
