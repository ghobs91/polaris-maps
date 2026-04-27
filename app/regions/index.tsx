import React from 'react';
import { ErrorBoundary } from '../../src/components/common';
import { RegionsContent } from '../../src/components/regions';

export default function RegionsScreen() {
  return (
    <ErrorBoundary>
      <RegionsContent />
    </ErrorBoundary>
  );
}
