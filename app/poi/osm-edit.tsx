import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOsmAuthStore } from '@/stores/osmAuthStore';
import {
  fetchOsmNode,
  submitOsmNodeEdit,
  submitOsmNodeCreate,
  type OsmNodeData,
} from '@/services/osm/osmEditService';
import { colors, spacing, typography, borderRadius } from '@/constants/theme';

/**
 * Editable OSM tag fields.
 * Maps a human-readable label → OSM tag key(s).
 */
const EDITABLE_FIELDS = [
  { label: 'Name', key: 'name' },
  { label: 'Phone', key: 'phone' },
  { label: 'Website', key: 'website' },
  { label: 'Opening Hours', key: 'opening_hours' },
  { label: 'Cuisine', key: 'cuisine' },
  { label: 'Email', key: 'email' },
  { label: 'Description', key: 'description' },
  { label: 'Wheelchair Access', key: 'wheelchair', hint: 'yes / limited / no' },
  { label: 'Wi-Fi', key: 'internet_access', hint: 'wlan / no' },
  { label: 'Outdoor Seating', key: 'outdoor_seating', hint: 'yes / no' },
] as const;

export default function OsmEditScreen() {
  const router = useRouter();
  const {
    nodeId,
    name: poiName,
    lat: paramLat,
    lng: paramLng,
    initialTags: paramInitialTags,
  } = useLocalSearchParams<{
    nodeId?: string;
    name?: string;
    lat?: string;
    lng?: string;
    initialTags?: string;
  }>();

  // Determine mode: editing an existing node, or creating a new one
  const isCreateMode = !nodeId && paramLat !== undefined && paramLng !== undefined;
  const createLat = paramLat ? parseFloat(paramLat) : 0;
  const createLng = paramLng ? parseFloat(paramLng) : 0;

  // Auth
  const accessToken = useOsmAuthStore((s) => s.accessToken);
  const user = useOsmAuthStore((s) => s.user);
  const isLoggingIn = useOsmAuthStore((s) => s.isLoggingIn);
  const login = useOsmAuthStore((s) => s.login);
  const hydrate = useOsmAuthStore((s) => s.hydrate);
  const hydrated = useOsmAuthStore((s) => s.hydrated);
  const ensureValid = useOsmAuthStore((s) => s.ensureValid);

  // Node data
  const [node, setNode] = useState<OsmNodeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editedTags, setEditedTags] = useState<Record<string, string>>({});
  const [changeComment, setChangeComment] = useState('');

  // Hydrate auth on mount
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Load node data once auth is hydrated
  useEffect(() => {
    if (!hydrated) return;

    // Create mode: populate directly from initialTags param
    if (isCreateMode) {
      const tags: Record<string, string> = {};
      try {
        if (paramInitialTags) {
          const parsed = JSON.parse(paramInitialTags);
          if (typeof parsed === 'object' && parsed !== null) {
            Object.assign(tags, parsed);
          }
        }
      } catch {
        /* ignore parse errors */
      }

      const initial: Record<string, string> = {};
      for (const f of EDITABLE_FIELDS) {
        initial[f.key] = tags[f.key] ?? '';
      }
      setEditedTags(initial);

      // Create a synthetic node for the form (no real OSM ID yet)
      setNode({
        id: 0,
        version: 0,
        lat: createLat,
        lon: createLng,
        tags,
      });
      setLoading(false);
      return;
    }

    // Edit mode: fetch existing OSM node
    if (!nodeId) {
      setLoading(false);
      return;
    }
    const id = parseInt(nodeId, 10);
    if (isNaN(id) || id <= 0) {
      setLoading(false);
      return;
    }
    fetchOsmNode(id)
      .then((data) => {
        setNode(data);
        const initial: Record<string, string> = {};
        for (const f of EDITABLE_FIELDS) {
          initial[f.key] = data.tags[f.key] ?? '';
        }
        setEditedTags(initial);
      })
      .catch((e) => {
        Alert.alert('Error', `Could not load place data: ${(e as Error).message}`);
      })
      .finally(() => setLoading(false));
  }, [hydrated, isCreateMode, nodeId, paramInitialTags, createLat, createLng]);

  const setTag = useCallback((key: string, value: string) => {
    setEditedTags((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Detect which tags actually changed (create mode: all non-empty values are "changed")
  const changedTags = useMemo(() => {
    if (!node) return {};
    const changed: Record<string, string> = {};
    for (const [k, v] of Object.entries(editedTags)) {
      const original = node.tags[k] ?? '';
      if (isCreateMode ? v.trim() !== '' : v !== original) {
        changed[k] = v;
      }
    }
    return changed;
  }, [node, editedTags, isCreateMode]);

  const hasChanges = Object.keys(changedTags).length > 0;

  const handleLogin = useCallback(async () => {
    try {
      await login();
    } catch (e) {
      Alert.alert('Login Failed', (e as Error).message);
    }
  }, [login]);

  const handleSubmit = useCallback(async () => {
    if (!node || !accessToken || !hasChanges) return;

    // Validate token is still good
    const valid = await ensureValid();
    if (!valid) {
      Alert.alert('Session Expired', 'Your OSM session has expired. Please log in again.', [
        { text: 'Log In', onPress: handleLogin },
      ]);
      return;
    }

    const comment =
      changeComment.trim() ||
      (isCreateMode
        ? `Added ${poiName ?? 'place'} via Polaris Maps (source: Overture Maps)`
        : `Updated ${poiName ?? 'place'} via Polaris Maps`);

    setSubmitting(true);
    try {
      if (isCreateMode) {
        const result = await submitOsmNodeCreate(
          accessToken,
          node.lat,
          node.lon,
          changedTags,
          comment,
        );
        Alert.alert(
          'Place Added to OSM',
          `Your new place has been submitted to OpenStreetMap.\n\n` +
            `Node #${result.nodeId}\nChangeset #${result.changesetId}`,
          [{ text: 'OK', onPress: () => router.back() }],
        );
      } else {
        const result = await submitOsmNodeEdit(accessToken, node.id, changedTags, comment);
        Alert.alert(
          'Edit Submitted',
          `Your changes have been submitted to OpenStreetMap.\n\nChangeset #${result.changesetId}`,
          [{ text: 'OK', onPress: () => router.back() }],
        );
      }
    } catch (e) {
      Alert.alert('Submission Failed', (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [
    node,
    accessToken,
    hasChanges,
    changedTags,
    changeComment,
    poiName,
    isCreateMode,
    ensureValid,
    handleLogin,
    router,
  ]);

  // ── Loading state
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Invalid node (edit mode only)
  if (!node) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Could not load this place.</Text>
        <Text style={styles.errorSub}>
          {isCreateMode
            ? 'Missing coordinates. Please try again from the place details screen.'
            : 'Only OSM nodes with a positive ID can be edited.'}
        </Text>
      </View>
    );
  }

  // ── Not logged in
  if (!accessToken) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.authContent}>
        <View style={styles.authHeader}>
          <View style={styles.osmLogo}>
            <Ionicons name="map" size={40} color="#7EBC6F" />
          </View>
          <Text style={styles.authTitle}>Sign in to OpenStreetMap</Text>
          <Text style={styles.authDesc}>
            {isCreateMode
              ? 'To add this place to OpenStreetMap, you need to sign in with your OpenStreetMap account. Your addition will be submitted directly to OpenStreetMap for the community.'
              : 'To update place information, you need to sign in with your OpenStreetMap account. Your changes will be submitted directly to OpenStreetMap for the community.'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.loginButton}
          onPress={handleLogin}
          disabled={isLoggingIn}
          activeOpacity={0.8}
        >
          {isLoggingIn ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="log-in-outline" size={20} color="#fff" />
              <Text style={styles.loginButtonText}>Sign in with OpenStreetMap</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.authFooter}>
          Don't have an account?{' '}
          <Text
            style={styles.linkText}
            onPress={() => {
              Linking.openURL('https://www.openstreetmap.org/user/new');
            }}
          >
            Create one at openstreetmap.org
          </Text>
        </Text>
      </ScrollView>
    );
  }

  // ── Main edit / create form
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* User banner */}
      <View style={styles.userBanner}>
        {user?.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={16} color="#fff" />
          </View>
        )}
        <Text style={styles.userName}>
          {isCreateMode ? 'Adding as ' : 'Editing as '}
          <Text style={styles.userNameBold}>{user?.displayName ?? 'OSM User'}</Text>
        </Text>
      </View>

      <Text style={styles.heading}>
        {isCreateMode ? 'Add Place to OpenStreetMap' : 'Update Place Info'}
      </Text>
      <Text style={styles.subheading}>
        {isCreateMode
          ? 'This data comes from Overture Maps. Review and adjust before submitting to OpenStreetMap.'
          : 'Edit the fields below. Changes are submitted directly to OpenStreetMap.'}
      </Text>

      {/* Editable fields */}
      {EDITABLE_FIELDS.map((field) => (
        <View key={field.key} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text>
          <TextInput
            style={[
              styles.input,
              isCreateMode && editedTags[field.key] !== '' && styles.inputFilled,
              !isCreateMode &&
                editedTags[field.key] !== (node.tags[field.key] ?? '') &&
                styles.inputChanged,
            ]}
            value={editedTags[field.key] ?? ''}
            onChangeText={(text) => setTag(field.key, text)}
            placeholder={
              ('hint' in field ? field.hint : `Enter ${field.label.toLowerCase()}`) ?? ''
            }
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {!isCreateMode && editedTags[field.key] !== (node.tags[field.key] ?? '') && (
            <Text style={styles.changedLabel}>
              {node.tags[field.key] ? `Was: ${node.tags[field.key]}` : 'New value'}
            </Text>
          )}
          {isCreateMode && editedTags[field.key] !== '' && (
            <Text style={styles.filledLabel}>Will be added to OSM</Text>
          )}
        </View>
      ))}

      {/* Changeset comment */}
      <View style={styles.field}>
        <Text style={styles.label}>Change Comment</Text>
        <TextInput
          style={[styles.input, styles.commentInput]}
          value={changeComment}
          onChangeText={setChangeComment}
          placeholder={
            isCreateMode
              ? `Added ${poiName ?? 'place'} via Polaris Maps (source: Overture Maps)`
              : `Updated ${poiName ?? 'place'} via Polaris Maps`
          }
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={2}
        />
        <Text style={styles.hint}>Describe what you changed (visible on your OSM changeset)</Text>
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitButton, !hasChanges && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={!hasChanges || submitting}
        activeOpacity={0.8}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
            <Text style={styles.submitButtonText}>
              {isCreateMode
                ? 'Add Place to OpenStreetMap'
                : `Submit ${Object.keys(changedTags).length} ${Object.keys(changedTags).length === 1 ? 'change' : 'changes'} to OSM`}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {!hasChanges && (
        <Text style={styles.noChangesHint}>
          {isCreateMode
            ? 'Fill in at least one field above to add this place to OSM.'
            : 'Modify at least one field above to submit changes.'}
        </Text>
      )}

      <View style={styles.footer}>
        <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
        <Text style={styles.footerText}>
          {isCreateMode
            ? 'New places go live on OpenStreetMap and are reviewed by the community. Please only submit accurate information from the Overture data source.'
            : 'Changes go live on OpenStreetMap and are reviewed by the community. Please only submit accurate information.'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl * 2,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  errorText: {
    ...typography.body,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  errorSub: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // Auth screen
  authContent: {
    padding: spacing.xl,
    paddingTop: spacing.xxl * 2,
    alignItems: 'center',
  },
  authHeader: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  osmLogo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#f0f8ed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  authTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  authDesc: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#7EBC6F',
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    width: '100%',
    marginBottom: spacing.md,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  authFooter: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  linkText: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },

  // User banner
  userBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.sm,
    backgroundColor: '#f0f8ed',
    borderRadius: borderRadius.md,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarPlaceholder: {
    backgroundColor: '#7EBC6F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: {
    ...typography.bodySmall,
    color: colors.text,
  },
  userNameBold: {
    fontWeight: '700',
  },

  // Form
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  subheading: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  field: {
    marginBottom: spacing.md,
  },
  label: {
    ...typography.label,
    color: colors.text,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputChanged: {
    borderColor: '#7EBC6F',
    borderWidth: 2,
  },
  inputFilled: {
    borderColor: '#7EBC6F',
    borderWidth: 1,
  },
  commentInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  changedLabel: {
    ...typography.caption,
    color: '#7EBC6F',
    marginTop: 4,
  },
  filledLabel: {
    ...typography.caption,
    color: '#7EBC6F',
    marginTop: 4,
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
  },

  // Submit
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#7EBC6F',
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
    marginTop: spacing.md,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  noChangesHint: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    alignItems: 'flex-start',
  },
  footerText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 18,
  },
});
