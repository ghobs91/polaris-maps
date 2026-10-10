/**
 * Tests for the database schema migrations in services/database/init.ts.
 */

const execCalls: string[] = [];

const mockExecAsync = jest.fn(async (sql: string) => {
  execCalls.push(sql);
});

const mockGetFirstAsync = jest.fn(async (sql: string) => {
  if (sql.includes("name = 'reviews'")) {
    return {
      sql: 'CREATE TABLE reviews (id TEXT PRIMARY KEY, poi_uuid TEXT NOT NULL, FOREIGN KEY (poi_uuid) REFERENCES places(uuid))',
    };
  }
  if (sql.includes("name = 'geocoding_trigram'")) {
    return { name: 'geocoding_trigram' };
  }
  return null;
});

const mockDb = { execAsync: mockExecAsync, getFirstAsync: mockGetFirstAsync };

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => mockDb),
}));

import { getDatabase } from '../../src/services/database/init';

const SQLite = jest.requireMock('expo-sqlite') as { openDatabaseAsync: jest.Mock };

describe('reviews foreign-key migration', () => {
  it('rebuilds the reviews table without the places foreign key', async () => {
    await getDatabase();

    const joined = execCalls.join('\n');
    expect(joined).toContain('ALTER TABLE reviews RENAME TO reviews_fk_legacy');
    expect(joined).toContain('PRAGMA legacy_alter_table = ON');
    expect(joined).toContain('DROP TABLE reviews_fk_legacy');

    // The fresh-install DDL must not re-introduce the constraint.
    const createReviews = execCalls.find((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS reviews'),
    );
    expect(createReviews).toBeDefined();
    expect(createReviews).not.toContain('REFERENCES places');
  });

  it('creates the viewport bounds index on places', async () => {
    await getDatabase();

    const joined = execCalls.join('\n');
    expect(joined).toContain(
      'CREATE INDEX IF NOT EXISTS idx_places_bounds ON places (status, lat, lng)',
    );
  });

  it('disables expo-sqlite finalize-all cleanup that double-frees FTS5 statements', async () => {
    await getDatabase();

    // expo/expo#38168: the default pre-close finalize walk frees FTS5's own
    // statements, which sqlite3_close then finalizes again (use-after-free).
    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith(
      'polaris-maps.db',
      expect.objectContaining({ finalizeUnusedStatementsBeforeClosing: false }),
    );
  });
});
