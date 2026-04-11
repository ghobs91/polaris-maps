import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaceListStore } from '../../src/stores/placeListStore';
import { useICloudSync } from '../../src/hooks/useICloudSync';
import { isICloudAvailable } from '../../src/services/icloud/iCloudSyncService';
import { parseImport } from '../../src/services/places/importService';
import { PlaceListCard } from '../../src/components/places';
import { Button, ErrorBoundary, Modal } from '../../src/components/common';
import { spacing, typography, borderRadius } from '../../src/constants/theme';
import { useTheme } from '../../src/contexts/ThemeContext';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import type { PlaceList } from '../../src/models/placeList';

export default function MyPlacesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  useICloudSync();

  const { lists, createList, deleteList, clearAllLists } = usePlaceListStore();
  const [showNewList, setShowNewList] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('');
  const [cloudAvailable, setCloudAvailable] = useState<boolean | null>(null);

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
              <Text style={styles.syncBadge}>{cloudAvailable ? '☁️ iCloud' : 'Local only'}</Text>
            )}
          </View>
        </View>

        <TouchableOpacity style={styles.newListButton} onPress={() => setShowNewList(true)}>
          <Text style={styles.newListText}>+ New list</Text>
        </TouchableOpacity>

        <FlatList
          data={lists}
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
            CSV, JSON, GeoJSON, KML, or GPX from a Google Maps export:
          </Text>
          <ScrollView style={styles.importScrollWrap}>
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
          <TextInput
            style={styles.input}
            placeholder="Emoji icon (optional)"
            placeholderTextColor={colors.textSecondary}
            value={newEmoji}
            onChangeText={setNewEmoji}
          />
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
      ...typography.caption,
      color: colors.textSecondary,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.sm,
      overflow: 'hidden',
    },
    newListButton: {
      marginHorizontal: spacing.lg,
      marginVertical: spacing.sm,
      backgroundColor: colors.primary,
      paddingVertical: spacing.sm + 2,
      borderRadius: borderRadius.md,
      alignItems: 'center',
    },
    newListText: { ...typography.subtitle, color: colors.white },
    listContent: { paddingBottom: spacing.xxl },
    footer: {
      padding: spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
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
    input: {
      ...typography.body,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
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
    importInput: {
      ...typography.body,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      minHeight: 120,
      fontFamily: 'monospace',
      fontSize: 12,
    },
  });
