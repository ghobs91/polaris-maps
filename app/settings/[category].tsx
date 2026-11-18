import React from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, ErrorBoundary } from '../../src/components/common';
import { SettingsContent } from '../../src/components/settings';
import { findCategory } from '../../src/components/settings/categoryCatalog';
import { useTheme } from '../../src/contexts/ThemeContext';
import { spacing, typography } from '../../src/constants/theme';

/**
 * One settings category.
 *
 * The category defines which section ids to render; an unknown id is a dead route
 * (deep link, or a category that was renamed) and says so instead of showing an
 * empty screen that looks broken.
 */
export default function SettingsCategoryScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const definition = findCategory(category);

  if (!definition) {
    return (
      <ErrorBoundary>
        <Stack.Screen options={{ title: 'Settings' }} />
        <View style={styles.missing}>
          <Text style={[typography.h3, { color: colors.text }]}>No such settings category</Text>
          <Text style={{ color: colors.textSecondary, marginTop: spacing.sm }}>
            “{String(category)}” is not a category in this version. It may have been renamed.
          </Text>
          <View style={{ marginTop: spacing.md }}>
            <Button title="Back to Settings" onPress={() => router.replace('/settings')} />
          </View>
        </View>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: definition.title }} />
      <SettingsContent only={definition.sections} showHeading={false} />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  missing: { flex: 1, padding: spacing.lg },
});
