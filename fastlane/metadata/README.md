# fastlane/metadata

App Store listing content for Polaris Maps (iOS). Edit the `.txt` files in
`en-US/` and upload with Fastlane `deliver` (or paste into App Store Connect).

## Files

| File                         | Limit      | Notes                                          |
| ---------------------------- | ---------- | ---------------------------------------------- |
| `en-US/name.txt`             | 30 chars   | App name — must be unique in App Store Connect |
| `en-US/subtitle.txt`         | 30 chars   | Shown under the name                           |
| `en-US/keywords.txt`         | 100 chars  | Comma-separated, no spaces around commas       |
| `en-US/promotional_text.txt` | 170 chars  | Editable without a new build                   |
| `en-US/description.txt`      | 4000 chars | Full listing description                       |
| `en-US/release_notes.txt`    | 4000 chars | "What's New"                                   |
| `en-US/support_url.txt`      | —          | Required                                       |
| `en-US/marketing_url.txt`    | —          | Optional                                       |
| `en-US/privacy_url.txt`      | —          | **Must** resolve (see the checklist)           |
| `copyright.txt`              | —          | Replace the placeholder with your legal name   |

## Still to fill in

`review_information/` holds review contact details. Add these files (or let
`deliver` prompt for them):

- `first_name.txt`, `last_name.txt`
- `email_address.txt`, `phone_number.txt`

`review_information/notes.txt` is already written and explains the P2P/optional
permissions to the reviewer.

Screenshots are **not** stored here; see `fastlane/screenshots/README.md`.

## Uploading

The `ios release` lane deliberately runs with `skip_metadata: true` and
`skip_screenshots: true`, so listing content is never pushed automatically.
Upload it explicitly when you are ready:

```bash
bundle exec fastlane deliver --skip_binary_upload true --skip_screenshots true
```
