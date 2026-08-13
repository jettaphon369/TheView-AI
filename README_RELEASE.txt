CHEE CHAN STOCK MAIN 34.29.51-STOCK-STRUCTURE-EDIT-DELETE

Release: v34.29.51-STOCK-STRUCTURE-EDIT-DELETE

Changes
- Added “แก้ชื่อ” for stock groups and stock areas while preserving the original ID.
- Renaming automatically refreshes denormalized stock location names on assigned product records.
- Added safe delete for stock areas/groups that have no products assigned.
- Delete is blocked when products are still assigned, with a clear message to rename or move products first.
- The main/default F&B group cannot be deleted, but it can be renamed.
- Added product usage counts and mobile-friendly action buttons in Stock Structure Manager.
- Includes previous v34.29.50 PC sidebar brand-balance fix.

Upload notes
- Recommended: upload the full release package.
- Minimum changed files: app.js, main.css, index.html, service-worker.js, VERSION.txt, VERSION_CHECK.html, README_RELEASE.txt.
- After deploy, open reset.html once if an older cached UI is still shown.

R2 display/cache correction:
- Profile version badge now shows v34.29.51 MAIN.
- Fresh CSS/JS + Service Worker cache key prevents the old v34.29.50 label from persisting.
