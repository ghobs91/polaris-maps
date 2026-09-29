import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text } from 'react-native';
import splashIcon from '../../../assets/images/splash-icon.png';

// Matches `expo-splash-screen.backgroundColor` in app.json and the app icon's
// own background, so the native launch frame and this overlay are seamless.
const BACKGROUND = '#171A21';
// Mirrors the native launch image width (expo-splash-screen `imageWidth`, default 100)
// so the icon does not jump between the native frame and this overlay.
const ICON_SIZE = 100;
const HOLD_MS = 500;
const FADE_MS = 400;

/**
 * Branded cold-open splash: the app icon with the app name beneath it on a dark
 * gray background. Rendered above the app until the first frame is painted, then
 * faded out. The native launch screen shows the same icon and background, so the
 * hand-off is invisible.
 */
export function ColdOpenSplash() {
  const opacity = useRef(new Animated.Value(1)).current;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      delay: HOLD_MS,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) setDismissed(true);
    });
    return () => animation.stop();
  }, [opacity]);

  if (dismissed) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <Image source={splashIcon} style={styles.icon} resizeMode="contain" />
      <Text style={styles.name}>Polaris Maps</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BACKGROUND,
    zIndex: 100,
    elevation: 100,
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
  },
  name: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: ICON_SIZE / 2 + 12,
    textAlign: 'center',
    color: '#F2F2F7',
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
