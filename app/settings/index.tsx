import React from 'react';
import { ErrorBoundary } from '../../src/components/common';
import { SettingsContent } from '../../src/components/settings';

export default function SettingsScreen() {
  return (
    <ErrorBoundary>
      <SettingsContent />
    </ErrorBoundary>
  );
}
