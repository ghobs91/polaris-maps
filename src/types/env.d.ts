// Type declarations for Expo public environment variables.
// Set these in your .env file with the EXPO_PUBLIC_ prefix.
// Expo's Metro bundler substitutes them at build time via process.env.
declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_TOMTOM_API_KEY?: string;
    readonly EXPO_PUBLIC_HERE_API_KEY?: string;
  }
}
