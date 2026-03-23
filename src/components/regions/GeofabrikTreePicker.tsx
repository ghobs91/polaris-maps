import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  useColorScheme,
} from 'react-native';
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
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
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
        />
      ))}
    </ScrollView>
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
}: ContinentRowProps) {
  const c = useColorScheme() === 'dark' ? darkColors : colors;

  // Auto-expand the continent that contains the suggested path
  const containsSuggested = suggestedPath != null && suggestedPath.startsWith(node.path + '/');
  const [expanded, setExpanded] = useState(containsSuggested);

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
}: CountryRowProps) {
  const c = useColorScheme() === 'dark' ? darkColors : colors;

  const containsSuggested = suggestedPath != null && suggestedPath.startsWith(node.path + '/');
  const [expanded, setExpanded] = useState(containsSuggested);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSuggested = node.path === suggestedPath;

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
}: LeafRowProps) {
  const c = useColorScheme() === 'dark' ? darkColors : colors;

  const indentBg = indent === 2 ? c.background : c.surface;
  const indentStyle = indent === 2 ? styles.indent2 : indent === 1 ? styles.indent1 : undefined;

  return (
    <View
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.md,
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
