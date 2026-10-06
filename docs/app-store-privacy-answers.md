# App Store Connect — App Privacy answers

Reference answers for the App Store Connect **App Privacy** questionnaire. These
must match `ios/PolarisMaps/PrivacyInfo.xcprivacy` and the published policy at
https://polarismaps.app/privacy.

## Data collection

**Do you or your third-party partners collect data from this app?** Yes.

## Tracking

**Do you use data for tracking?** No.

- No data is linked with third-party data for targeted advertising or shared with
  data brokers.
- `NSPrivacyTracking = false`; no `NSPrivacyTrackingDomains`.
- No advertising or analytics SDKs are present.

## Data types

Declare the following under **Data Linked to You** / **Data Not Linked to You**:

| Apple data type                     | Collected | Linked to you | Used for tracking | Purposes          |
| ----------------------------------- | --------- | ------------- | ----------------- | ----------------- |
| Location → Precise Location         | Yes       | **No**        | No                | App Functionality |
| Photos or Videos → Photos or Videos | Yes       | **Yes**       | No                | App Functionality |
| User Content → Other User Content   | Yes       | **Yes**       | No                | App Functionality |
| Identifiers → User ID               | Yes       | **Yes**       | No                | App Functionality |

Notes:

- **Precise Location — not linked.** Traffic probes use a random ID that rotates
  hourly and carry no account or device identifier. Location is additionally sent
  to the optional TomTom traffic service as a functional data processor.
- **Photos or Videos — linked.** Street-level imagery and review photos are only
  uploaded when the user enables Imagery Sharing / Review Photo Sharing, and are
  attributed to the signed-in account when applicable.
- **Other User Content — linked.** Place reviews (AT Protocol), OpenStreetMap
  edits, and incident reports.
- **User ID — linked.** Bluesky handle/DID and OpenStreetMap username, only when
  the user signs in.

### Possibly required (reviewer judgement)

- **Search History.** Search queries are sent to geocoding providers
  (Photon / Overture / Nominatim) to return results, but are not retained by us
  or linked to an identity. If you prefer to be conservative, declare
  **Search History → Not Linked → App Functionality**.

## Data not collected

All other categories — Contacts, Health & Fitness, Financial Info, Browsing
History, Usage Data, Diagnostics, Purchases, etc. — are **not collected**.

## Manual follow-ups

- Replace `<DATE>` and `<CONTACT EMAIL>` in
  `docs/privacy-policy.md`, `netlify-deploy/privacy/index.html`, and
  `netlify-deploy/terms/index.html`.
- Publish the pages so https://polarismaps.app/privacy and
  https://polarismaps.app/terms resolve, then confirm the App Store Connect
  **Privacy Policy URL** field points at the former.
