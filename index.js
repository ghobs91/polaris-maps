// crypto.getRandomValues polyfill — must be the very first import.
// Required by @noble/curves and Gun.js SEA on Hermes (Hermes does not
// implement crypto.getRandomValues natively).
import 'react-native-get-random-values';

// Hand off to Expo Router's standard entry point.
import 'expo-router/entry';
