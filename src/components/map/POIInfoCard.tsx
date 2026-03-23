import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Linking,
  ScrollView,
  Dimensions,
  Image,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import { useMapStore } from '../../stores/mapStore';
import { useTheme } from '../../contexts/ThemeContext';
import { getPoiCategory } from '../../utils/poiCategories';
import { enrichPoi } from '../../services/poi/poiEnricher';
import { spacing, typography, borderRadius, shadow } from '../../constants/theme';
import type { OsmPoi } from '../../services/poi/osmFetcher';

const SCREEN_H = Dimensions.get('window').height;
// Two snap points: peek (40%) and expanded (85%)
const PEEK_H = SCREEN_H * 0.42;
const FULL_H = SCREEN_H * 0.85;

// ---------------------------------------------------------------------------
// Tag parsing helpers
// ---------------------------------------------------------------------------

function buildAddress(tags: Record<string, string>): string | null {
  const num = tags['addr:housenumber'];
  const street = tags['addr:street'];
  const city = tags['addr:city'];
  const postcode = tags['addr:postcode'];
  const state = tags['addr:state'];
  const parts: string[] = [];
  if (num && street) parts.push(`${num} ${street}`);
  else if (street) parts.push(street);
  const tail = [city, state, postcode].filter(Boolean).join(' ');
  if (tail) parts.push(tail);
  return parts.length ? parts.join(', ') : null;
}

function capitalise(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Return human-readable list from semicolon-separated OSM values */
function splitTags(val: string) {
  return val.split(';').map((s) => capitalise(s.trim()));
}

/** Parse payment tags into a readable list */
function parsePayment(tags: Record<string, string>): string | null {
  const methods: string[] = [];
  const map: Record<string, string> = {
    'payment:cash': 'Cash',
    'payment:coins': 'Coins',
    'payment:cards': 'Credit/Debit Card',
    'payment:credit_cards': 'Credit Card',
    'payment:debit_cards': 'Debit Card',
    'payment:contactless': 'Contactless',
    'payment:mastercard': 'Mastercard',
    'payment:visa': 'Visa',
    'payment:amex': 'Amex',
    'payment:bitcoin': 'Bitcoin',
    'payment:paypal': 'PayPal',
    'payment:apple_pay': 'Apple Pay',
    'payment:google_pay': 'Google Pay',
  };
  for (const [key, label] of Object.entries(map)) {
    if (tags[key] === 'yes') methods.push(label);
  }
  return methods.length ? methods.join(' · ') : null;
}

/** Dietary options */
function parseDiet(tags: Record<string, string>): string | null {
  const options: string[] = [];
  if (tags['diet:vegan'] === 'yes') options.push('Vegan');
  if (tags['diet:vegan'] === 'only') options.push('Fully Vegan');
  if (tags['diet:vegetarian'] === 'yes') options.push('Vegetarian');
  if (tags['diet:vegetarian'] === 'only') options.push('Fully Vegetarian');
  if (tags['diet:gluten_free'] === 'yes') options.push('Gluten-Free');
  if (tags['diet:halal'] === 'yes') options.push('Halal');
  if (tags['diet:kosher'] === 'yes') options.push('Kosher');
  if (tags['diet:lactose_free'] === 'yes') options.push('Lactose-Free');
  return options.length ? options.join(' · ') : null;
}

/** Star rating for hotels etc */
function parseStars(tags: Record<string, string>): string | null {
  const n = parseInt(tags['stars'] ?? '', 10);
  if (!n || n < 1 || n > 5) return null;
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

interface ParsedPoi {
  address: string | null;
  hours: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  menuUrl: string | null;
  cuisine: string | null;
  description: string | null;
  imageUrl: string | null;
  wheelchair: string | null;
  outdoorSeating: boolean;
  indoorSeating: boolean;
  takeaway: string | null;
  delivery: string | null;
  reservation: string | null;
  wifi: string | null;
  smoking: string | null;
  fee: string | null;
  capacity: string | null;
  operator: string | null;
  brand: string | null;
  level: string | null;
  stars: string | null;
  payment: string | null;
  diet: string | null;
  facebook: string | null;
  instagram: string | null;
  twitter: string | null;
  note: string | null;
}

function parsePoi(poi: OsmPoi): ParsedPoi {
  const t = poi.tags;
  return {
    address: buildAddress(t),
    hours: t['opening_hours'] ?? null,
    phone: t['phone'] ?? t['contact:phone'] ?? t['telephone'] ?? null,
    email: t['email'] ?? t['contact:email'] ?? null,
    website: t['website'] ?? t['contact:website'] ?? t['url'] ?? null,
    menuUrl: t['website:menu'] ?? t['menu'] ?? null,
    cuisine: t['cuisine'] ? splitTags(t['cuisine']).join(' · ') : null,
    description: t['description'] ?? t['description:en'] ?? null,
    imageUrl: t['image'] ?? null,
    wheelchair: t['wheelchair'] ?? null,
    outdoorSeating: t['outdoor_seating'] === 'yes',
    indoorSeating: t['indoor_seating'] === 'yes',
    takeaway:
      t['takeaway'] === 'yes'
        ? 'Takeaway available'
        : t['takeaway'] === 'only'
          ? 'Takeaway only'
          : t['takeaway'] === 'no'
            ? null
            : null,
    delivery: t['delivery'] === 'yes' ? 'Delivery available' : t['delivery'] === 'no' ? null : null,
    reservation:
      t['reservation'] === 'yes'
        ? 'Reservation accepted'
        : t['reservation'] === 'required'
          ? 'Reservation required'
          : null,
    wifi: t['wifi'] === 'yes' || t['internet_access'] === 'wlan' ? 'Wi-Fi available' : null,
    smoking:
      t['smoking'] === 'no'
        ? 'No smoking'
        : t['smoking'] === 'yes'
          ? 'Smoking permitted'
          : t['smoking'] === 'outside'
            ? 'Smoking outside only'
            : null,
    fee: t['fee'] === 'yes' ? (t['charge'] ?? 'Fee applies') : null,
    capacity: t['capacity'] ? `Capacity: ${t['capacity']}` : null,
    operator: t['operator'] ?? null,
    brand: t['brand'] ?? null,
    level: t['level'] ? `Floor ${t['level']}` : null,
    stars: parseStars(t),
    payment: parsePayment(t),
    diet: parseDiet(t),
    facebook: t['contact:facebook'] ?? t['facebook'] ?? null,
    instagram: t['contact:instagram'] ?? t['instagram'] ?? null,
    twitter: t['contact:twitter'] ?? t['twitter'] ?? null,
    note: t['note'] ?? t['note:en'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface InfoRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
  label: string;
  onPress?: () => void;
  textColor: string;
  subtextColor: string;
  borderColor: string;
  isLast?: boolean;
}

function InfoRow({
  icon,
  iconColor,
  label,
  onPress,
  textColor,
  subtextColor,
  borderColor,
  isLast,
}: InfoRowProps) {
  const content = (
    <View
      style={[
        rowStyles.row,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor },
      ]}
    >
      <View style={rowStyles.iconWrap}>
        <Ionicons name={icon} size={17} color={iconColor ?? subtextColor} />
      </View>
      <Text style={[rowStyles.label, { color: textColor }]} numberOfLines={3}>
        {label}
      </Text>
      {onPress && <Ionicons name="chevron-forward" size={14} color={subtextColor} />}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.6}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    gap: 12,
    minHeight: 44,
  },
  iconWrap: {
    width: 22,
    alignItems: 'center',
  },
  label: {
    ...typography.bodySmall,
    flex: 1,
  },
});

interface ActionPillProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  color: string;
  bg: string;
}

function ActionPill({ icon, label, onPress, color, bg }: ActionPillProps) {
  return (
    <TouchableOpacity
      style={[pillStyles.pill, { backgroundColor: bg }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[pillStyles.label, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.lg,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
    minWidth: 68,
    flex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
});

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

export function POIInfoCard() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const setPendingDirectionsTarget = useMapStore((s) => s.setPendingDirectionsTarget);
  const selectedPoi = useOsmPoiStore((s) => s.selectedPoi);
  const setSelectedPoi = useOsmPoiStore((s) => s.setSelectedPoi);
  // Track whether the Clearbit logo failed to load (e.g. 404 for unknown brands)
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  // Use a ref so PanResponder closures always read the latest value
  const expandedRef = useRef(false);

  // Single translateY drives everything — fully native-driver-compatible.
  // Card is always FULL_H tall; translateY controls how much peeks above the bottom edge:
  //   hidden   → FULL_H   (completely off-screen)
  //   peeking  → FULL_H − PEEK_H
  //   expanded → 0
  const translateY = useRef(new Animated.Value(FULL_H)).current;

  const animateTo = useCallback(
    (toValue: number, spring = true) => {
      if (spring) {
        Animated.spring(translateY, {
          toValue,
          useNativeDriver: true,
          tension: 60,
          friction: 10,
        }).start();
      } else {
        Animated.timing(translateY, {
          toValue,
          duration: 250,
          useNativeDriver: true,
        }).start();
      }
    },
    [translateY],
  );

  const setExpandedBoth = useCallback((next: boolean) => {
    expandedRef.current = next;
  }, []);

  // Slide in/out when POI selection changes
  useEffect(() => {
    setExpandedBoth(false);
    animateTo(selectedPoi ? FULL_H - PEEK_H : FULL_H, !!selectedPoi);
  }, [selectedPoi, animateTo, setExpandedBoth]);

  // Toggle between peek and expanded
  const toggleExpanded = useCallback(() => {
    const next = !expandedRef.current;
    setExpandedBoth(next);
    animateTo(next ? 0 : FULL_H - PEEK_H);
  }, [animateTo, setExpandedBoth]);

  // Track scroll position so we know when to allow collapse on downward drag
  const scrollAtTop = useRef(true);

  const pan = useRef(
    PanResponder.create({
      // Only claim the gesture when on the handle bar
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, gs) =>
        Math.abs(gs.dy) > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderRelease: (_e, gs) => {
        if (gs.dy < -30) {
          // Swipe up → expand
          setExpandedBoth(true);
          animateTo(0);
        } else if (gs.dy > 30) {
          if (expandedRef.current) {
            setExpandedBoth(false);
            animateTo(FULL_H - PEEK_H);
          } else {
            setSelectedPoi(null);
          }
        }
      },
    }),
  ).current;

  const poi = selectedPoi;
  const enrichedData = useOsmPoiStore((s) => s.enrichedData);
  const setEnrichedData = useOsmPoiStore((s) => s.setEnrichedData);
  const setIsEnriching = useOsmPoiStore((s) => s.setIsEnriching);
  const rawParsed = useMemo(() => (poi ? parsePoi(poi) : null), [poi]);

  // Reset logo error state when POI changes
  useEffect(() => {
    setLogoLoadFailed(false);
  }, [poi?.id]);

  // Trigger Apple Maps enrichment when a POI is selected
  useEffect(() => {
    if (!poi) return;
    let cancelled = false;
    setIsEnriching(true);
    enrichPoi(poi)
      .then((data) => {
        if (!cancelled) setEnrichedData(data);
      })
      .catch(() => {
        /* enrichment is best-effort */
      })
      .finally(() => {
        if (!cancelled) setIsEnriching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [poi, setEnrichedData, setIsEnriching]);

  // Merge OSM parsed data with Apple Maps enrichment — OSM takes priority
  const parsed = useMemo(() => {
    if (!rawParsed) return null;
    if (!enrichedData) return rawParsed;
    return {
      ...rawParsed,
      // Apple Maps provides formatted addresses for POIs OSM left blank
      address: rawParsed.address ?? enrichedData.formattedAddress ?? null,
      // Native MapKit provides phone/website that OSM often lacks
      phone: rawParsed.phone ?? enrichedData.phone ?? null,
      website: rawParsed.website ?? enrichedData.website ?? null,
      // Opening hours from MapKit (iOS 16+)
      hours: rawParsed.hours ?? enrichedData.openingHours ?? null,
    };
  }, [rawParsed, enrichedData]);

  const category = poi ? getPoiCategory(poi.type, poi.subtype) : null;

  // Theme shorthands
  const bg = colors.surface;
  const textColor = colors.text;
  const subtextColor = colors.textSecondary;
  const borderColor = colors.border;
  const primary = colors.primary;
  // Pill button background — subtle tint of surface
  const pillBg = colors.background;

  const handlePhone = useCallback(() => {
    if (parsed?.phone) Linking.openURL(`tel:${parsed.phone.replace(/\s+/g, '')}`);
  }, [parsed?.phone]);

  const handleWebsite = useCallback(() => {
    if (parsed?.website) {
      const url = parsed.website.startsWith('http') ? parsed.website : `https://${parsed.website}`;
      Linking.openURL(url);
    }
  }, [parsed?.website]);

  const handleMenu = useCallback(() => {
    if (parsed?.menuUrl) {
      const url = parsed.menuUrl.startsWith('http') ? parsed.menuUrl : `https://${parsed.menuUrl}`;
      Linking.openURL(url);
    }
  }, [parsed?.menuUrl]);

  const handleEmail = useCallback(() => {
    if (parsed?.email) Linking.openURL(`mailto:${parsed.email}`);
  }, [parsed?.email]);

  const handleFacebook = useCallback(() => {
    if (parsed?.facebook)
      Linking.openURL(
        parsed.facebook.startsWith('http')
          ? parsed.facebook
          : `https://facebook.com/${parsed.facebook}`,
      );
  }, [parsed?.facebook]);

  const handleDirections = useCallback(() => {
    if (!poi) return;
    setPendingDirectionsTarget({
      lat: poi.lat,
      lng: poi.lng,
      name: poi.name,
    });
    setSelectedPoi(null);
  }, [poi, setPendingDirectionsTarget, setSelectedPoi]);

  const handleInstagram = useCallback(() => {
    if (parsed?.instagram)
      Linking.openURL(
        parsed.instagram.startsWith('http')
          ? parsed.instagram
          : `https://instagram.com/${parsed.instagram}`,
      );
  }, [parsed?.instagram]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: bg,
          bottom: 0,
          height: FULL_H,
          transform: [{ translateY }],
          paddingBottom: insets.bottom,
        },
        shadow.lg,
      ]}
    >
      {/* Drag handle + close — attach PanResponder here so it doesn't conflict with scroll */}
      <View {...pan.panHandlers} style={styles.topBar}>
        <TouchableOpacity
          onPress={toggleExpanded}
          style={styles.handleWrap}
          hitSlop={{ top: 16, bottom: 16, left: 80, right: 80 }}
        >
          <View style={[styles.handle, { backgroundColor: borderColor }]} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => setSelectedPoi(null)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <View style={[styles.closeCircle, { backgroundColor: pillBg }]}>
            <Ionicons name="close" size={16} color={subtextColor} />
          </View>
        </TouchableOpacity>
      </View>

      {poi && parsed && category && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled
          onScrollBeginDrag={() => {
            scrollAtTop.current = false;
          }}
          onScroll={(e) => {
            scrollAtTop.current = e.nativeEvent.contentOffset.y <= 0;
          }}
          scrollEventThrottle={100}
          onScrollEndDrag={(e) => {
            // If dragging down from top while peeking, collapse the card
            if (
              scrollAtTop.current &&
              e.nativeEvent.velocity &&
              e.nativeEvent.velocity.y > 0.5 &&
              !expandedRef.current
            ) {
              setSelectedPoi(null);
            }
          }}
        >
          {/* ── Hero image ────────────────────────────────────────────── */}
          {parsed.imageUrl && (
            <Image source={{ uri: parsed.imageUrl }} style={styles.heroImage} resizeMode="cover" />
          )}

          {/* ── Header ────────────────────────────────────────────────── */}
          <View style={styles.header}>
            {enrichedData?.logoUrl && !logoLoadFailed ? (
              <Image
                source={{ uri: enrichedData.logoUrl }}
                style={styles.brandLogo}
                resizeMode="contain"
                onError={() => setLogoLoadFailed(true)}
              />
            ) : (
              <View style={[styles.categoryCircle, { backgroundColor: category.color }]}>
                <Ionicons name={category.icon} size={22} color="#FFFFFF" />
              </View>
            )}
            <View style={styles.headerText}>
              <Text style={[styles.name, { color: textColor }]} numberOfLines={2}>
                {poi.name}
              </Text>
              <Text style={[styles.categoryLabel, { color: subtextColor }]}>
                {enrichedData?.poiCategory ?? capitalise(poi.subtype)}
                {parsed.cuisine ? ` · ${parsed.cuisine}` : ''}
                {parsed.stars ? ` · ${parsed.stars}` : ''}
              </Text>
              {(parsed.brand ?? parsed.operator) && (
                <Text style={[styles.operatorLabel, { color: subtextColor }]}>
                  {parsed.brand ?? parsed.operator}
                </Text>
              )}
            </View>
          </View>

          {/* ── Action pill buttons ────────────────────────────────────── */}
          <View style={styles.actions}>
            <ActionPill
              icon="navigate"
              label="Directions"
              onPress={handleDirections}
              color={primary}
              bg={pillBg}
            />
            {parsed.phone && (
              <ActionPill
                icon="call"
                label="Call"
                onPress={handlePhone}
                color={primary}
                bg={pillBg}
              />
            )}
            {parsed.website && (
              <ActionPill
                icon="globe"
                label="Website"
                onPress={handleWebsite}
                color={primary}
                bg={pillBg}
              />
            )}
            {parsed.menuUrl && (
              <ActionPill
                icon="restaurant-outline"
                label="Menu"
                onPress={handleMenu}
                color={primary}
                bg={pillBg}
              />
            )}
            {parsed.email && (
              <ActionPill
                icon="mail"
                label="Email"
                onPress={handleEmail}
                color={primary}
                bg={pillBg}
              />
            )}
          </View>

          {/* ── Description ───────────────────────────────────────────── */}
          {parsed.description && (
            <View style={[styles.section, { borderColor }]}>
              <Text style={[styles.sectionDescription, { color: subtextColor }]}>
                {parsed.description}
              </Text>
            </View>
          )}

          {/* ── Info rows ─────────────────────────────────────────────── */}
          <View
            style={[
              styles.section,
              {
                borderColor,
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: borderRadius.lg,
                overflow: 'hidden',
              },
            ]}
          >
            {[
              parsed.address && {
                icon: 'location-outline' as const,
                label: parsed.address,
              },
              parsed.hours && {
                icon: 'time-outline' as const,
                label: parsed.hours,
              },
              parsed.phone && {
                icon: 'call-outline' as const,
                label: parsed.phone,
                onPress: handlePhone,
                iconColor: primary,
              },
              parsed.website && {
                icon: 'globe-outline' as const,
                label: new URL(
                  parsed.website.startsWith('http') ? parsed.website : `https://${parsed.website}`,
                ).hostname.replace(/^www\./, ''),
                onPress: handleWebsite,
                iconColor: primary,
              },
              parsed.email && {
                icon: 'mail-outline' as const,
                label: parsed.email,
                onPress: handleEmail,
                iconColor: primary,
              },
              parsed.wheelchair === 'yes' && {
                icon: 'accessibility-outline' as const,
                label: 'Wheelchair accessible',
                iconColor: colors.success,
              },
              parsed.wheelchair === 'limited' && {
                icon: 'accessibility-outline' as const,
                label: 'Limited wheelchair access',
              },
              parsed.wheelchair === 'no' && {
                icon: 'accessibility-outline' as const,
                label: 'Not wheelchair accessible',
                iconColor: colors.error,
              },
              parsed.wifi && {
                icon: 'wifi-outline' as const,
                label: parsed.wifi,
                iconColor: colors.success,
              },
              parsed.outdoorSeating && {
                icon: 'sunny-outline' as const,
                label: 'Outdoor seating',
              },
              parsed.indoorSeating && {
                icon: 'home-outline' as const,
                label: 'Indoor seating',
              },
              parsed.takeaway && {
                icon: 'bag-outline' as const,
                label: parsed.takeaway,
              },
              parsed.delivery && {
                icon: 'bicycle-outline' as const,
                label: parsed.delivery,
                iconColor: colors.success,
              },
              parsed.reservation && {
                icon: 'calendar-outline' as const,
                label: parsed.reservation,
              },
              parsed.smoking && {
                icon: 'ban-outline' as const,
                label: parsed.smoking,
              },
              parsed.fee && {
                icon: 'pricetag-outline' as const,
                label: parsed.fee,
              },
              parsed.level && {
                icon: 'layers-outline' as const,
                label: parsed.level,
              },
              parsed.capacity && {
                icon: 'people-outline' as const,
                label: parsed.capacity,
              },
              parsed.payment && {
                icon: 'card-outline' as const,
                label: parsed.payment,
              },
              parsed.diet && {
                icon: 'leaf-outline' as const,
                label: parsed.diet,
                iconColor: colors.success,
              },
            ]
              .filter(Boolean)
              .map((row, i, arr) => {
                const r = row as {
                  icon: React.ComponentProps<typeof Ionicons>['name'];
                  label: string;
                  onPress?: () => void;
                  iconColor?: string;
                };
                return (
                  <InfoRow
                    key={i}
                    icon={r.icon}
                    label={r.label}
                    onPress={r.onPress}
                    iconColor={r.iconColor}
                    textColor={textColor}
                    subtextColor={subtextColor}
                    borderColor={borderColor}
                    isLast={i === arr.length - 1}
                  />
                );
              })}
          </View>

          {/* ── Social media ──────────────────────────────────────────── */}
          {(parsed.facebook || parsed.instagram || parsed.twitter) && (
            <View style={styles.socialRow}>
              {parsed.facebook && (
                <TouchableOpacity
                  onPress={handleFacebook}
                  style={[styles.socialBtn, { backgroundColor: pillBg }]}
                >
                  <Text style={[styles.socialLabel, { color: primary }]}>Facebook</Text>
                </TouchableOpacity>
              )}
              {parsed.instagram && (
                <TouchableOpacity
                  onPress={handleInstagram}
                  style={[styles.socialBtn, { backgroundColor: pillBg }]}
                >
                  <Text style={[styles.socialLabel, { color: primary }]}>Instagram</Text>
                </TouchableOpacity>
              )}
              {parsed.twitter && (
                <TouchableOpacity
                  onPress={() =>
                    Linking.openURL(
                      parsed.twitter!.startsWith('http')
                        ? parsed.twitter!
                        : `https://twitter.com/${parsed.twitter}`,
                    )
                  }
                  style={[styles.socialBtn, { backgroundColor: pillBg }]}
                >
                  <Text style={[styles.socialLabel, { color: primary }]}>X / Twitter</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── Note ──────────────────────────────────────────────────── */}
          {parsed.note && (
            <View style={[styles.noteBox, { backgroundColor: pillBg, borderColor }]}>
              <Ionicons
                name="information-circle-outline"
                size={15}
                color={subtextColor}
                style={{ marginTop: 1 }}
              />
              <Text style={[styles.noteText, { color: subtextColor }]}>{parsed.note}</Text>
            </View>
          )}
        </ScrollView>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    overflow: 'hidden',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  handleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  closeBtn: {
    position: 'absolute',
    right: spacing.md,
  },
  closeCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  heroImage: {
    width: '100%',
    height: 160,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  categoryCircle: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  brandLogo: {
    width: 48,
    height: 48,
    borderRadius: 12,
    flexShrink: 0,
    backgroundColor: '#ffffff',
  },
  headerText: {
    flex: 1,
    paddingRight: spacing.md,
  },
  name: {
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 26,
    marginBottom: 2,
  },
  categoryLabel: {
    ...typography.bodySmall,
    marginBottom: 1,
  },
  operatorLabel: {
    ...typography.caption,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  section: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  sectionDescription: {
    ...typography.bodySmall,
    lineHeight: 20,
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },
  socialRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  socialBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.round,
  },
  socialLabel: {
    ...typography.label,
  },
  noteBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  noteText: {
    ...typography.caption,
    flex: 1,
    lineHeight: 18,
  },
});
