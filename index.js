// crypto.getRandomValues polyfill — must be the very first import.
// Required by @noble/curves and Gun.js SEA on Hermes (Hermes does not
// implement crypto.getRandomValues natively).
import 'react-native-get-random-values';

// Gesture Handler must be imported before any gesture-using module is loaded.
import 'react-native-gesture-handler';

// URL polyfill — required by @atproto/oauth-client-expo on React Native.
import 'react-native-url-polyfill/auto';

// AbortSignal.throwIfAborted polyfill — RN ships abort-controller@3, which
// lacks it; @atproto's OAuth client calls it while resolving the identity after
// the browser authorization step. Must load before the app's @atproto code.
import './src/polyfills/abortSignal';

// Register the iOS background-location task in the global scope. expo-task-manager
// requires tasks to be defined when the JS bundle loads — on a headless launch
// (iOS relaunching the app to deliver a location fix) the Expo Router root is not
// mounted, so relying on a route module to register it leaves the task undefined.
import './src/services/navigation/backgroundLocationTask';

// Boot CarPlay from the bundle, not a React effect: a CarPlay cold launch has no
// phone window, where React effects and timers never run (see `bootCarPlay`).
import { bootCarPlay } from './src/services/carplay/bootCarPlay';

// Same reason, for a trip started from CarPlay: the headless navigation
// lifecycle (tracking pipeline, voice, arrival, fix-driven refresh) is otherwise
// only subscribed by an `app/_layout.tsx` effect that never runs without a phone
// window, so CarPlay would show the route but never move.
import { bootNavigation } from './src/services/navigation/bootNavigation';

// Hand off to Expo Router's standard entry point.
import 'expo-router/entry';

// Subscribe the CarPlay manager now, while the bundle is being evaluated.
bootCarPlay();

// Start the headless navigation lifecycle too, so a trip started from CarPlay on
// a cold launch tracks (and speaks/arrives) without the phone app ever opening.
bootNavigation();
