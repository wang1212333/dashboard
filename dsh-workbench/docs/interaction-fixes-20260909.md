# Workbench interaction fixes — 2026-09-09

Backup baseline: `8b546d85cb76936bbf03e5e7e85c9c184290773a` on `codex/backup-before-interaction-fixes-20260909`.

This integration preserves the native DSH session execution and rendering path, the direct-open dashboard behavior, and the updated draft delivery card above the composer.

## Changes

- Race-safe template cancellation and stale attachment-popover navigation protection.
- Real draft/publication/version metadata, version history dialog and guarded source-session navigation.
- Eight-item pagination in card and list views; filter clearing and host route restoration.
- Persistent browser-local favorites and explicit unavailable labels for unconnected capabilities.
- Native public-message export for conversation sharing; private context, reasoning, tools and attachments excluded.
- Upload failure retention and file-only prompt fallback; explicit draft preview errors.
- Responsive history-sidebar hiding at narrow embedded widths.

## Verification

`pnpm build`, `pnpm build:dashboard`, 119 project tests and 5 sharing tests passed. The existing local DSH web service on port 3080 was restarted with the integrated build. Served HTML was checked for the final fixes.

Actual UI checks covered 1440×900 four-column/two-row layout, 1024×900 two-column layout with hidden narrow history, popover-to-dashboard navigation, page-two list refresh and an existing native conversation render. Prior checks covered real template cancellation, revision history and native conversation share preview.

No business dashboards were deleted or published, no external share was created or sent, and no new model task was submitted during final verification. Missing historical smoke assets remain a data-recovery issue; unavailable knowledge/subscription/agent integrations are labeled unavailable, not implemented by this change.

For recovery, use the backup branch in a separate fresh checkout and rebuild. Do not force-reset a working tree containing later changes. The source backup does not include the external DSH runtime asset library.
