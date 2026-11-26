# Wolf Hall backups: a monthly copy in Google Drive

Horace, 2026-11-23 (round 17, answer 17A): keep a monthly copy of the Notion backup in his Google Drive, the free way.

- Every night after 3 AM the Oracle saves every Wolf Hall database to `C:\Users\Owner\Documents\Wolf Hall backups\YYYY-MM-DD\` and keeps 14 days (about 7 MB a night). Those day folders stay on the PC.
- Since Night Shift #120 (11/24), the first complete backup of each month (normally the 1st) is also copied to `Wolf Hall backups\monthly\YYYY-MM\` and kept 12 months (about 90 MB in all). The first one appears the first night after the change goes live (as `monthly\2026-11`).
- Only the `monthly` folder goes to Drive, through Google Drive for desktop (already installed on this PC). Nothing is uploaded by the Oracle itself.

## Setup (Horace, once, about 2 minutes)

1. Wait until the folder `C:\Users\Owner\Documents\Wolf Hall backups\monthly` exists (the morning after the change is live).
2. Click the Google Drive icon in the taskbar tray (bottom right; it may be under the ^ arrow). If it asks, sign in as hall.horace@gmail.com.
3. Click the gear, then **Preferences**.
4. On the left, click **Folders from your computer** (older versions call it **My Computer**), then **Add folder**.
5. Pick `Documents\Wolf Hall backups\monthly` (the monthly folder, not the whole backups folder) and click **Select Folder**.
6. Choose **Sync with Google Drive**, then **Done**, then **Save**.
7. Check it: open drive.google.com, click **Computers** on the left, then this PC. The `monthly` folder should be there.

Deleting an old month on the PC also removes it from Drive (after Drive's own 30-day trash), so Drive keeps the same 12 months.

## Good to know

- The files are plain JSON with household money records. Drive is private to Horace's account; don't share the folder.
- The Jake-Taylor private chat and phone push keys are never in the backup.
- To restore a row, see the README.md in the backups folder.
