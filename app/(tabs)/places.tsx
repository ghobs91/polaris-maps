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
import { Ionicons } from '@expo/vector-icons';
import { usePlaceListStore } from '../../src/stores/placeListStore';
import { useSettingsStore, type SavedListsSortMode } from '../../src/stores/settingsStore';
import { isICloudAvailable } from '../../src/services/icloud/iCloudSyncService';
import { parseImport } from '../../src/services/places/importService';
import { PlaceListCard, PlaceActionBar, EmojiPicker, SortSheet } from '../../src/components/places';
import type { PlaceActionBarAction, SortOption } from '../../src/components/places';
import { GoogleReviewsImport } from '../../src/components/reviews';
import { useReviewImportStore, isTakeoutReminderDue } from '../../src/stores/reviewImportStore';
import { Button, ErrorBoundary, Modal, GlassView } from '../../src/components/common';
import { spacing, typography, borderRadius } from '../../src/constants/theme';
import { useTheme } from '../../src/contexts/ThemeContext';
import { suggestEmojiForList } from '../../src/utils/placeListEmoji';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type { PlaceList } from '../../src/models/placeList';

type ListSortMode = SavedListsSortMode;

const LIST_SORT_OPTIONS: SortOption<ListSortMode>[] = [
  { key: 'recent', label: 'Most recently updated' },
  { key: 'name', label: 'Name (A–Z)' },
];

export default function MyPlacesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const lists = usePlaceListStore((s) => s.lists);
  const createList = usePlaceListStore((s) => s.createList);
  const deleteList = usePlaceListStore((s) => s.deleteList);
  const updateList = usePlaceListStore((s) => s.updateList);
  const clearAllLists = usePlaceListStore((s) => s.clearAllLists);
  const [showNewList, setShowNewList] = useState(false);
  const [newName, setNewName] = useState('');
  const [editMode, setEditMode] = useState(false);
  const sortMode = useSettingsStore((s) => s.savedListsSort);
  const setSortMode = useSettingsStore((s) => s.setSavedListsSort);
  const [showSort, setShowSort] = useState(false);
  const [emojiTarget, setEmojiTarget] = useState<PlaceList | null>(null);
  const [cloudAvailable, setCloudAvailable] = useState<boolean | null>(null);

  React.useEffect(() => {
    isICloudAvailable().then(setCloudAvailable);
  }, []);

  const handleCreateList = useCallback(() => {
    if (!newName.trim()) return;
    createList(newName.trim());
    setNewName('');
    setShowNewList(false);
  }, [newName, createList]);

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

  const handleSelectEmoji = useCallback(
    (emoji: string) => {
      if (emojiTarget) updateList(emojiTarget.id, { emoji });
    },
    [emojiTarget, updateList],
  );

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [showReviews, setShowReviews] = useState(false);
  const takeoutReminderAt = useReviewImportStore((s) => s.takeoutReminderAt);
  const clearTakeoutReminder = useReviewImportStore((s) => s.clearTakeoutReminder);
  const reminderDue = isTakeoutReminderDue(takeoutReminderAt);

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
      useReviewImportStore.getState().clearTakeoutReminder();
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

  // Default is "most recently updated"; the user can switch to name.
  const sortedLists = useMemo(() => {
    const copy = [...lists];
    if (sortMode === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
    return copy.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [lists, sortMode]);

  const renderItem = useCallback(
    ({ item }: { item: PlaceList }) => (
      <PlaceListCard
        list={item}
        editing={editMode}
        onPress={() => {
          if (editMode) {
            setEmojiTarget(item);
          } else {
            router.push({ pathname: '/places/list', params: { id: item.id } });
          }
        }}
        onLongPress={() => handleDeleteList(item)}
        onIconPress={() => setEmojiTarget(item)}
        onDelete={() => handleDeleteList(item)}
      />
    ),
    [editMode, router, handleDeleteList],
  );

  const actions: PlaceActionBarAction[] = useMemo(
    () => [
      {
        key: 'new',
        icon: 'add-circle-outline',
        label: 'New list',
        onPress: () => setShowNewList(true),
      },
      {
        key: 'sort',
        icon: 'swap-vertical',
        label: 'Sort lists',
        onPress: () => setShowSort(true),
        active: sortMode !== 'recent',
      },
      {
        key: 'edit',
        icon: 'pencil',
        label: editMode ? 'Done editing' : 'Edit lists',
        onPress: () => setEditMode((prev) => !prev),
        active: editMode,
      },
    ],
    [editMode, sortMode],
  );

  return (
    <ErrorBoundary>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.heading}>My Places</Text>
            {cloudAvailable !== null && (
              <GlassView material="regular" style={styles.syncBadge}>
                <Text style={styles.syncBadgeText}>
                  {cloudAvailable ? '☁️ iCloud' : 'Local only'}
                </Text>
              </GlassView>
            )}
          </View>
          <TouchableOpacity
            onPress={() => router.navigate('/(tabs)')}
            accessibilityRole="button"
            accessibilityLabel="Close My Places"
            hitSlop={8}
          >
            <GlassView material="regular" isInteractive style={styles.closeCircle}>
              <Ionicons name="close" size={22} color={colors.text} />
            </GlassView>
          </TouchableOpacity>
        </View>

        {editMode ? (
          <View style={styles.editActions}>
            <Button
              title="Import places"
              onPress={() => setShowImport(true)}
              variant="outline"
              size="sm"
            />
            <Button
              title="Import reviews"
              onPress={() => setShowReviews(true)}
              variant="outline"
              size="sm"
            />
            {lists.length > 0 && (
              <Button title="Erase all" onPress={handleClearAll} variant="ghost" size="sm" />
            )}
          </View>
        ) : (
          <Text style={styles.homeWorkHint}>
            Home/Work favorites are set from the map search bar for quick routing.
          </Text>
        )}

        {reminderDue && (
          <GlassView material="regular" style={styles.reminderCard}>
            <Text style={styles.reminderTitle}>Your Google Takeout is probably ready 📦</Text>
            <Text style={styles.reminderBody}>
              It has been 24 hours — Google has likely emailed your export link. Download and unzip
              it, then import your saved places and reviews.
            </Text>
            <View style={styles.reminderActions}>
              <Button title="Import places" onPress={() => setShowImport(true)} size="sm" />
              <Button
                title="Import reviews"
                onPress={() => setShowReviews(true)}
                variant="outline"
                size="sm"
              />
              <Button title="Dismiss" onPress={clearTakeoutReminder} variant="ghost" size="sm" />
            </View>
          </GlassView>
        )}

        <FlashList
          data={sortedLists}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📍</Text>
              <Text style={styles.emptyTitle}>No lists yet</Text>
              <Text style={styles.emptyBody}>
                Create a list to save your favorite places, or import from Google Maps.
              </Text>
            </View>
          }
        />

        <PlaceActionBar actions={actions} />

        <SortSheet
          visible={showSort}
          options={LIST_SORT_OPTIONS}
          value={sortMode}
          onSelect={setSortMode}
          onClose={() => setShowSort(false)}
        />

        <EmojiPicker
          visible={emojiTarget !== null}
          onClose={() => setEmojiTarget(null)}
          onSelect={handleSelectEmoji}
          suggestions={emojiTarget ? [suggestEmojiForList(emojiTarget.name), '⭐', '❤️', '📍'] : []}
          current={emojiTarget?.emoji}
        />

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

        <Modal visible={showReviews} onClose={() => setShowReviews(false)} title="Google Reviews">
          <GoogleReviewsImport />
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
          <Text style={styles.importHint}>
            An icon is chosen automatically from the name — you can change it later.
          </Text>
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
      flex: 1,
    },
    heading: { ...typography.h1, color: colors.text },
    closeCircle: {
      width: 44,
      height: 44,
      borderRadius: 999,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
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
    editActions: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    homeWorkHint: {
      ...typography.caption,
      color: colors.textSecondary,
      marginHorizontal: spacing.lg,
      marginTop: spacing.xs,
    },
    listContent: { paddingBottom: 120, paddingTop: spacing.xs },
    reminderCard: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.sm,
      borderRadius: borderRadius.md,
      overflow: 'hidden',
      borderCurve: 'continuous',
      padding: spacing.md,
      gap: spacing.sm,
    },
    reminderTitle: { ...typography.body, color: colors.text, fontWeight: '600' as const },
    reminderBody: { ...typography.caption, color: colors.textSecondary },
    reminderActions: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: spacing.sm,
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
