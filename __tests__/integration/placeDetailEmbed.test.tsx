import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

// ── Mock external dependencies ─────────────────────────────────────

// Control the embed URL at the module level so tests can toggle configured /
// unconfigured states.
let mockUrl: string | null = 'https://example.com/place-detail.html';

jest.mock('../../src/services/poi/placeDetailEmbed', () => ({
  buildPlaceDetailUrl: () => mockUrl,
}));

jest.mock('../../src/services/poi/mapSelectionPoi', () => ({
  isMapSelectionPoi: (poi: { tags?: Record<string, string> }) =>
    poi.tags?.['polaris:selection_kind'] === 'map_long_press',
}));

jest.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#000000', textSecondary: '#666666' } }),
}));

// Capture WebView props so tests can simulate page postMessage payloads and
// native error events.
let mockWebViewProps: Record<string, unknown> | null = null;

jest.mock('react-native-webview', () => ({
  WebView: (props: Record<string, unknown>) => {
    mockWebViewProps = props;
    return null;
  },
}));

import { PlaceDetailEmbed } from '../../src/components/map/PlaceDetailEmbed';

// ── Helpers ────────────────────────────────────────────────────────

const basePoi = {
  id: 'test-1',
  name: 'Test Cafe',
  lat: 40.7128,
  lng: -74.006,
  tags: {},
} as unknown as OsmPoi;

function postPageMessage(msg: Record<string, unknown>) {
  const handler = mockWebViewProps?.onMessage as
    | ((event: { nativeEvent: { data: string } }) => void)
    | undefined;
  act(() => {
    handler?.({ nativeEvent: { data: JSON.stringify(msg) } });
  });
}

function fireNativeError(nativeEvent: Record<string, unknown>) {
  const handler = mockWebViewProps?.onError as
    | ((event: { nativeEvent: Record<string, unknown> }) => void)
    | undefined;
  act(() => {
    handler?.({ nativeEvent });
  });
}

function fireHttpError(statusCode: number, description: string) {
  const handler = mockWebViewProps?.onHttpError as
    | ((event: { nativeEvent: { statusCode: number; description: string } }) => void)
    | undefined;
  act(() => {
    handler?.({ nativeEvent: { statusCode, description } });
  });
}

// ── Tests ──────────────────────────────────────────────────────────

describe('PlaceDetailEmbed', () => {
  beforeEach(() => {
    mockUrl = 'https://example.com/place-detail.html';
    mockWebViewProps = null;
  });

  it('renders the WebView with the built URL when configured', () => {
    const { getByTestId, queryByTestId } = render(<PlaceDetailEmbed poi={basePoi} />);

    expect(mockWebViewProps?.source).toEqual({ uri: mockUrl });
    expect(getByTestId('place-detail-section')).toBeTruthy();
    expect(queryByTestId('place-detail-error')).toBeNull();
  });

  it('renders a visible not-configured message when the embed URL is missing', () => {
    mockUrl = null;

    const { getByTestId } = render(<PlaceDetailEmbed poi={basePoi} />);

    const error = getByTestId('place-detail-error');
    expect(error.props.children).toContain('embed not configured in this build');
  });

  it('renders nothing for transient map-selection POIs', () => {
    const selectionPoi = {
      ...basePoi,
      tags: { 'polaris:selection_kind': 'map_long_press' },
    } as unknown as OsmPoi;

    const { queryByTestId } = render(<PlaceDetailEmbed poi={selectionPoi} />);

    expect(queryByTestId('place-detail-section')).toBeNull();
  });

  it('shows the page-reported error reason instead of hiding the section', () => {
    const { getByTestId } = render(<PlaceDetailEmbed poi={basePoi} />);

    postPageMessage({ type: 'error', message: 'no-match' });

    expect(getByTestId('place-detail-error').props.children).toContain('no-match');
  });

  it('shows native WebView error details', () => {
    const { getByTestId } = render(<PlaceDetailEmbed poi={basePoi} />);

    fireNativeError({ domain: 'NSURLErrorDomain', code: -1009, description: 'offline' });

    const error = getByTestId('place-detail-error').props.children as string;
    expect(error).toContain('NSURLErrorDomain');
    expect(error).toContain('-1009');
    expect(error).toContain('offline');
  });

  it('shows HTTP status errors from the main-frame load', () => {
    const { getByTestId } = render(<PlaceDetailEmbed poi={basePoi} />);

    fireHttpError(403, 'Forbidden');

    const error = getByTestId('place-detail-error').props.children as string;
    expect(error).toContain('HTTP 403');
    expect(error).toContain('Forbidden');
  });

  it('captures page step-log messages and shows them alongside the failure', () => {
    const { getByTestId } = render(<PlaceDetailEmbed poi={basePoi} />);

    postPageMessage({ type: 'log', message: 'page-loaded' });
    postPageMessage({ type: 'log', message: 'mapkit-load-ok' });
    postPageMessage({ type: 'error', message: 'no-match' });

    const log = getByTestId('place-detail-log').props.children as string;
    expect(log).toContain('page-loaded');
    expect(log).toContain('mapkit-load-ok');
  });

  it('clears the failure state when the POI changes', () => {
    const { getByTestId, queryByTestId, rerender } = render(<PlaceDetailEmbed poi={basePoi} />);

    postPageMessage({ type: 'error', message: 'no-match' });
    expect(getByTestId('place-detail-error')).toBeTruthy();

    rerender(<PlaceDetailEmbed poi={{ ...basePoi, id: 'test-2' } as unknown as OsmPoi} />);

    expect(queryByTestId('place-detail-error')).toBeNull();
  });
});
