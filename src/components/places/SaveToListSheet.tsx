import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { spacing, typography } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { usePlaceListStore } from '../../stores/placeListStore';
import type { PlaceList } from '../../models/placeList';

interface SaveToListSheetProps {
  poiUuid?: string;
  placeName: string;
  lat: number;
  lng: number;
  address?: string;
  category?: string;
  onDone: () => void;
}

export function SaveToListSheet({
  poiUuid,
  placeName,
  lat,
  lng,
  address,
  category,
  onDone,
}: SaveToListSheetProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const lists = usePlaceListStore((s) => s.lists);
  const createList = usePlaceListStore((s) => s.createList);
  const addPlace = usePlaceListStore((s) => s.addPlace);
  const removePlace = usePlaceListStore((s) => s.removePlace);
  const [newListName, setNewListName] = useState('');

  const isInList = useCallback(
    (list: PlaceList) =>
      list.places.some(
        (p) =>
          (poiUuid && p.poiUuid === poiUuid) ||
          (p.name === placeName && p.lat === lat && p.lng === lng),
      ),
    [poiUuid, placeName, lat, lng],
  );

  const handleToggle = useCallback(
    (list: PlaceList) => {
      const existing = list.places.find(
        (p) =>
          (poiUuid && p.poiUuid === poiUuid) ||
          (p.name === placeName && p.lat === lat && p.lng === lng),
      );
      if (existing) {
        removePlace(list.id, existing.id);
      } else {
        addPlace(list.id, { name: placeName, lat, lng, address, category, poiUuid });
      }
    },
    [poiUuid, placeName, lat, lng, address, category, addPlace, removePlace],
  );

  const handleCreateAndAdd = useCallback(() => {
    const name = newListName.trim() || 'New List';
    const list = createList(name);
    addPlace(list.id, { name: placeName, lat, lng, address, category, poiUuid });
    setNewListName('');
  }, [newListName, createList, addPlace, poiUuid, placeName, lat, lng, address, category]);

  const renderRow = useCallback(
    ({ item }: { item: PlaceList }) => {
      const saved = isInList(item);
      return (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
          onPress={() => handleToggle(item)}
        >
          <Text style={styles.checkmark}>{saved ? '✓' : ''}</Text>
          <Text style={styles.listName}>{item.name}</Text>
          <Text style={styles.count}>{item.places.length}</Text>
        </Pressable>
      );
    },
    [isInList, handleToggle],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Save to list</Text>
        <Pressable style={({ pressed }) => [pressed && { opacity: 0.6 }]} onPress={onDone}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>

      <FlashList
        data={lists}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        ListFooterComponent={
          <Pressable
            style={({ pressed }) => [styles.newListRow, pressed && { opacity: 0.6 }]}
            onPress={handleCreateAndAdd}
          >
            <Text style={styles.plusIcon}>+</Text>
            <Text style={styles.newListText}>New list</Text>
          </Pressable>
        }
      />
    </View>
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
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: { ...typography.h3, color: colors.text },
    doneText: { ...typography.body, color: colors.primary },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    checkmark: {
      width: 28,
      fontSize: 18,
      color: colors.primary,
      fontWeight: '700',
    },
    listName: { ...typography.body, color: colors.text, flex: 1 },
    count: { ...typography.caption, color: colors.textSecondary },
    newListRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    plusIcon: {
      width: 28,
      fontSize: 22,
      color: colors.primary,
      fontWeight: '600',
    },
    newListText: { ...typography.body, color: colors.primary },
  });
