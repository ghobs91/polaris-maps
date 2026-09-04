import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaceListStore } from '../../src/stores/placeListStore';
import { isICloudAvailable } from '../../src/services/icloud/iCloudSyncService';
import { parseImport } from '../../src/services/places/importService';
import { PlaceListCard } from '../../src/components/places';
import { Button, ErrorBoundary, Modal, GlassView } from '../../src/components/common';
import { spacing, typography, borderRadius } from '../../src/constants/theme';
import { useTheme } from '../../src/contexts/ThemeContext';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type { PlaceList } from '../../src/models/placeList';

type ListSortMode = 'recent' | 'alpha';

export default function MyPlacesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const lists = usePlaceListStore((s) => s.lists);
  const createList = usePlaceListStore((s) => s.createList);
  const deleteList = usePlaceListStore((s) => s.deleteList);
  const clearAllLists = usePlaceListStore((s) => s.clearAllLists);
  const [showNewList, setShowNewList] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('');
  const [cloudAvailable, setCloudAvailable] = useState<boolean | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<ListSortMode>('recent');

  React.useEffect(() => {
    isICloudAvailable().then(setCloudAvailable);
  }, []);

  const handleCreateList = useCallback(() => {
    if (!newName.trim()) return;
    createList(newName.trim(), newEmoji.trim() || undefined);
    setNewName('');
    setNewEmoji('');
    setShowNewList(false);
  }, [newName, newEmoji, createList]);

  const handleDeleteList = useCallback(
    (list: PlaceList) => {
      Alert.alert('Delete List', `Delete "${list.name}" and all its places?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteList(list.id),
        },
      ]);
    },
    [deleteList],
  );

  const handleClearAll = useCallback(() => {
    Alert.alert(
      'Erase All Places',
      'This will permanently delete all your lists and saved places. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase Everything',
          style: 'destructive',
          onPress: clearAllLists,
        },
      ],
    );
  }, [clearAllLists]);

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');

  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'application/json',
          'application/geo+json',
          'application/vnd.google-earth.kml+xml',
          'application/gpx+xml',
          'text/xml',
          'text/plain',
          'public.data',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const content = await FileSystem.readAsStringAsync(asset.uri);
      const imported = parseImport(content, undefined, asset.name);
      usePlaceListStore.getState().importList(imported);
      setShowImport(false);
      Alert.alert(
        'Import Complete',
        `"${imported.name}" with ${imported.places.length} places imported.`,
      );
    } catch (e) {
      Alert.alert('Import Error', (e as Error).message || 'Could not read file');
    }
  }, []);

  const handlePickMultipleFiles = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'public.data'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const store = usePlaceListStore.getState();
      let totalLists = 0;
      let totalPlaces = 0;
      const errors: string[] = [];

      for (const asset of result.assets) {
        try {
          const content = await FileSystem.readAsStringAsync(asset.uri);
          const imported = parseImport(content, undefined, asset.name);
          store.importList(imported);
          totalLists++;
          totalPlaces += imported.places.length;
        } catch {
          errors.push(asset.name ?? 'unknown file');
        }
      }

      setShowImport(false);
      const summary = `${totalLists} list${totalLists !== 1 ? 's' : ''} with ${totalPlaces} total places imported.`;
      if (errors.length) {
        Alert.alert(
          'Import Partially Complete',
          `${summary}\n\nFailed to parse: ${errors.join(', ')}`,
        );
      } else {
        Alert.alert('Import Complete', summary);
      }
    } catch (e) {
      Alert.alert('Import Error', (e as Error).message || 'Could not read files');
    }
  }, []);

  const handleImportSubmit = useCallback(() => {
    const text = importText.trim();
    if (!text) return;
    try {
      const imported = parseImport(text);
      usePlaceListStore.getState().importList(imported);
      Alert.alert(
        'Import Complete',
        `"${imported.name}" with ${imported.places.length} places imported.`,
      );
      setImportText('');
      setShowImport(false);
    } catch (e) {
      Alert.alert('Import Error', (e as Error).message ?? 'Could not parse data');
    }
  }, [importText]);

  const cycleSortMode = useCallback(() => {
    setSortMode((prev) => (prev === 'recent' ? 'alpha' : 'recent'));
  }, []);

  const filteredSortedLists = useMemo(() => {
    let result = [...lists];
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((l) => l.name.toLowerCase().includes(q));
    }
    if (sortMode === 'alpha') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      result.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return result;
  }, [lists, searchQuery, sortMode]);

  const renderItem = useCallback(
    ({ item }: { item: PlaceList }) => (
      <PlaceListCard
        list={item}
        onPress={() => router.push({ pathname: '/places/list', params: { id: item.id } })}
        onLongPress={() => handleDeleteList(item)}
      />
    ),
    [router, handleDeleteList],
  );

  return (
    <ErrorBoundary>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={() => router.navigate('/(tabs)')} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.heading}>My Places</Text>
          </View>
          <View style={styles.headerRight}>
            {lists.length > 0 && (
              <TouchableOpacity onPress={handleClearAll} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>Erase all</Text>
              </TouchableOpacity>
            )}
            {cloudAvailable !== null && (
              <GlassView material="regular" style={styles.syncBadge}>
                <Text style={styles.syncBadgeText}>
                  {cloudAvailable ? '☁️ iCloud' : 'Local only'}
                </Text>
              </GlassView>
            )}
          </View>
        </View>

        <View style={styles.filterRow}>
          <GlassView material="regular" style={styles.searchContainer}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search lists..."
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClear}>
                <Text style={styles.searchClearText}>✕</Text>
              </TouchableOpacity>
            )}
          </GlassView>
          <Button
            title={sortMode === 'recent' ? '↕ Recent' : '↕ A-Z'}
            onPress={cycleSortMode}
            variant="outline"
            size="sm"
            style={styles.sortButton}
          />
        </View>
        <Text style={styles.homeWorkHint}>
          Home/Work favorites are set from the map search bar for quick routing.
        </Text>

        <Button
          title="+ New list"
          onPress={() => setShowNewList(true)}
          style={styles.newListButton}
        />

        <FlashList
          data={filteredSortedLists}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📍</Text>
              <Text style={styles.emptyTitle}>
                {searchQuery ? 'No matching lists' : 'No lists yet'}
              </Text>
              <Text style={styles.emptyBody}>
                {searchQuery
                  ? 'Try a different search term.'
                  : 'Create a list to save your favorite places, or import from Google Maps.'}
              </Text>
            </View>
          }
        />

        <View style={styles.footer}>
          <Button title="Import places" onPress={() => setShowImport(true)} variant="outline" />
        </View>

        <Modal
          visible={showImport}
          onClose={() => {
            setShowImport(false);
            setImportText('');
          }}
          title="Import Places"
        >
          <Button
            title="Choose file (CSV, JSON, KML, GPX…)"
            onPress={handlePickFile}
            variant="outline"
          />
          <Button
            title="Import multiple CSVs (Google Maps export)"
            onPress={handlePickMultipleFiles}
            variant="outline"
          />
          <Text style={styles.importDivider}>— or paste content —</Text>
          <Text style={styles.importHint}>
            CSV, JSON, GeoJSON, KML, or GPX from a Google Maps export (Google Takeout → Maps → Saved
            places → export, then pick the file above):
          </Text>
          <ScrollView style={styles.importScrollWrap}>
            <GlassView material="regular" style={styles.importInputWrapper}>
              <TextInput
                style={styles.importInput}
                placeholder="Paste exported data here…"
                placeholderTextColor={colors.textSecondary}
                value={importText}
                onChangeText={setImportText}
                multiline
                textAlignVertical="top"
                autoFocus
              />
            </GlassView>
          </ScrollView>
          <View style={styles.modalActions}>
            <Button
              title="Cancel"
              onPress={() => {
                setShowImport(false);
                setImportText('');
              }}
              variant="ghost"
            />
            <Button title="Import" onPress={handleImportSubmit} disabled={!importText.trim()} />
          </View>
        </Modal>

        <Modal visible={showNewList} onClose={() => setShowNewList(false)} title="New List">
          <GlassView material="regular" style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              placeholder="List name"
              placeholderTextColor={colors.textSecondary}
              value={newName}
              onChangeText={setNewName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreateList}
            />
          </GlassView>
          <GlassView material="regular" style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              placeholder="Emoji icon (optional)"
              placeholderTextColor={colors.textSecondary}
              value={newEmoji}
              onChangeText={setNewEmoji}
            />
          </GlassView>
          <View style={styles.modalActions}>
            <Button title="Cancel" onPress={() => setShowNewList(false)} variant="ghost" />
            <Button title="Create" onPress={handleCreateList} disabled={!newName.trim()} />
          </View>
        </Modal>
      </View>
    </ErrorBoundary>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
    },
    headerLeft: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
    },
    filterRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      paddingHorizontal: spacing.lg,
      gap: spacing.sm,
      marginBottom: spacing.xs,
    },
    searchContainer: {
      flex: 1,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      borderRadius: 999,
      overflow: 'hidden',
      borderCurve: 'continuous',
      paddingHorizontal: spacing.sm,
    },
    searchIcon: {
      fontSize: 14,
      marginRight: spacing.xs,
    },
    searchInput: {
      ...typography.body,
      color: colors.text,
      flex: 1,
      paddingVertical: spacing.sm,
    },
    searchClear: {
      padding: spacing.xs,
    },
    searchClearText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    sortButton: {
      borderCurve: 'continuous',
    },
    closeBtn: {
      padding: spacing.xs,
    },
    closeBtnText: {
      fontSize: 20,
      color: colors.textSecondary,
      fontWeight: '600' as const,
    },
    heading: { ...typography.h1, color: colors.text },
    headerRight: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
    },
    clearBtn: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    clearBtnText: {
      ...typography.caption,
      color: '#e53935',
    },
    syncBadge: {
      borderRadius: 999,
      overflow: 'hidden',
      borderCurve: 'continuous',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    syncBadgeText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    newListButton: {
      marginHorizontal: spacing.lg,
      marginVertical: spacing.sm,
      borderCurve: 'continuous',
    },
    homeWorkHint: {
      ...typography.caption,
      color: colors.textSecondary,
      marginHorizontal: spacing.lg,
      marginTop: spacing.xs,
    },
    listContent: { paddingBottom: spacing.xxl },
    footer: {
      padding: spacing.lg,
    },
    emptyState: {
      alignItems: 'center',
      paddingVertical: spacing.xxl * 2,
      paddingHorizontal: spacing.xl,
    },
    emptyIcon: { fontSize: 48, marginBottom: spacing.md },
    emptyTitle: { ...typography.h2, color: colors.text, marginBottom: spacing.sm },
    emptyBody: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    inputWrapper: {
      borderRadius: borderRadius.md,
      overflow: 'hidden',
      borderCurve: 'continuous',
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    input: {
      ...typography.body,
      color: colors.text,
      width: '100%',
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    importDivider: {
      ...typography.caption,
      color: colors.textSecondary,
      textAlign: 'center' as const,
      marginVertical: spacing.sm,
    },
    importHint: {
      ...typography.caption,
      color: colors.textSecondary,
      marginBottom: spacing.sm,
    },
    importScrollWrap: {
      maxHeight: 200,
    },
    importInputWrapper: {
      borderRadius: borderRadius.md,
      overflow: 'hidden',
      borderCurve: 'continuous',
      padding: spacing.md,
      minHeight: 120,
    },
    importInput: {
      ...typography.body,
      color: colors.text,
      width: '100%',
      minHeight: 120,
      fontFamily: 'monospace',
      fontSize: 12,
    },
  });
