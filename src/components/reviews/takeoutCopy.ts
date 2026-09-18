/**
 * Shared copy for the Google Takeout flow, used by the reviews importer and
 * the onboarding step so both surfaces never drift apart.
 */

/** How to request the export (for users who haven't done it yet). */
export const TAKEOUT_REQUEST_STEPS: string[] = [
  'Open takeout.google.com and tap Deselect all.',
  'Tick the Maps checkbox, then Next step → Create export.',
  'Google emails you a download link, usually within a few hours.',
  'Download the zip and unzip it, then import from My Places.',
];

/** How to find Reviews.json inside an already-downloaded Takeout. */
export const REVIEWS_FILE_STEPS: string[] = [
  'Unzip the Takeout download Google emailed you.',
  'Open the Maps folder inside it.',
  'Choose the file named Reviews.json.',
];

/** Where both imports live after onboarding. */
export const IMPORT_LOCATION_HINT =
  'Both imports live under My Places → Import places (saved-place files) and Import Google reviews (Reviews.json).';
