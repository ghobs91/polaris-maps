import React, { useMemo } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { spacing, typography, borderRadius } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { GlassView } from './GlassView';
import { SFSymbol } from './SFSymbol';

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}

export function Modal({ visible, onClose, title, children, style }: ModalProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <BlurView
          intensity={30}
          tint="systemUltraThinMaterialDark"
          style={StyleSheet.absoluteFill}
        />
        <Pressable style={styles.backdrop} onPress={onClose} />
        <GlassView material="regular" style={[styles.content, style]}>
          {title && (
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <SFSymbol name="xmark.circle.fill" size={22} tintColor={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
          {children}
        </GlassView>
      </View>
    </RNModal>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.lg,
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
    },
    content: {
      borderRadius: borderRadius.xl,
      padding: spacing.lg,
      width: '100%',
      maxHeight: '80%',
      borderCurve: 'continuous',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    title: {
      ...typography.h3,
      color: colors.text,
      flex: 1,
    },
  });
