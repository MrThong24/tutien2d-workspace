param([string]$OutputName = 'Mo-10-Chrome.exe')
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source = Join-Path $PSScriptRoot 'Program.cs'
$script = Join-Path (Split-Path $PSScriptRoot -Parent) 'StartChrome-10.ps1'
$output = Join-Path (Split-Path $PSScriptRoot -Parent) $OutputName
if (-not (Test-Path -LiteralPath $compiler)) { throw "C# compiler not found: $compiler" }
& $compiler /nologo /target:winexe /platform:anycpu /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Management.dll /reference:System.Security.dll "/resource:$script,StartChrome-10.ps1" "/resource:$(Join-Path $PSScriptRoot 'mobile.html'),mobile.html" "/out:$output" $source (Join-Path $PSScriptRoot 'MonitorView.cs') (Join-Path $PSScriptRoot 'ActivityDashboardView.cs') (Join-Path $PSScriptRoot 'ProfileCloser.cs') (Join-Path $PSScriptRoot 'CharacterStatsView.cs') (Join-Path $PSScriptRoot 'CultivationEstimate.cs') (Join-Path $PSScriptRoot 'ProxySupport.cs') (Join-Path $PSScriptRoot 'MobileServer.cs') (Join-Path $PSScriptRoot 'AccountStore.cs') (Join-Path $PSScriptRoot 'AddAccountDialog.cs')
if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)." }
Write-Output "Built $output"
