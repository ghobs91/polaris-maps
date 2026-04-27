import { useWindowDimensions } from 'react-native';

const LARGE_DISPLAY_BREAKPOINT = 768;

export function useIsLargeDisplay(): boolean {
  const { width } = useWindowDimensions();
  return width >= LARGE_DISPLAY_BREAKPOINT;
}
