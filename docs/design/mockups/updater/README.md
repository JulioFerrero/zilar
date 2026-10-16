# Android updater (approved 2026-10-16)

Julio asked for an in-app updater ("check for new version if new download and prompt to install"). He approved these boards as drawn on the Android updater canvas (https://claude.ai/artifact/AMYshRxWEz3Ur5F9wAbNvQ), and chose a **quiet download on Wi-Fi, asking first on mobile data**. The canvas is private, so these files are the copy workers read. They are D24 only (`docs/design/ui-style.md`) and Android only: the web updates itself, and iOS installs from the store.

## Boards
- **`PhoneUpdateReady.dc.html`**: on Wi-Fi the update downloaded quietly; now the app asks.
  - A centered dialog in the kit `ConfirmDialog` shape, over the dimmed screen.
  - A download icon tile, the title "Zilar 0.2.4 is ready", and a mono line "0.2.3 → 0.2.4 · 67 MB".
  - The line "Install now? Your chats stay as they are."
  - **Later** (ghost) and **Install** (primary).
- **`PhoneMobileData.dc.html`**: on mobile data the app asks before downloading.
  - The title "Update to Zilar 0.2.4", the same mono line, and "You're on mobile data. Download now?"
  - **Later** and **Download**.
- **`PhoneDownloading.dc.html`**: after Download.
  - The title "Downloading 0.2.4", a mono "41 of 67 MB", and a recessed progress well with the accent fill.
  - **Cancel**.
  - When the download finishes, the dialog becomes the "ready" one.
- **`PhoneSettingsUpToDate.dc.html`**: a new **This app** group in Settings, just above Sign out.
  - One row: a phone icon tile, "Zilar 0.2.3" (the version in mono), and "Up to date · checked 13:02".
  - A **Check for updates** icon key (refresh).
- **`PhoneSettingsUpdate.dc.html`**: the same row when an update is ready.
  - A white dot, "Zilar 0.2.4 is ready", the line "0.2.3 installed · 67 MB", and a primary **Install** button.
  - While a download runs, the row shows its progress.

## Behaviour
- **When it checks:** on open and when the app comes back, at most every 6 hours.
- **Later** hides that version for 24 hours. A newer version shows anyway.
- **Install** opens Android's own installer. The first time only, Android asks to allow installs from Zilar.
- **Off** in dev builds and in local builds (no `versionCode`).
- **Kit sizes:** the phone `IconButton` is 40 px with a 12 px radius, and the `IconTile` is 34 px with a 10 px radius.
