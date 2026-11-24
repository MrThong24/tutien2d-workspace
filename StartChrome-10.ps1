param(
    [int]$ScreenIndex = -1,
    [ValidateRange(0,20)][int]$ProfileNumber = 0,
    [ValidateRange(1,20)][int]$ProfileCount = 10,
    [switch]$Preview,
    [switch]$CheckExisting,
    [switch]$Monitor,
    [string]$ProxyFile = ''
)

$ErrorActionPreference = 'Stop'
$chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$baseDir = 'D:\Auto\ChromeProxy'
$website = 'https://tutien2d.com/?choi'

# Proxy values are taken from the ten Chrome profiles currently running.
$proxies = @(
    '45.3.33.71:3129',
    '65.111.27.161:3129',
    '216.26.234.18:3129',
    '209.50.167.170:3129',
    '65.111.8.168:3129',
    '209.50.183.154:3129',
    '209.50.186.96:3129',
    '216.26.248.142:3129',
    '104.167.19.42:3129',
    '45.3.36.162:3129'
)

if ($ProxyFile) {
    if (-not (Test-Path -LiteralPath $ProxyFile -PathType Leaf)) { throw "Proxy file not found: $ProxyFile" }
    $proxies = @([IO.File]::ReadAllLines($ProxyFile, [Text.Encoding]::UTF8))
    while ($proxies.Count -gt 0 -and -not $proxies[-1].Trim()) { $proxies = @($proxies | Select-Object -SkipLast 1) }
}
if ($ProfileNumber -gt $ProfileCount) { throw 'Selected profile exceeds profile count.' }
if ($proxies.Count -ne $ProfileCount) { throw "Exactly $ProfileCount proxy lines are required; found $($proxies.Count)." }
function Convert-Proxy($value, [int]$lineNumber) {
    $value = ([string]$value).Trim()
    $match = [regex]::Match($value, '^(?:(https?|socks5)://)?(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):([0-9]{1,5})$', 'IgnoreCase')
    if (-not $match.Success) { throw "Invalid proxy on line $lineNumber. Use IP:PORT without username or password." }
    $port = [int]$match.Groups[3].Value
    if ($port -lt 1 -or $port -gt 65535) { throw "Invalid port on proxy line $lineNumber." }
    $hostPart = $match.Groups[2].Value
    if ([Uri]::CheckHostName($hostPart.Trim('[', ']')) -eq [UriHostNameType]::Unknown) { throw "Invalid host on proxy line $lineNumber." }
    $scheme = if ($match.Groups[1].Success) { $match.Groups[1].Value.ToLowerInvariant() } else { 'http' }
    return ('{0}://{1}:{2}' -f $scheme, $hostPart.ToLowerInvariant(), $port)
}
for ($i = 0; $i -lt $proxies.Count; $i++) { $proxies[$i] = Convert-Proxy $proxies[$i] ($i + 1) }

if (-not (Test-Path -LiteralPath $chromePath -PathType Leaf)) {
    throw "Chrome not found: $chromePath"
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ChromeGridWin32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT rect, int size);
}
'@
try {
    if (-not [ChromeGridWin32]::SetProcessDpiAwarenessContext([IntPtr](-4))) {
        [ChromeGridWin32]::SetProcessDPIAware() | Out-Null
    }
} catch {
    try { [ChromeGridWin32]::SetProcessDPIAware() | Out-Null } catch {}
}

$screens = @([System.Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.X }, { $_.Bounds.Y })
if ($screens.Count -eq 0) { throw 'No monitor found.' }
if ($ScreenIndex -ge 0) {
    if ($ScreenIndex -ge $screens.Count) { throw "Invalid ScreenIndex. Available: 0 to $($screens.Count - 1)." }
    $screen = $screens[$ScreenIndex]
} else {
    $secondary = @($screens | Where-Object { -not $_.Primary })
    $screen = if ($secondary.Count -gt 0) { $secondary[0] } else { $screens[0] }
}
$area = $screen.WorkingArea
# Reserve the full 20-profile layout from the start. Opening more profiles later
# fills their existing slots without resizing or moving the profiles already open.
$columns = 5
$rows = 4
$jobs = for ($i = 0; $i -lt $ProfileCount; $i++) {
    $row = [int][Math]::Floor($i / $columns)
    $column = $i % $columns
    $left = $area.Left + [int][Math]::Floor($column * $area.Width / $columns)
    $right = $area.Left + [int][Math]::Floor(($column + 1) * $area.Width / $columns)
    $top = $area.Top + [int][Math]::Floor($row * $area.Height / $rows)
    $bottom = $area.Top + [int][Math]::Floor(($row + 1) * $area.Height / $rows)
    $name = 'Profile{0:D2}' -f ($i + 1)
    [pscustomobject]@{ Name = $name; Path = (Join-Path $baseDir $name); Proxy = $proxies[$i]; DebugPort = (19301 + $i);
        Left = $left; Top = $top; Width = $right - $left; Height = $bottom - $top; Done = $false }
}
if ($ProfileNumber -gt 0) { $jobs = @($jobs | Where-Object { $_.Name -eq ('Profile{0:D2}' -f $ProfileNumber) }) }
Write-Host "Lưới cố định cho tối đa 20 Chrome trên một màn hình: $($screen.DeviceName), $columns cột × $rows hàng. Đang xử lý $ProfileCount profile."
$jobs | Select-Object Name, Left, Top, Width, Height, Proxy | Format-Table -AutoSize
if ($Preview -and -not $CheckExisting) { return }

function Get-ProfileProcesses {
    $result = @{}
    $processes = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction Stop
    foreach ($process in $processes) {
        $line = $process.CommandLine
        if (-not $line -or $line -match '(?:^|\s)--type=') { continue }
        $match = [regex]::Match($line, '--user-data-dir=(?:"([^"]+)"|(\S+))', 'IgnoreCase')
        if (-not $match.Success) { continue }
        $dir = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
        foreach ($job in $jobs) {
            if ([string]::Equals($dir.TrimEnd('\'), $job.Path.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
                $proxyMatch = [regex]::Match($line, '--proxy-server=(?:"([^"]+)"|(\S+))', 'IgnoreCase')
                $activeProxy = if ($proxyMatch.Groups[1].Success) { $proxyMatch.Groups[1].Value } elseif ($proxyMatch.Groups[2].Success) { $proxyMatch.Groups[2].Value } else { '' }
                $debugMatch = [regex]::Match($line, '--remote-debugging-port=(\d+)', 'IgnoreCase')
                $result[$job.Name] = [pscustomobject]@{ Id = $process.ProcessId; Proxy = $activeProxy; DebugPort = $debugMatch.Groups[1].Value }
            }
        }
    }
    return $result
}

function Set-GridWindow($handle, $job) {
    if ([ChromeGridWin32]::IsIconic($handle) -or [ChromeGridWin32]::IsZoomed($handle)) {
        [ChromeGridWin32]::ShowWindowAsync($handle, 9) | Out-Null
        Start-Sleep -Milliseconds 100
    }
    $flags = 0x0004 -bor 0x0010 -bor 0x0040
    if (-not [ChromeGridWin32]::SetWindowPos($handle, [IntPtr]::Zero, $job.Left, $job.Top, $job.Width, $job.Height, $flags)) {
        return $false
    }
    # Correct the invisible Windows resize border so visible frames align.
    $outer = New-Object ChromeGridWin32+RECT
    $frame = New-Object ChromeGridWin32+RECT
    $ok = [ChromeGridWin32]::GetWindowRect($handle, [ref]$outer)
    $dwm = [ChromeGridWin32]::DwmGetWindowAttribute($handle, 9, [ref]$frame, [Runtime.InteropServices.Marshal]::SizeOf($frame))
    if ($ok -and $dwm -eq 0 -and $frame.Right -gt $frame.Left -and $frame.Bottom -gt $frame.Top) {
        $leftBorder = $frame.Left - $outer.Left
        $topBorder = $frame.Top - $outer.Top
        $rightBorder = $outer.Right - $frame.Right
        $bottomBorder = $outer.Bottom - $frame.Bottom
        if (-not [ChromeGridWin32]::SetWindowPos($handle, [IntPtr]::Zero, ($job.Left - $leftBorder), ($job.Top - $topBorder),
            ($job.Width + $leftBorder + $rightBorder), ($job.Height + $topBorder + $bottomBorder), $flags)) { return $false }
        Start-Sleep -Milliseconds 50
        $actual = New-Object ChromeGridWin32+RECT
        if ([ChromeGridWin32]::DwmGetWindowAttribute($handle, 9, [ref]$actual, [Runtime.InteropServices.Marshal]::SizeOf($actual)) -eq 0) {
            if ([Math]::Abs($actual.Left - $job.Left) -gt 3 -or [Math]::Abs($actual.Top - $job.Top) -gt 3 -or
                [Math]::Abs(($actual.Right - $actual.Left) - $job.Width) -gt 3 -or
                [Math]::Abs(($actual.Bottom - $actual.Top) - $job.Height) -gt 3) { return $false }
        }
    }
    return $true
}

$existing = Get-ProfileProcesses
$proxyConflicts = @()
foreach ($job in $jobs) {
    if (-not $existing.ContainsKey($job.Name)) { continue }
    $current = $existing[$job.Name].Proxy
    try { $current = Convert-Proxy $current 0 } catch { $current = '' }
    if (-not [string]::Equals($current, $job.Proxy, [StringComparison]::OrdinalIgnoreCase)) { $proxyConflicts += $job.Name }
}
if ($proxyConflicts.Count -gt 0) {
    throw ('Proxy changed or cannot be verified. Close these Chrome profiles first, then run again: ' + ($proxyConflicts -join ', '))
}
if ($Monitor) {
    $needRestart = @($jobs | Where-Object { $existing.ContainsKey($_.Name) -and $existing[$_.Name].DebugPort -ne [string]$_.DebugPort } | ForEach-Object { $_.Name })
    if ($needRestart.Count -gt 0) { throw ('Close these Chrome profiles and reopen them for monitoring: ' + ($needRestart -join ', ')) }
}
if ($CheckExisting) { Write-Host 'Existing profiles match the requested proxies.'; return }
$launchTotal = @($jobs | Where-Object { -not $existing.ContainsKey($_.Name) }).Count
$launchIndex = 0
foreach ($job in $jobs) {
    if ($existing.ContainsKey($job.Name)) {
        Write-Host "$($job.Name): already running; keeping the existing window and proxy."
        continue
    }
    if (-not (Test-Path -LiteralPath $job.Path)) { New-Item -ItemType Directory -Path $job.Path -Force | Out-Null }
    $arguments = @(
        ('--user-data-dir="{0}"' -f $job.Path),
        ('--proxy-server={0}' -f $job.Proxy),
        '--no-first-run', '--no-default-browser-check', '--mute-audio', '--force-device-scale-factor=0.75',
        ('--window-position={0},{1}' -f $job.Left, $job.Top),
        ('--window-size={0},{1}' -f $job.Width, $job.Height),
        '--new-window', $website
    )
    if ($Monitor) { $arguments += @('--remote-debugging-address=127.0.0.1', ('--remote-debugging-port={0}' -f $job.DebugPort)) }
    Start-Process -FilePath $chromePath -ArgumentList $arguments -WindowStyle Normal | Out-Null
    $launchIndex++
    if ($launchIndex -lt $launchTotal) {
        $delaySeconds = Get-Random -Minimum 1 -Maximum 11
        Write-Host "$($job.Name): waiting $delaySeconds seconds before launching the next profile."
        Start-Sleep -Seconds $delaySeconds
    }
}

$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline -and @($jobs | Where-Object { -not $_.Done }).Count -gt 0) {
    $running = Get-ProfileProcesses
    foreach ($job in $jobs | Where-Object { -not $_.Done }) {
        if (-not $running.ContainsKey($job.Name)) { continue }
        $process = Get-Process -Id $running[$job.Name].Id -ErrorAction SilentlyContinue
        if ($process -and $process.MainWindowHandle -ne [IntPtr]::Zero) {
            if (Set-GridWindow $process.MainWindowHandle $job) {
                $job.Done = $true
                Write-Host "$($job.Name): positioned."
            }
        }
    }
    if (@($jobs | Where-Object { -not $_.Done }).Count -gt 0) { Start-Sleep -Milliseconds 700 }
}

$missing = @($jobs | Where-Object { -not $_.Done })
if ($missing.Count -gt 0) {
    Write-Warning ('Could not locate or fit the window for: ' + (($missing | ForEach-Object Name) -join ', '))
    exit 1
} else {
    # Chrome can restore its previous position shortly after creating a window.
    Start-Sleep -Seconds 2
    $running = Get-ProfileProcesses
    $failedFinal = @()
    foreach ($job in $jobs) {
        if (-not $running.ContainsKey($job.Name)) { $failedFinal += $job.Name; continue }
        $process = Get-Process -Id $running[$job.Name].Id -ErrorAction SilentlyContinue
        if ($process -and $process.MainWindowHandle -ne [IntPtr]::Zero) {
            if (-not (Set-GridWindow $process.MainWindowHandle $job)) { $failedFinal += $job.Name }
        } else { $failedFinal += $job.Name }
    }
    if ($failedFinal.Count -gt 0) { Write-Warning ('Could not confirm final position: ' + ($failedFinal -join ', ')); exit 1 }
    Write-Host "All $ProfileCount Chrome windows are positioned."
}
