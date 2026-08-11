CHEE CHAN STOCK MAIN 34.29.50-PC-BRAND-BALANCE

Release: v34.29.50-PC-BRAND-BALANCE

PC Sidebar Brand Balance Fix:
- Re-centered the CHEE CHAN logo/title/subtitle as one visual group.
- Increased desktop brand header height from 180px to 196px for balanced top/bottom breathing room.
- Reduced oversized PC readability overrides that were pushing the subtitle against the lower edge.
- Kept mobile layout and stock/Firebase/business logic unchanged.

Focus:
- Final QA packaging before MAIN-ready release.
- No new stock/Firebase/business logic in this release.
- Refresh version/cache after manual cleanup and PC/mobile polish.
- Add final pre-MAIN QA checklist for Login, Stock, Receive/Issue, Approval, Issue Return, History, Reports, QR Print, Manual and Cache reset.

Deployment:
- Upload this ZIP root to Cloudflare Pages.
- Open /reset.html once after deployment to clear cache.
- Test TEST build first. If all checklist items pass on real devices, promote MAIN build.
