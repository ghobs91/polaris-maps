import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Prevent NEW static light-only `colors` imports in user-facing code.
 *
 * Components should read colors from `useTheme()` / `useThemedStyles()`. The
 * allowlist below is the accepted migration backlog; remove a file from it as
 * you migrate it. Adding a new file here requires deliberately widening the
 * backlog, which is what this guard is meant to make visible.
 */
const ALLOWLIST = [
  'app/imagery/capture.tsx',
  'app/imagery/viewer.tsx',
  'app/poi/edit.tsx',
  'app/poi/osm-edit.tsx',
  'app/poi/reviews.tsx',
  'src/components/common/Button.tsx',
  'src/components/imagery/ImageryViewer.tsx',
  'src/components/map/LocationActionPanel.tsx',
  'src/components/map/MapView.tsx',
  'src/components/onboarding/OnboardingFlow.tsx',
  'src/components/poi/POICard.tsx',
  'src/components/poi/POIList.tsx',
  'src/components/poi/RatingWidget.tsx',
  'src/components/poi/ReviewCard.tsx',
  'src/components/regions/GeofabrikTreePicker.tsx',
  'src/components/regions/RegionGate.tsx',
  'src/contexts/ThemeContext.tsx',
];

const IMPORT_RE = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']*constants\/theme["']/g;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(path);
    }
  }
}

function importsStaticColors(file: string): boolean {
  const source = readFileSync(file, 'utf8');
  let match: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const named = match[1].split(',').map((n) => n.replace(/\s+as\s+\w+/, '').trim());
    if (named.includes('colors')) return true;
  }
  return false;
}

describe('theme migration guard', () => {
  it('only allow-listed files import static colors', () => {
    const files: string[] = [];
    walk('src', files);
    walk('app', files);

    const offenders = files
      .map((f) => f.split('\\').join('/'))
      .filter(importsStaticColors)
      .sort();

    const unexpected = offenders.filter((f) => !ALLOWLIST.includes(f));
    expect(unexpected).toEqual([]);
  });

  it('keeps the allowlist free of stale entries', () => {
    const files: string[] = [];
    walk('src', files);
    walk('app', files);

    const offenders = new Set(
      files.map((f) => f.split('\\').join('/')).filter(importsStaticColors),
    );
    const stale = ALLOWLIST.filter((f) => !offenders.has(f));
    expect(stale).toEqual([]);
  });
});
