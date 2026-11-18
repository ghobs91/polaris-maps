import React from 'react';
import { ErrorBoundary } from '../../src/components/common';
import { SettingsCategories } from '../../src/components/settings/SettingsCategories';

/**
 * Settings root: categories, one row each, iOS-style. Selecting one pushes
 * `/settings/<category>`, which renders only that category's groups.
 */
export default function SettingsScreen() {
  return (
    <ErrorBoundary>
      <SettingsCategories />
    </ErrorBoundary>
  );
}
