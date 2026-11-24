
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$baseDir = "D:\Auto\ChromeProxy"
$website = "https://tutien2d.com/?choi"

$proxies = @(
    "104.207.34.75:3129",
    "65.111.27.161:3129",
    "216.26.250.254:3129",
    "104.207.58.254:3129",
    "209.50.174.142:3129",
    "209.50.174.142:3129",
    "104.167.19.211:3129",
    "104.167.19.211:3129",
    "45.3.36.162:3129",
    "45.3.36.162:3129"
)

if (!(Test-Path $chromePath)) {
    Write-Host "Chrome not found!"
    exit
}

for ($i = 1; $i -le 10; $i++) {
    $profileName = "Profile{0:D2}" -f $i
    $profilePath = Join-Path $baseDir $profileName
    $proxy = $proxies[($i - 1)]

    New-Item -ItemType Directory -Force -Path $profilePath | Out-Null

    Start-Process -FilePath $chromePath -ArgumentList @(
        "--user-data-dir=`"$profilePath`""
        "--proxy-server=http://$proxy"
        "--no-first-run"
        "--no-default-browser-check"
        "--new-window"
        "--window-size=400,300"
        "--force-device-scale-factor=0.75"
        "--disable-smooth-scrolling"
        "--disable-extensions-http-throttling"
        "--disable-background-networking"
        "--disable-component-update"
        "--disable-sync"
        "--disable-default-apps"
        "--disable-translate"
        "--disable-breakpad"
        "--disable-notifications"
        "--mute-audio"
        $website
    )

    Write-Host "$profileName --> $proxy" -ForegroundColor Green
    Start-Sleep -Seconds 2
}

Write-Host "Completed!" -ForegroundColor Cyan
