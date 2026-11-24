# Tu Tiên 2D automation workspace

This repository contains the ChromeGrid desktop app and the TuTien2D userscript project.

## Projects

- `ChromeGridApp/` — Windows desktop source and build script.
- `tutien2d-automation/` — userscript source, distributable scripts, installer scripts, docs, and build files.
- `StartChrome-10.ps1` — Chrome profile launch and window layout script used by ChromeGridApp.
- `Mo-Chrome-20-mot-man-hinh-stats-2.0.33.exe` — latest built desktop app included for convenience.

## Build

From PowerShell on Windows:

```powershell
Set-Location D:\Auto\ChromeGridApp
.\build.ps1 -OutputName 'Mo-Chrome-20-mot-man-hinh-stats.exe'
```

Build the userscripts from `D:\Auto\tutien2d-automation` with:

```powershell
npm run build
```

## Machine-specific data

Chrome profile folders, browser sessions, local proxy assignments, and account stores are intentionally excluded. Account and proxy data are protected with Windows DPAPI and cannot be reused on another Windows account or machine. Re-enter those values on the new machine and sign in to Chrome/game profiles there.

The userscript installer helpers expect the workspace at `D:\Auto` and use local Chrome debugging ports. Update those paths if the repository is cloned elsewhere.
