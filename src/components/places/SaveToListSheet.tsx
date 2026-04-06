import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
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
  const { lists, createList, addPlace, removePlace } = usePlaceListStore();
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Save to list</Text>
        <TouchableOpacity onPress={onDone}>
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={lists}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const saved = isInList(item);
          return (
            <TouchableOpacity style={styles.row} onPress={() => handleToggle(item)}>
              <Text style={styles.checkmark}>{saved ? '✓' : ''}</Text>
              <Text style={styles.listName}>{item.name}</Text>
              <Text style={styles.count}>{item.places.length}</Text>
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={
          <TouchableOpacity style={styles.newListRow} onPress={handleCreateAndAdd}>
            <Text style={styles.plusIcon}>+</Text>
            <Text style={styles.newListText}>New list</Text>
          </TouchableOpacity>
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
