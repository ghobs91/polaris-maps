import { useWindowDimensions } from 'react-native';
import { LARGE_DISPLAY_BREAKPOINT } from '../constants/layout';

export function useIsLargeDisplay(): boolean {
  const { width } = useWindowDimensions();
  return width >= LARGE_DISPLAY_BREAKPOINT;
}
