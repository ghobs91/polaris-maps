import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sheet as sheetTokens } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { resolveSheetSnap, snapTopsForFractions } from '../../utils/sheetSnap';
import { hapticSelection, hapticWarning } from '../../utils/haptics';

const SCREEN_HEIGHT = Dimensions.get('window').height;

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Height fractions of the screen, ascending. Defaults to the sheet tokens. */
  snapPoints?: readonly number[];
  /** Index of the resting snap point. Defaults to the largest snap. */
  initialSnapIndex?: number;
  /** Controlled snap index. When set, the parent owns it and `onSnapChange` fires. */
  snapIndex?: number;
  /** Fired when the active snap point changes (drag, handle tap, or controlled). */
  onSnapChange?: (index: number) => void;
  /** Whether dragging down or tapping the backdrop dismisses. Default true. */
  dismissable?: boolean;
  /** Dim the content behind the sheet. Default true. */
  showBackdrop?: boolean;
  /** Render the drag handle (and its tap-to-cycle gesture). Default true. */
  showHandle?: boolean;
  /** Extra style for the sheet surface (e.g. transparency or radius). */
  surfaceStyle?: StyleProp<ViewStyle>;
  testID?: string;
  children: React.ReactNode;
}

/**
 * Shared Reanimated + Gesture Handler bottom sheet. Snap points, dismiss
 * thresholds, and the spring config come from the `sheet` design tokens so all
 * migrated sheets behave identically.
 *
 * Drag the handle to change snap / dismiss, tap the handle to cycle snap
 * points, tap the backdrop to dismiss. Content scrolls independently, so no
 * gesture conflict with inner lists. Pass `snapIndex` to drive the snap from
 * the parent (e.g. a card that toggles between peek and expanded).
 */
export function BottomSheet({
  visible,
  onClose,
  snapPoints,
  initialSnapIndex,
  snapIndex,
  onSnapChange,
  dismissable = true,
  showBackdrop = true,
  showHandle = true,
  surfaceStyle,
  testID,
  children,
}: BottomSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const fractions = useMemo(
    () => snapPoints ?? [sheetTokens.snapSmall, sheetTokens.snapMedium, sheetTokens.snapLarge],
    [snapPoints],
  );
  const snapTops = useMemo(() => snapTopsForFractions(fractions, SCREEN_HEIGHT), [fractions]);
  const controlled = snapIndex !== undefined;
  const [internalIndex, setInternalIndex] = useState(initialSnapIndex ?? fractions.length - 1);
  const activeIndex = controlled ? Math.min(snapIndex, fractions.length - 1) : internalIndex;
  const restingHeight = fractions[activeIndex] * SCREEN_HEIGHT;

  const height = useSharedValue(restingHeight);
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const dragStart = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      height.value = withSpring(restingHeight, sheetTokens.spring);
      translateY.value = withSpring(0, sheetTokens.spring);
    } else {
      translateY.value = withSpring(SCREEN_HEIGHT, sheetTokens.spring);
    }
  }, [visible, restingHeight, height, translateY]);

  // Report a snap change from either the gesture (worklet) or the handle tap.
  const commitSnap = useCallback(
    (index: number) => {
      if (index === activeIndex) return;
      if (!controlled) setInternalIndex(index);
      onSnapChange?.(index);
    },
    [activeIndex, controlled, onSnapChange],
  );

  const toggleSnap = useCallback(() => {
    commitSnap((activeIndex + 1) % fractions.length);
  }, [activeIndex, commitSnap, fractions.length]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(visible)
        .onStart(() => {
          dragStart.value = translateY.value;
        })
        .onUpdate((event) => {
          translateY.value = Math.max(0, dragStart.value + event.translationY);
        })
        .onEnd((event) => {
          if (!dismissable) {
            translateY.value = withSpring(0, sheetTokens.spring);
            return;
          }
          const topEdge = SCREEN_HEIGHT - height.value + translateY.value;
          const result = resolveSheetSnap({
            currentTop: topEdge,
            snapTops,
            velocityY: event.velocityY,
            screenHeight: SCREEN_HEIGHT,
            dismissVelocity: sheetTokens.dismissVelocity,
            dismissFraction: sheetTokens.dismissFraction,
            projectionSeconds: sheetTokens.projectionSeconds,
          });
          if (result.dismiss) {
            translateY.value = withSpring(SCREEN_HEIGHT, sheetTokens.spring);
            runOnJS(hapticWarning)();
            runOnJS(onClose)();
          } else {
            height.value = withSpring(fractions[result.index] * SCREEN_HEIGHT, sheetTokens.spring);
            translateY.value = withSpring(0, sheetTokens.spring);
            runOnJS(hapticSelection)();
            runOnJS(commitSnap)(result.index);
          }
        }),
    [snapTops, fractions, dismissable, visible, onClose, commitSnap, height, translateY, dragStart],
  );

  const handleTap = useMemo(
    () =>
      Gesture.Tap()
        .enabled(visible)
        .onEnd(() => runOnJS(toggleSnap)()),
    [visible, toggleSnap],
  );

  const handleGesture = useMemo(() => Gesture.Exclusive(pan, handleTap), [pan, handleTap]);

  const sheetStyle = useAnimatedStyle(() => ({
    height: height.value,
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => {
    const topEdge = SCREEN_HEIGHT - height.value + translateY.value;
    return {
      opacity: interpolate(
        topEdge,
        [0, SCREEN_HEIGHT],
        [sheetTokens.backdropOpacity, 0],
        Extrapolation.CLAMP,
      ),
    };
  });

  return (
    <>
      {showBackdrop ? (
        <Animated.View
          style={[styles.backdrop, backdropStyle]}
          pointerEvents={visible ? 'auto' : 'none'}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismissable ? onClose : undefined}
            accessibilityRole="button"
            accessibilityLabel="Close sheet"
          />
        </Animated.View>
      ) : null}
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: colors.surface, paddingBottom: insets.bottom },
          surfaceStyle,
          sheetStyle,
        ]}
        pointerEvents={visible ? 'auto' : 'none'}
        testID={testID}
      >
        {showHandle ? (
          <GestureDetector gesture={handleGesture}>
            <View
              style={styles.handleArea}
              accessibilityRole="adjustable"
              accessibilityLabel="Sheet handle"
              accessibilityHint="Drag or tap to change the sheet size"
            >
              <View style={[styles.handle, { backgroundColor: colors.border }]} />
            </View>
          </GestureDetector>
        ) : null}
        <View style={styles.content}>{children}</View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  handle: {
    width: sheetTokens.handle.width,
    height: sheetTokens.handle.height,
    borderRadius: sheetTokens.handle.borderRadius,
  },
  content: { flex: 1 },
});
