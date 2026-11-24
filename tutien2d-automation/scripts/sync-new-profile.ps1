param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 20)]
  [int]$ProfileNumber
)

$ErrorActionPreference = 'Stop'
$root = 'D:\Auto\tutien2d-automation'
$node = 'C:\Program Files\nodejs\node.exe'
$powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$label = 'Profile' + $ProfileNumber.ToString('00')

function Invoke-ProfileInstaller([string]$ScriptName, [string]$Version) {
  $installer = Join-Path $root ('scripts\' + $ScriptName)
  $output = @(& $powershell -NoProfile -ExecutionPolicy Bypass -File $installer -First $ProfileNumber -Last $ProfileNumber 2>&1)
  $exitCode = $LASTEXITCODE
  $text = ($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  if ($text) { Write-Output $text }
  if ($exitCode -ne 0 -or $text -notmatch [regex]::Escape($Version) -or $text -match 'could not confirm|ERROR|skipped') {
    throw ($label + ': could not install or confirm version ' + $Version + '.')
  }
}

if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Node.js was not found.' }
Invoke-ProfileInstaller 'install-auto-total-0.9.17.ps1' '0.9.17'
Invoke-ProfileInstaller 'install-auto-quai-2.0.28.ps1' '2.0.28'

$readyScript = Join-Path $root 'scripts\ensure-profile-ready.cjs'
& $node $readyScript $ProfileNumber
if ($LASTEXITCODE -ne 0) { throw ($label + ': scripts installed, but character connection is still not ready.') }
