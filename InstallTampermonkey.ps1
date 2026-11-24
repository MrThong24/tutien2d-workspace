$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$baseDir = "D:\Auto\ChromeProxy"
$scriptUrl = "file:///D:/Auto/tutien2d.user.js"

for ($i = 1; $i -le 10; $i++) {
    $profileName = "Profile{0:D2}" -f $i
    $profilePath = Join-Path $baseDir $profileName

    Start-Process -FilePath $chromePath -ArgumentList @(
        "--user-data-dir=`"$profilePath`""
        $scriptUrl
    )

    Start-Sleep -Seconds 1
}