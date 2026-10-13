/**
 * Injected-before-content scripts shared by the app's hidden WebViews.
 *
 * `GEOLOCATION_GUARD_JS` exists because third-party pages loaded by the hidden
 * scrapers (TripAdvisor, Yelp, venue websites) call `navigator.geolocation` on
 * load. On iOS the platform WebView answers that call with a per-origin system
 * prompt naming the page ("…www.tripadvisor.com… would like to use your current
 * location"), which a headless scrape must never show. The guard runs at
 * document start — the only point early enough to precede the page's own
 * scripts — and makes the Geolocation API behave as if the user denied it:
 * position requests fail immediately with `PERMISSION_DENIED` and
 * `navigator.permissions.query({ name: 'geolocation' })` reports `denied`, so
 * the page's request never reaches WebKit and no prompt is raised.
 *
 * This only takes access away; it never fabricates a granted or human-like
 * state (`headless-browse-policy`), and is equivalent to the user tapping
 * "Don't Allow". Extraction reads the DOM (JSON-LD / `data-automation` / image
 * tags) only, so nothing scraped depends on device location.
 *
 * ES5-safe: it is evaluated inside third-party pages.
 */
export const GEOLOCATION_GUARD_JS = `(function () {
  try {
    var geo = navigator.geolocation;
    if (geo) {
      var deny = function (success, error) {
        if (typeof error === 'function') {
          setTimeout(function () {
            error({ code: 1, message: 'User denied Geolocation' });
          }, 0);
        }
      };
      geo.getCurrentPosition = function (success, error) { deny(success, error); };
      geo.watchPosition = function (success, error) { deny(success, error); return 0; };
      geo.clearWatch = function () {};
    }
    var permissions = navigator.permissions;
    if (permissions && typeof permissions.query === 'function') {
      var originalQuery = permissions.query;
      permissions.query = function (descriptor) {
        if (descriptor && descriptor.name === 'geolocation') {
          return Promise.resolve({ state: 'denied', onchange: null });
        }
        return originalQuery.apply(permissions, arguments);
      };
    }
  } catch (e) {}
  return true;
})();`;
