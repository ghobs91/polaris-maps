import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { Modal } from '../common/Modal';
import { GlassView } from '../common/GlassView';
import { Button } from '../common/Button';
import { LIST_EMOJI_GROUPS } from '../../utils/placeListEmoji';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';

interface EmojiPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  title?: string;
  /** Contextual suggestions (e.g. derived from the list title), shown first. */
  suggestions?: string[];
  current?: string;
}

/**
 * Icon picker for a place list. Shows contextual suggestions, a free-form
 * field for any emoji, and a curated grid — instead of the old single text box.
 */
export function EmojiPicker({
  visible,
  onClose,
  onSelect,
  title = 'Choose Icon',
  suggestions = [],
  current,
}: EmojiPickerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [custom, setCustom] = useState('');

  const pick = (emoji: string) => {
    onSelect(emoji);
    setCustom('');
    onClose();
  };

  return (
    <Modal visible={visible} onClose={onClose} title={title}>
      {suggestions.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Suggested</Text>
          <View style={styles.grid}>
            {suggestions.slice(0, 6).map((emoji, index) => (
              <Pressable
                key={`suggestion-${index}`}
                onPress={() => pick(emoji)}
                style={({ pressed }) => [
                  styles.emojiButton,
                  emoji === current && styles.selected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>Custom</Text>
      <View style={styles.customRow}>
        <GlassView material="regular" style={styles.customInputWrap}>
          <TextInput
            style={styles.customInput}
            placeholder="Type or paste an emoji"
            placeholderTextColor={colors.textSecondary}
            value={custom}
            onChangeText={setCustom}
            maxLength={8}
            autoCorrect={false}
            onSubmitEditing={() => custom.trim() && pick(custom.trim())}
          />
        </GlassView>
        <Button title="Use" onPress={() => custom.trim() && pick(custom.trim())} size="sm" />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {LIST_EMOJI_GROUPS.map((group) => (
          <View key={group.title}>
            <Text style={styles.sectionTitle}>{group.title}</Text>
            <View style={styles.grid}>
              {group.emojis.map((emoji) => (
                <Pressable
                  key={`${group.title}-${emoji}`}
                  onPress={() => pick(emoji)}
                  style={({ pressed }) => [
                    styles.emojiButton,
                    emoji === current && styles.selected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.emoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    sectionTitle: {
      ...typography.label,
      color: colors.textSecondary,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    emojiButton: {
      width: 44,
      height: 44,
      borderRadius: borderRadius.md,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    selected: {
      borderWidth: 2,
      borderColor: colors.primary,
    },
    pressed: {
      opacity: 0.6,
    },
    emoji: {
      fontSize: 24,
    },
    customRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    customInputWrap: {
      flex: 1,
      borderRadius: borderRadius.md,
      borderCurve: 'continuous',
      overflow: 'hidden',
      paddingHorizontal: spacing.md,
    },
    customInput: {
      ...typography.body,
      color: colors.text,
      paddingVertical: spacing.sm,
    },
    scroll: {
      maxHeight: 320,
      marginTop: spacing.xs,
    },
    scrollContent: {
      paddingBottom: spacing.md,
    },
  });
