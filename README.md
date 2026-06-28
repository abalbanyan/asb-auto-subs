# ASB Auto Subs

ASB Auto Subs automatically finds Japanese subtitle files from [Jimaku](https://jimaku.cc) for the anime episode you are watching. It downloads the selected subtitle file and loads supported subtitle formats directly into [ASB Player](https://github.com/killergerbah/asbplayer).

This version is forked from [GodPepe7/asb-auto-subs](https://github.com/GodPepe7/asb-auto-subs).

## Features

- Detects the current anime series and episode on Crunchyroll.
- Handles Crunchyroll episode changes without requiring a full page reload.
- Resolves Crunchyroll seasons separately so later seasons use the correct Jimaku entry.
- Downloads matching subtitle files from Jimaku automatically.
- Loads supported subtitle files directly into ASB Player when available.
- Supports saved per-series filename filters for choosing a preferred subtitle release.
- Supports disabling downloads for a specific series.
- Supports temporarily disabling the extension globally.
- Deletes the previously downloaded subtitle file automatically by default.

## Setup

1. Install [ASB Player](https://github.com/killergerbah/asbplayer).
2. Download and unzip this extension, or build it locally.
3. Open `chrome://extensions/` in Chrome.
4. Enable Developer mode.
5. Click Load unpacked and select this project folder.
6. Create a [Jimaku account](https://jimaku.cc/login) and generate an [API key](https://jimaku.cc/account).
7. Open the pinned extension popup, enter the API key, and click Set.
8. Open an anime episode on Crunchyroll.

The extension popup shows the currently detected series and episode. Use Saved filters to select a preferred subtitle filename pattern for a series.

## Build Locally

Prerequisite: Node 20 LTS.

```powershell
npm install
npm run build
Copy-Item .\chrome-manifest.json .\manifest.json -Force
```

After rebuilding, reload the unpacked extension from `chrome://extensions/`.
