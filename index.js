// crypto.getRandomValues polyfill — must be the very first import.
// Required by @noble/curves and Gun.js SEA on Hermes (Hermes does not
// implement crypto.getRandomValues natively).
import 'react-native-get-random-values';

// URL polyfill — required by @atproto/oauth-client-expo on React Native.
import 'react-native-url-polyfill/auto';

// Hand off to Expo Router's standard entry point.
import 'expo-router/entry';
