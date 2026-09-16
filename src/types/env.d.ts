// Type declarations for Expo public environment variables.
// Set these in your .env file with the EXPO_PUBLIC_ prefix.
// Expo's Metro bundler substitutes them at build time via process.env.
declare namespace NodeJS {
  interface ProcessEnv {
    /** Optional TomTom key — bounded cold-start traffic bridge only. */
    readonly EXPO_PUBLIC_TOMTOM_API_KEY?: string;
    /** Comma-separated URLs of free open traffic feeds (511 / DATEX II / NDW). */
    readonly EXPO_PUBLIC_OPEN_TRAFFIC_FEEDS?: string;
  }
}
