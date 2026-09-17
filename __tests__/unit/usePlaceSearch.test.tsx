import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../src/services/search/searchSession', () => ({
  createSearchSession: jest.fn(),
}));

import { createSearchSession } from '../../src/services/search/searchSession';
import { usePlaceSearch } from '../../src/hooks/usePlaceSearch';
import { useSearchViewStore } from '../../src/stores/searchViewStore';

const session = {
  search: jest.fn(),
  submit: jest.fn().mockResolvedValue([]),
  refetch: jest.fn(),
  cancel: jest.fn(),
  dispose: jest.fn(),
  getLastQuery: jest.fn(() => ''),
};

const mockCreate = createSearchSession as jest.Mock;

function renderSearch() {
  return renderHook(() => usePlaceSearch({ getContext: () => ({ lat: 0, lng: 0, zoom: 14 }) }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReturnValue(session);
  useSearchViewStore.setState({ filters: {}, sort: 'relevance' });
});

describe('usePlaceSearch filter routing', () => {
  it('re-runs the search only when the category filter changes', () => {
    const { result } = renderSearch();

    act(() => result.current.setQuery('coffee'));
    expect(session.refetch).not.toHaveBeenCalled();

    act(() => useSearchViewStore.getState().setFilters({ openNow: true, minRating: 4 }));
    expect(session.refetch).not.toHaveBeenCalled();

    act(() => useSearchViewStore.getState().setFilters({ categories: ['cafe'] }));
    expect(session.refetch).toHaveBeenCalledTimes(1);

    act(() => useSearchViewStore.getState().setFilters({ categories: ['cafe', 'bar'] }));
    expect(session.refetch).toHaveBeenCalledTimes(2);
  });

  it('does not re-run the category search before a query exists', () => {
    renderSearch();

    act(() => useSearchViewStore.getState().setFilters({ categories: ['cafe'] }));

    expect(session.refetch).not.toHaveBeenCalled();
  });

  it('reads the current category filters at search time for source gating', () => {
    renderSearch();

    const options = mockCreate.mock.calls[0][0] as {
      getCategoryFilters?: () => string[] | undefined;
    };
    expect(options.getCategoryFilters?.()).toBeUndefined();

    act(() => useSearchViewStore.setState({ filters: { categories: ['pharmacy'] } }));
    expect(options.getCategoryFilters?.()).toEqual(['pharmacy']);
  });
});
