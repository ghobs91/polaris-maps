# OSM Editing

Direct OpenStreetMap editing with OAuth 2.0 + PKCE authentication and changeset management via OSM API v0.6.

## Overview

The OSM editing service enables users to directly contribute edits to OpenStreetMap from within the app:

1. **OAuth 2.0 + PKCE** — authentication via expo-web-browser targeting the `write_api` scope. Tokens are persisted in `expo-secure-store`.
2. **Node editing** — fetch the current state of an OSM node, apply field-level edits (name, phone, website, opening hours, cuisine, wheelchair access, Wi-Fi, outdoor seating, etc.), and submit as a changeset.
3. **Changeset lifecycle** — create changeset → update elements → close changeset, using OSM API v0.6 with OAuth 2.0 Bearer token authentication.

## Files

| File                | Description                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `osmAuthService.ts` | OSM OAuth 2.0 authentication using Authorization Code + PKCE flow via expo-web-browser. Tokens stored in `expo-secure-store` for the `write_api` scope. |
| `osmEditService.ts` | OSM API v0.6 editing client — fetches current node state, creates changesets, updates elements, and closes changesets using Bearer token auth.          |

## Edit Flow

```
User taps "Edit on OSM"
    ↓
osmAuthService.ts → OAuth 2.0 + PKCE login (if not authenticated)
    ↓
osmEditService.ts → fetch current node from OSM API
    ↓
Edit form (10+ fields: name, phone, website, hours, cuisine, etc.)
    ↓
osmEditService.ts:
    1. Create changeset
    2. Update node with new tags
    3. Close changeset
    ↓
Changes live on OpenStreetMap
```

## Related Files

- [`app/poi/osm-edit.tsx`](../../../app/poi/osm-edit.tsx) — OSM node editing screen with field form and changeset submission
- [`src/stores/osmAuthStore.ts`](../../stores/osmAuthStore.ts) — OAuth token persistence (SecureStore), user profile, login/logout/validation
