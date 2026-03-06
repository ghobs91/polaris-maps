/**
 * Performance budgets and validation utilities per constitution requirements:
 * - 60fps map rendering (pan/zoom)
 * - <2s route computation (up to 100km)
 * - <5s cold launch to interactive map
 * - <300MB foreground memory, <50MB background
 * - <5% battery per hour background
 */

export const PERFORMANCE_BUDGETS = {
  /** Minimum acceptable frame rate during map interaction */
  MIN_FPS: 60,
  /** Frame drop threshold treated as P1 bug */
  CRITICAL_FPS: 30,
  /** Maximum route computation time in ms for distances up to 100km */
  MAX_ROUTE_COMPUTATION_MS: 2000,
  /** Maximum cold launch to interactive map in ms */
  MAX_COLD_LAUNCH_MS: 5000,
  /** Maximum warm launch to interactive map in ms */
  MAX_WARM_LAUNCH_MS: 2000,
  /** Maximum foreground memory in MB */
  MAX_FOREGROUND_MEMORY_MB: 300,
  /** Maximum background memory in MB */
  MAX_BACKGROUND_MEMORY_MB: 50,
  /** Maximum battery drain per hour for background operations (%) */
  MAX_BATTERY_PCT_PER_HOUR: 5,
  /** Maximum map interaction response time in ms */
  MAX_INTERACTION_LATENCY_MS: 100,
  /** Maximum time before visual feedback appears in ms */
  MAX_FEEDBACK_LATENCY_MS: 200,
} as const;

export interface PerformanceMeasurement {
  metric: keyof typeof PERFORMANCE_BUDGETS;
  value: number;
  budget: number;
  pass: boolean;
  timestamp: number;
}

export function measureAgainstBudget(
  metric: keyof typeof PERFORMANCE_BUDGETS,
  value: number,
): PerformanceMeasurement {
  const budget = PERFORMANCE_BUDGETS[metric];
  const isMinMetric = metric === 'MIN_FPS' || metric === 'CRITICAL_FPS';
  const pass = isMinMetric ? value >= budget : value <= budget;
  return { metric, value, budget, pass, timestamp: Date.now() };
}

/** Simple timing helper for measuring async operation duration */
export async function timeOperation<T>(
  operation: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await operation();
  return { result, durationMs: performance.now() - start };
}
