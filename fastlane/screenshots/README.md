# Screenshots

App Store screenshots are not committed here (they are large binaries). Capture
and upload them before submission.

## Required sizes

| Device                   | Size (portrait) | Required | Notes                        |
| ------------------------ | --------------- | -------- | ---------------------------- |
| iPhone 6.9" (16 Pro Max) | 1320 × 2868     | Yes      | Primary                      |
| iPhone 6.5"              | 1284 × 2778     | Yes\*    | \*May be satisfied by 6.9"   |
| iPad 13"                 | 2064 × 2752     | **Yes**  | `ios.supportsTablet` is true |

At least one iPhone size and the iPad size are required. Up to 10 per size.

## Suggested shots

1. Map with live traffic overlay + coverage badge
2. Turn-by-turn navigation with maneuver banner
3. Place search results
4. Transit trip planning / departures
5. Offline region download
6. Incident report or incident-ahead warning banner
7. Street-level imagery viewer

## Capture

Use an iOS simulator (`pnpm ios`) and Cmd-S for each screen, or script it with
[`snapshot`](https://docs.fastlane.tools/actions/snapshot/). Then upload:

```bash
bundle exec fastlane deliver --skip_binary_upload true --skip_metadata true
```
