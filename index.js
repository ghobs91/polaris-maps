// crypto.getRandomValues polyfill — must be the very first import.
// Required by @noble/curves and Gun.js SEA on Hermes (Hermes does not
// implement crypto.getRandomValues natively).
import 'react-native-get-random-values';

// URL polyfill — required by @atproto/oauth-client-expo on React Native.
import 'react-native-url-polyfill/auto';

// Register the iOS background-location task in the global scope. expo-task-manager
// requires tasks to be defined when the JS bundle loads — on a headless launch
// (iOS relaunching the app to deliver a location fix) the Expo Router root is not
// mounted, so relying on a route module to register it leaves the task undefined.
import './src/services/navigation/backgroundLocationTask';

// Hand off to Expo Router's standard entry point.
import 'expo-router/entry';
