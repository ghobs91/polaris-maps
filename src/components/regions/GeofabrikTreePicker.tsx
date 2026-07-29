import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  useColorScheme,
  TextInput,
  UIManager,
  findNodeHandle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, darkColors, spacing, typography, borderRadius } from '../../constants/theme';
import type { GeoNode } from '../../constants/geofabrikCatalog';

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface GeofabrikTreePickerProps {
  /** Called when the user taps Download on a leaf/country node. */
  onDownload: (node: GeoNode) => void;
  /** Path of the node currently being downloaded (shows inline spinner text). */
  downloadingPath: string | null;
  /** Set of paths that have been fully downloaded (shows ✓ badge). */
  completedPaths: Set<string>;
  /** If provided, the deepest node whose bounds contain this point is highlighted. */
  userLat?: number;
  userLng?: number;
  /** Optional top-level nodes to display (defaults to all). */
  nodes: GeoNode[];
  /** Path of the auto-detected suggested node, used for scroll highlight. */
  suggestedPath?: string | null;
  /** Set of paths that are actively being seeded over Hyperdrive. */
  seedingPaths?: Set<string>;
  /** Map from region path to number of connected peers. */
  seedPeerCounts?: Map<string, number>;
  /** Called when the user toggles seeding on/off for a completed region. */
  onToggleSeed?: (node: GeoNode, seed: boolean) => void;
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

interface SearchResult {
  node: GeoNode;
  breadcrumb: string;
}

function flattenNodes(nodes: GeoNode[], parentBreadcrumb = ''): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  function walk(nodes: GeoNode[], parentBreadcrumb: string) {
    for (const node of nodes) {
      const breadcrumb = parentBreadcrumb ? `${parentBreadcrumb} > ${node.name}` : node.name;
      if (!seen.has(node.path)) {
        seen.add(node.path);
        results.push({ node, breadcrumb });
      }
      if (node.children) {
        walk(node.children, breadcrumb);
      }
    }
  }
  walk(nodes, parentBreadcrumb);
  return results;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GeofabrikTreePicker({
  onDownload,
  downloadingPath,
  completedPaths,
  userLat: _userLat,
  userLng: _userLng,
  nodes,
  suggestedPath,
  seedingPaths,
  seedPeerCounts,
  onToggleSeed,
}: GeofabrikTreePickerProps) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? darkColors : colors;

  const [searchQuery, setSearchQuery] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const suggestedRef = useRef<View>(null);

  const allSearchable = useMemo(() => flattenNodes(nodes), [nodes]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return allSearchable.filter(
      (r) =>
        r.node.name.toLowerCase().includes(query) || r.breadcrumb.toLowerCase().includes(query),
    );
  }, [searchQuery, allSearchable]);

  // Auto-scroll to the suggested region once it is expanded and laid out
  useEffect(() => {
    if (!suggestedPath || searchQuery) return;
    const timer = setTimeout(() => {
      const contentHandle = findNodeHandle(contentRef.current);
      const suggestedHandle = findNodeHandle(suggestedRef.current);
      if (contentHandle && suggestedHandle) {
        UIManager.measureLayout(
          suggestedHandle,
          contentHandle,
          () => {},
          (_x, y, _width, _height) => {
            scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: true });
          },
        );
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [suggestedPath, searchQuery]);

  return (
    <View style={styles.container}>
      <View style={[styles.searchContainer, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Ionicons name="search" size={18} color={c.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: c.text }]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search regions..."
          placeholderTextColor={c.textSecondary}
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7}>
            <Ionicons name="close-circle" size={18} color={c.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {searchQuery.trim() ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {searchResults.map(({ node, breadcrumb }) => (
            <SearchResultRow
              key={node.path}
              node={node}
              breadcrumb={breadcrumb}
              isSuggested={node.path === suggestedPath}
              isDownloading={downloadingPath === node.path}
              isCompleted={completedPaths.has(node.path)}
              isDisabled={downloadingPath != null}
              onDownload={onDownload}
              isSeeding={seedingPaths?.has(node.path) ?? false}
              peerCount={seedPeerCounts?.get(node.path) ?? 0}
              onToggleSeed={onToggleSeed}
            />
          ))}
          {searchResults.length === 0 && (
            <Text style={[styles.emptySearch, { color: c.textSecondary }]}>No regions found</Text>
          )}
        </ScrollView>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <View ref={contentRef} collapsable={false}>
            {nodes.map((continent) => (
              <ContinentRow
                key={continent.path}
                node={continent}
                downloadingPath={downloadingPath}
                completedPaths={completedPaths}
                suggestedPath={suggestedPath ?? null}
                onDownload={onDownload}
                seedingPaths={seedingPaths}
                seedPeerCounts={seedPeerCounts}
                onToggleSeed={onToggleSeed}
                suggestedRef={suggestedRef}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Search result row
// ---------------------------------------------------------------------------

interface SearchResultRowProps {
  node: GeoNode;
  breadcrumb: string;
  isSuggested: boolean;
  isDownloading: boolean;
  isCompleted: boolean;
  isDisabled: boolean;
  onDownload: (node: GeoNode) => void;
  isSeeding: boolean;
  peerCount: number;
  onToggleSeed?: (node: GeoNode, seed: boolean) => void;
}

function SearchResultRow({
  node,
  breadcrumb,
  isSuggested,
  isDownloading,
  isCompleted,
  isDisabled,
  onDownload,
  isSeeding,
  peerCount,
  onToggleSeed,
}: SearchResultRowProps) {
  const c = useColorScheme() === 'dark' ? darkColors : colors;

  return (
    <View
      style={[
        styles.searchResultRow,
        { backgroundColor: c.surface },
        isSuggested && [styles.rowSuggested, { borderColor: c.primary }],
      ]}
    >
      <View style={styles.searchResultText}>
        <Text
          style={[
            styles.searchResultName,
            { color: c.text },
            isSuggested && [styles.nameSuggested, { color: c.primary }],
          ]}
          numberOfLines={1}
        >
          {node.name}
          {isSuggested ? '  ★' : ''}
        </Text>
        <Text style={[styles.searchResultBreadcrumb, { color: c.textSecondary }]} numberOfLines={1}>
          {breadcrumb}
        </Text>
      </View>

      {isCompleted ? (
        <SeedToggle
          node={node}
          isSeeding={isSeeding}
          peerCount={peerCount}
          onToggleSeed={onToggleSeed}
        />
      ) : (
        <TouchableOpacity
          style={[
            styles.downloadBtn,
            { backgroundColor: c.primary },
            isDisabled && styles.downloadBtnDisabled,
          ]}
          onPress={() => onDownload(node)}
          disabled={isDisabled}
          activeOpacity={0.75}
        >
          <Text style={styles.downloadBtnText}>{isDownloading ? '…' : 'Download'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Continent row ── always shown, expands/collapses
// ---------------------------------------------------------------------------

interface ContinentRowProps {
  node: GeoNode;
  downloadingPath: string | null;
  completedPaths: Set<string>;
  suggestedPath: string | null;
  onDownload: (node: GeoNode) => void;
  seedingPaths?: Set<string>;
  seedPeerCounts?: Map<string, number>;
  onToggleSeed?: (node: GeoNode, seed: boolean) => void;
  suggestedRef: React.RefObject<View | null>;
}

function ContinentRow({
  node,
  downloadingPath,
  completedPaths,
  suggestedPath,
  onDownload,
  seedingPaths,
  seedPeerCounts,
  onToggleSeed,
  suggestedRef,
}: ContinentRowProps) {
  const c = useColorScheme() === 'dark' ? darkColors : colors;

  // Auto-expand the continent that contains the suggested path
  const containsSuggested = suggestedPath != null && suggestedPath.startsWith(node.path + '/');
  const isSuggested = node.path === suggestedPath;
  const [expanded, setExpanded] = useState(containsSuggested || isSuggested);

  useEffect(() => {
    if (containsSuggested || isSuggested) {
      setExpanded(true);
    }
  }, [containsSuggested, isSuggested]);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const hasChildren = (node.children?.length ?? 0) > 0;

  return (
    <View style={styles.continentBlock}>
      {/* Continent header */}
      <TouchableOpacity
        style={[styles.continentHeader, { backgroundColor: c.surface, borderLeftColor: c.primary }]}
        onPress={hasChildren ? toggle : undefined}
        activeOpacity={hasChildren ? 0.7 : 1}
        accessibilityRole="button"
        accessibilityLabel={node.name}
        accessibilityState={{ expanded }}
      >
        <Text style={[styles.continentName, { color: c.text }]}>{node.name}</Text>
        {hasChildren && (
          <Text style={[styles.chevron, { color: c.textSecondary }]}>{expanded ? '▲' : '▼'}</Text>
        )}
      </TouchableOpacity>

      {/* Country/subregion list */}
      {!hasChildren && node.bounds && (
        // Continent without sub-regions (Antarctica)
        <LeafRow
          node={node}
          isSuggested={node.path === suggestedPath}
          isDownloading={downloadingPath === node.path}
          isCompleted={completedPaths.has(node.path)}
          isDisabled={downloadingPath != null}
          onDownload={onDownload}
          indent={0}
          isSeeding={seedingPaths?.has(node.path) ?? false}
          peerCount={seedPeerCounts?.get(node.path) ?? 0}
          onToggleSeed={onToggleSeed}
          suggestedRef={suggestedRef}
        />
      )}

      {expanded && hasChildren && (
        <View style={styles.childrenWrapper}>
          {node.children!.map((country) => (
            <CountryRow
              key={country.path}
              node={country}
              downloadingPath={downloadingPath}
              completedPaths={completedPaths}
              suggestedPath={suggestedPath}
              onDownload={onDownload}
              seedingPaths={seedingPaths}
              seedPeerCounts={seedPeerCounts}
              onToggleSeed={onToggleSeed}
              suggestedRef={suggestedRef}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Country row ── either a leaf or expands sub-regions
// ---------------------------------------------------------------------------

interface CountryRowProps {
  node: GeoNode;
  downloadingPath: string | null;
  completedPaths: Set<string>;
  suggestedPath: string | null;
  onDownload: (node: GeoNode) => void;
  seedingPaths?: Set<string>;
  seedPeerCounts?: Map<string, number>;
  onToggleSeed?: (node: GeoNode, seed: boolean) => void;
  suggestedRef: React.RefObject<View | null>;
}

function CountryRow({
  node,
  downloadingPath,
  completedPaths,
  suggestedPath,
  onDownload,
  seedingPaths,
  seedPeerCounts,
  onToggleSeed,
  suggestedRef,
}: CountryRowProps) {
  const c = useColorScheme() === 'dark' ? darkColors : colors;

  const containsSuggested = suggestedPath != null && suggestedPath.startsWith(node.path + '/');
  const isSuggested = node.path === suggestedPath;
  const [expanded, setExpanded] = useState(containsSuggested || isSuggested);

  useEffect(() => {
    if (containsSuggested || isSuggested) {
      setExpanded(true);
    }
  }, [containsSuggested, isSuggested]);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const hasChildren = (node.children?.length ?? 0) > 0;

  if (!hasChildren) {
    return (
      <LeafRow
        node={node}
        isSuggested={isSuggested}
        isDownloading={downloadingPath === node.path}
        isCompleted={completedPaths.has(node.path)}
        isDisabled={downloadingPath != null}
        onDownload={onDownload}
        indent={1}
        isSeeding={seedingPaths?.has(node.path) ?? false}
        peerCount={seedPeerCounts?.get(node.path) ?? 0}
        onToggleSeed={onToggleSeed}
        suggestedRef={suggestedRef}
      />
    );
  }

  return (
    <View>
      {/* Country header with expand toggle + optional download button */}
      <View
        style={[
          styles.countryRow,
          { backgroundColor: c.surface },
          isSuggested && [styles.rowSuggested, { borderColor: c.primary }],
        ]}
      >
        <TouchableOpacity
          style={styles.countryExpandArea}
          onPress={toggle}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={node.name}
          accessibilityState={{ expanded }}
        >
          <Text
            style={[
              styles.countryName,
              { color: c.text },
              isSuggested && [styles.nameSuggested, { color: c.primary }],
            ]}
          >
            {node.name}
            {isSuggested ? '  ★' : ''}
          </Text>
          <Text style={[styles.chevronSmall, { color: c.textSecondary }]}>
            {expanded ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {/* Also allow downloading the whole country */}
        {completedPaths.has(node.path) ? (
          <SeedToggle
            node={node}
            isSeeding={seedingPaths?.has(node.path) ?? false}
            peerCount={seedPeerCounts?.get(node.path) ?? 0}
            onToggleSeed={onToggleSeed}
            compact
          />
        ) : (
          <TouchableOpacity
            style={[
              styles.downloadBtn,
              { backgroundColor: c.primary },
              downloadingPath != null && styles.downloadBtnDisabled,
            ]}
            onPress={() => onDownload(node)}
            disabled={downloadingPath != null}
            activeOpacity={0.75}
          >
            <Text style={styles.downloadBtnText}>{downloadingPath === node.path ? '…' : '↓'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {expanded && (
        <View style={styles.subregionWrapper}>
          {node.children!.map((sub) => (
            <LeafRow
              key={sub.path}
              node={sub}
              isSuggested={sub.path === suggestedPath}
              isDownloading={downloadingPath === sub.path}
              isCompleted={completedPaths.has(sub.path)}
              isDisabled={downloadingPath != null}
              onDownload={onDownload}
              indent={2}
              isSeeding={seedingPaths?.has(sub.path) ?? false}
              peerCount={seedPeerCounts?.get(sub.path) ?? 0}
              onToggleSeed={onToggleSeed}
              suggestedRef={suggestedRef}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Seed toggle ── shown for completed regions
// ---------------------------------------------------------------------------

interface SeedToggleProps {
  node: GeoNode;
  isSeeding: boolean;
  peerCount: number;
  onToggleSeed?: (node: GeoNode, seed: boolean) => void;
  compact?: boolean;
}

function SeedToggle({ node, isSeeding, peerCount, onToggleSeed, compact }: SeedToggleProps) {
  const c = useColorScheme() === 'dark' ? darkColors : colors;

  return (
    <View style={styles.seedRow}>
      {!compact && <Text style={[styles.seedLabel, { color: c.success }]}>✓</Text>}
      <Text style={[styles.seedPeers, { color: c.textSecondary }]}>
        {isSeeding ? `${peerCount} peer${peerCount !== 1 ? 's' : ''}` : ''}
      </Text>
      <Switch
        value={isSeeding}
        onValueChange={(val) => onToggleSeed?.(node, val)}
        trackColor={{ false: c.border, true: c.success }}
        thumbColor={colors.white}
        style={styles.seedSwitch}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Leaf row ── name + Download / seed toggle
// ---------------------------------------------------------------------------

interface LeafRowProps {
  node: GeoNode;
  isSuggested: boolean;
  isDownloading: boolean;
  isCompleted: boolean;
  isDisabled: boolean;
  onDownload: (node: GeoNode) => void;
  indent: 0 | 1 | 2;
  isSeeding: boolean;
  peerCount: number;
  onToggleSeed?: (node: GeoNode, seed: boolean) => void;
  suggestedRef: React.RefObject<View | null>;
}

function LeafRow({
  node,
  isSuggested,
  isDownloading,
  isCompleted,
  isDisabled,
  onDownload,
  indent,
  isSeeding,
  peerCount,
  onToggleSeed,
  suggestedRef,
}: LeafRowProps) {
  const c = useColorScheme() === 'dark' ? darkColors : colors;

  const indentBg = indent === 2 ? c.background : c.surface;
  const indentStyle = indent === 2 ? styles.indent2 : indent === 1 ? styles.indent1 : undefined;

  return (
    <View
      ref={isSuggested ? suggestedRef : null}
      style={[
        styles.leafRow,
        { backgroundColor: indentBg },
        indentStyle,
        isSuggested && [styles.rowSuggested, { borderColor: c.primary }],
      ]}
    >
      <Text
        style={[
          styles.leafName,
          { color: c.text },
          isSuggested && [styles.nameSuggested, { color: c.primary }],
        ]}
        numberOfLines={1}
      >
        {node.name}
        {isSuggested ? '  ★' : ''}
      </Text>

      {isCompleted ? (
        <SeedToggle
          node={node}
          isSeeding={isSeeding}
          peerCount={peerCount}
          onToggleSeed={onToggleSeed}
        />
      ) : (
        <TouchableOpacity
          style={[
            styles.downloadBtn,
            { backgroundColor: c.primary },
            isDisabled && styles.downloadBtnDisabled,
          ]}
          onPress={() => onDownload(node)}
          disabled={isDisabled}
          activeOpacity={0.75}
        >
          <Text style={styles.downloadBtnText}>{isDownloading ? 'Downloading…' : 'Download'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.md,
  },

  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  searchIcon: {
    marginLeft: spacing.xs,
  },
  searchInput: {
    ...typography.body,
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: 2,
  },
  searchResultText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  searchResultName: {
    ...typography.body,
    fontSize: 14,
  },
  searchResultBreadcrumb: {
    ...typography.caption,
    marginTop: 2,
  },
  emptySearch: {
    ...typography.body,
    textAlign: 'center',
    marginTop: spacing.lg,
  },

  // Continent block
  continentBlock: {
    marginBottom: spacing.xs,
  },
  continentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
  },
  continentName: {
    ...typography.body,
    fontWeight: '700',
    flex: 1,
  },
  chevron: {
    ...typography.caption,
    marginLeft: spacing.sm,
  },

  // Children / country area
  childrenWrapper: {
    paddingLeft: spacing.sm,
    paddingTop: 2,
  },

  // Country row (expandable)
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.sm,
    marginBottom: 2,
    paddingRight: spacing.sm,
    overflow: 'hidden',
  },
  countryExpandArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
  },
  countryName: {
    ...typography.body,
    flex: 1,
  },
  chevronSmall: {
    ...typography.caption,
    marginLeft: spacing.xs,
    marginRight: spacing.xs,
  },

  // Sub-region wrapper
  subregionWrapper: {
    paddingLeft: spacing.md,
  },

  // Leaf row
  leafRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginBottom: 2,
  },
  indent1: {
    marginLeft: 0,
  },
  indent2: {
    marginLeft: spacing.sm,
  },
  leafName: {
    ...typography.body,
    flex: 1,
    marginRight: spacing.sm,
    fontSize: 14,
  },

  // Shared: suggested highlight
  rowSuggested: {
    borderWidth: 1,
  },
  nameSuggested: {
    fontWeight: '700',
  },

  // Shared: download button
  downloadBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    minWidth: 72,
    alignItems: 'center',
  },
  downloadBtnDisabled: {
    opacity: 0.4,
  },
  downloadBtnText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '600',
  },

  // Seed toggle
  seedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  seedLabel: {
    ...typography.caption,
    fontWeight: '700',
    marginRight: spacing.xs,
  },
  seedPeers: {
    ...typography.caption,
    fontSize: 11,
    marginRight: 4,
    minWidth: 42,
    textAlign: 'right',
  },
  seedSwitch: {
    transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }],
  },
});
