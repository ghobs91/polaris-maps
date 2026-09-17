import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => {
    const mockReact = jest.requireActual('react') as typeof React;
    return mockReact.createElement('Image', props);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      background: '#FFFFFF',
      border: '#CCCCCC',
      surface: '#F2F2F7',
      text: '#000000',
      textSecondary: '#666666',
      primary: '#0A84FF',
    },
  }),
}));

jest.mock('../../src/services/poi/reviewMediaService', () => ({
  resolveReviewMediaUri: jest.fn((hash: string, variant: string) =>
    Promise.resolve(hash.startsWith('missing') ? null : `file:///${hash}.${variant}.jpg`),
  ),
}));

import { ReviewPhotoGallery } from '../../src/components/poi/ReviewPhotoGallery';
import type { ReviewMedia } from '../../src/models/review';

function media(hash: string, status: ReviewMedia['status'] = 'local'): ReviewMedia {
  return { hash, width: 1600, height: 800, mime: 'image/jpeg', status, createdAt: 1 };
}

describe('ReviewPhotoGallery', () => {
  it('renders visible media and hides reported/hidden photos', async () => {
    const screen = render(
      <ReviewPhotoGallery media={[media('a'), media('b', 'reported'), media('c', 'hidden')]} />,
    );

    await waitFor(() => expect(screen.getByTestId('review-photo-thumb-a')).toBeTruthy());
    expect(screen.queryByTestId('review-photo-thumb-b')).toBeNull();
    expect(screen.queryByTestId('review-photo-thumb-c')).toBeNull();
  });

  it('returns nothing when every photo is hidden', async () => {
    const screen = render(<ReviewPhotoGallery media={[media('a', 'hidden')]} />);
    await waitFor(() => expect(screen.queryByTestId('review-photo-strip')).toBeNull());
  });

  it('opens the full-size viewer with a counter and closes it', async () => {
    const screen = render(<ReviewPhotoGallery media={[media('a'), media('b')]} />);

    await waitFor(() => expect(screen.getByTestId('review-photo-thumb-b')).toBeTruthy());

    fireEvent.press(screen.getByTestId('review-photo-thumb-b'));

    expect(screen.getByTestId('review-photo-viewer')).toBeTruthy();
    expect(screen.getByTestId('review-photo-viewer-counter')).toHaveTextContent('2 / 2');

    fireEvent.press(screen.getByLabelText('Close photo viewer'));
    await waitFor(() => expect(screen.queryByTestId('review-photo-viewer')).toBeNull());
  });

  it('shows a placeholder instead of a broken image when local bytes are missing', async () => {
    const screen = render(<ReviewPhotoGallery media={[media('missing-a')]} />);

    await waitFor(() => expect(screen.getByTestId('review-photo-thumb-missing-a')).toBeTruthy());

    fireEvent.press(screen.getByTestId('review-photo-thumb-missing-a'));
    await waitFor(() => expect(screen.getByText('Photo unavailable offline')).toBeTruthy());
  });
});
