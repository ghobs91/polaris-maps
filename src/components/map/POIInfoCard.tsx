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
  PanResponder,
  Modal as RNModal,
  Image,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassView } from '../common/GlassView';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import { useMapStore } from '../../stores/mapStore';
import { useTheme } from '../../contexts/ThemeContext';
import { getPoiCategory } from '../../utils/poiCategories';
import { enrichPoi } from '../../services/poi/poiEnricher';
import { isMapSelectionPoi } from '../../services/poi/mapSelectionPoi';
import { PlaceDetailEmbed } from './PlaceDetailEmbed';
import { buildPlaceDetailUrl } from '../../services/poi/placeDetailEmbed';
import { spacing, typography, borderRadius } from '../../constants/theme';
import type { OsmPoi } from '../../services/poi/osmFetcher';
import { SaveToListSheet } from '../places/SaveToListSheet';
import {
  fetchChargingStations,
  type ChargingStation,
  type ChargingConnection,
} from '../../services/poi/openChargeMapService';

const SCREEN_H = Dimensions.get('window').height;
// Two snap points: peek (55%) and expanded (85%)
const PEEK_H = SCREEN_H * 0.55;
const FULL_H = SCREEN_H * 0.85;
// Height of the card hidden below the screen edge in peek (non-expanded) mode.
const PEEK_OFFSET = FULL_H - PEEK_H;

// Tri-state resolution of the MapKit embed: pending (still loading), embedded
// (showing Apple's card), or hidden (embed unavailable — show full OSM fields).
type EmbedState = 'pending' | 'embedded' | 'hidden';

// ---------------------------------------------------------------------------
// Tag parsing helpers
// ---------------------------------------------------------------------------

function buildAddress(tags: Record<string, string>): string | null {
  const full = tags['addr:full'] ?? tags['address'];
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
  return parts.length ? parts.join(', ') : (full ?? null);
}

function capitalise(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Map raw MKPOI category strings (from MapKit enrichment) to human-readable labels. */
const MKPOI_LABELS: Record<string, string> = {
  MKPOICategoryRestaurant: 'Restaurant',
  MKPOICategoryCafe: 'Café',
  MKPOICategoryBakery: 'Bakery',
  MKPOICategoryNightlife: 'Nightlife',
  MKPOICategoryGasStation: 'Gas Station',
  MKPOICategoryParking: 'Parking',
  MKPOICategoryHospital: 'Hospital',
  MKPOICategoryPharmacy: 'Pharmacy',
  MKPOICategorySchool: 'School',
  MKPOICategoryUniversity: 'University',
  MKPOICategoryLibrary: 'Library',
  MKPOICategoryMuseum: 'Museum',
  MKPOICategoryTheater: 'Theatre',
  MKPOICategoryPark: 'Park',
  MKPOICategoryBeach: 'Beach',
  MKPOICategoryStore: 'Store',
  MKPOICategoryGrocery: 'Grocery',
  MKPOICategoryFitnessCenter: 'Fitness Center',
  MKPOICategoryHotel: 'Hotel',
  MKPOICategoryBank: 'Bank',
  MKPOICategoryATM: 'ATM',
  MKPOICategoryPostOffice: 'Post Office',
  MKPOICategoryLaundry: 'Laundry',
  MKPOICategoryCarRental: 'Car Rental',
  MKPOICategoryAmusementPark: 'Amusement Park',
  MKPOICategoryAquarium: 'Aquarium',
  MKPOICategoryZoo: 'Zoo',
  MKPOICategoryMovieTheater: 'Cinema',
};

/** Return a clean human-readable category label, handling both MKPOI raw strings and OSM subtypes. */
function formatPoiCategory(rawCategory: string): string {
  return MKPOI_LABELS[rawCategory] ?? capitalise(rawCategory);
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
  fillColor: string;
  borderColor: string;
}

function ActionPill({ icon, label, onPress, color, fillColor, borderColor }: ActionPillProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <View style={[pillStyles.pill, { backgroundColor: fillColor, borderColor }]}>
        <Ionicons
          name={icon}
          size={20}
          color={color}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <Text
          style={[pillStyles.label, { color }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.lg,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
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
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const setPendingDirectionsTarget = useMapStore((s) => s.setPendingDirectionsTarget);
  const selectedPoi = useOsmPoiStore((s) => s.selectedPoi);
  const setSelectedPoi = useOsmPoiStore((s) => s.setSelectedPoi);
  const [showSaveSheet, setShowSaveSheet] = useState(false);
  // Track whether the Clearbit logo failed to load (e.g. 404 for unknown brands)
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  // Resolution state of the MapKit "Photos & Reviews" embed. The card stays in
  // a loading state until the embed's fate is known so OSM fields don't flash
  // in and then disappear.
  const [embedState, setEmbedState] = useState<EmbedState>('pending');
  // Reactive expanded flag (mirrors expandedRef) so the ScrollView's bottom
  // padding can compensate for the portion of the card hidden in peek mode.
  const [expanded, setExpanded] = useState(false);
  // Use a ref so PanResponder closures always read the latest value
  const expandedRef = useRef(false);
  // EV charging station data from Open Charge Map
  const [chargingData, setChargingData] = useState<ChargingStation | null>(null);

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
    setExpanded(next);
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

  // Whether the embed can never appear for this POI (transient map-selection
  // pin, or the hosted MapKit page/token is unconfigured). Used to skip the
  // loading state and go straight to full OSM fields.
  const embedHiddenImmediately = useMemo(
    () => (poi ? isMapSelectionPoi(poi) || !buildPlaceDetailUrl(poi, 'adaptive') : true),
    [poi],
  );

  // Reset logo error state when POI changes
  useEffect(() => {
    setLogoLoadFailed(false);
    setEmbedState(embedHiddenImmediately ? 'hidden' : 'pending');
  }, [embedHiddenImmediately]);

  // Trigger Apple Maps enrichment when a POI is selected
  useEffect(() => {
    if (!poi || isMapSelectionPoi(poi)) {
      setEnrichedData(null);
      setIsEnriching(false);
      return;
    }
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

  // Fetch EV charging data from Open Charge Map when a charging station is selected
  useEffect(() => {
    if (!poi || poi.subtype !== 'charging_station') {
      setChargingData(null);
      return;
    }

    let cancelled = false;
    fetchChargingStations(poi.lat, poi.lng, 0.1, 1) // Search within 100m for exact match
      .then((stations) => {
        if (!cancelled && stations.length > 0) {
          setChargingData(stations[0]);
        } else if (!cancelled) {
          setChargingData(null);
        }
      })
      .catch(() => {
        if (!cancelled) setChargingData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [poi]);

  // Merge OSM parsed data with Apple Maps enrichment — OSM takes priority
  const parsed = useMemo(() => {
    if (!rawParsed) return null;
    if (!poi || isMapSelectionPoi(poi)) return rawParsed;
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
  }, [rawParsed, enrichedData, poi]);

  const category = poi ? getPoiCategory(poi.type, poi.subtype) : null;

  // Theme shorthands
  const textColor = colors.text;
  const subtextColor = colors.textSecondary;
  const borderColor = colors.border;
  const primary = colors.primary;
  // Action pill colors — Apple Maps-style: the primary "Directions" pill is a
  // filled tint with white content; the rest are soft tinted surfaces with
  // tinted icon/label (mirrors the TransportModeSelector chips).
  const pillPrimaryFill = primary;
  const pillPrimaryContent = colors.white;
  const pillSecondaryFill = isDark ? 'rgba(64,156,255,0.22)' : 'rgba(0,122,255,0.12)';
  const pillSecondaryContent = isDark ? colors.primaryLight : primary;
  const pillSecondaryBorder = isDark ? 'rgba(64,156,255,0.35)' : 'rgba(0,122,255,0.25)';

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

  const handleShare = useCallback(async () => {
    if (!poi) return;
    const lines = [poi.name];
    if (parsed?.address) lines.push(parsed.address);
    if (parsed?.website) {
      const url = parsed.website.startsWith('http') ? parsed.website : `https://${parsed.website}`;
      lines.push(url);
    }
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // User cancelled or share failed silently
    }
  }, [poi, parsed]);

  const handleInstagram = useCallback(() => {
    if (parsed?.instagram)
      Linking.openURL(
        parsed.instagram.startsWith('http')
          ? parsed.instagram
          : `https://instagram.com/${parsed.instagram}`,
      );
  }, [parsed?.instagram]);

  // Info rows. When the MapKit embed is showing, rows it already displays
  // (address, hours, phone, website, email) are dropped as redundant; the
  // section is skipped entirely if nothing remains.
  type InfoRowData = {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress?: () => void;
    iconColor?: string;
  };
  const rawInfoRows: Array<InfoRowData | '' | false | null | undefined> = parsed
    ? [
        parsed.address &&
          embedState === 'hidden' && {
            icon: 'location-outline' as const,
            label: parsed.address,
          },
        parsed.hours &&
          embedState === 'hidden' && {
            icon: 'time-outline' as const,
            label: parsed.hours,
          },
        parsed.phone &&
          embedState === 'hidden' && {
            icon: 'call-outline' as const,
            label: parsed.phone,
            onPress: handlePhone,
            iconColor: primary,
          },
        parsed.website &&
          embedState === 'hidden' && {
            icon: 'globe-outline' as const,
            label: new URL(
              parsed.website.startsWith('http') ? parsed.website : `https://${parsed.website}`,
            ).hostname.replace(/^www\./, ''),
            onPress: handleWebsite,
            iconColor: primary,
          },
        parsed.email &&
          embedState === 'hidden' && {
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
        // EV Charging information from Open Charge Map
        // Show each connector with its charging speed (power in kW)
        ...(chargingData?.connections?.length
          ? chargingData.connections.map((conn: ChargingConnection) => {
              const speed = conn.powerKW ? ` · ${conn.powerKW} kW` : '';
              const fastBadge = conn.isFastCharge ? ' ⚡' : '';
              return {
                icon: (conn.isFastCharge ? 'flash' : 'flash-outline') as InfoRowData['icon'],
                label: `${conn.type}${speed}${fastBadge}`,
                iconColor: conn.isFastCharge ? colors.success : undefined,
              };
            })
          : []),
        chargingData?.pricing && {
          icon: 'pricetag-outline' as const,
          label: chargingData.pricing,
        },
        chargingData?.accessType === 'public' && {
          icon: 'people-outline' as const,
          label: 'Public access',
        },
        chargingData?.accessType === 'members_only' && {
          icon: 'lock-closed-outline' as const,
          label: 'Members only',
          iconColor: colors.warning,
        },
        chargingData?.operator && {
          icon: 'business-outline' as const,
          label: `Operator: ${chargingData.operator}`,
        },
      ]
    : [];
  const infoRows = rawInfoRows.filter((row): row is InfoRowData => !!row);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          bottom: 0,
          height: FULL_H,
          transform: [{ translateY }],
        },
      ]}
    >
      <GlassView material="regular" style={[styles.cardGlass, { paddingBottom: insets.bottom }]}>
        {/* Grabber + share/close — attach PanResponder here so it doesn't conflict with scroll */}
        <View {...pan.panHandlers}>
          <View style={styles.topBar}>
            <TouchableOpacity
              onPress={toggleExpanded}
              style={styles.handleWrap}
              hitSlop={{ top: 16, bottom: 16, left: 80, right: 80 }}
            >
              <View style={[styles.handle, { backgroundColor: borderColor }]} />
            </TouchableOpacity>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity
              onPress={handleShare}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Share place"
              accessibilityRole="button"
            >
              <GlassView material="clear" isInteractive style={styles.closeCircle}>
                <Ionicons name="share-outline" size={18} color={subtextColor} />
              </GlassView>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSelectedPoi(null)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Close place details"
              accessibilityRole="button"
            >
              <GlassView material="clear" isInteractive style={styles.closeCircle}>
                <Ionicons name="close" size={18} color={subtextColor} />
              </GlassView>
            </TouchableOpacity>
          </View>
        </View>

        {poi && parsed && category && (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              {
                // In peek mode the card's lower portion sits below the screen
                // edge; add that hidden amount as bottom padding so the last
                // content stays reachable. Expanded mode only needs breathing
                // room.
                paddingBottom: spacing.xxl + insets.bottom + (expanded ? 0 : PEEK_OFFSET),
              },
            ]}
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
              <Image
                source={{ uri: parsed.imageUrl }}
                style={styles.heroImage}
                resizeMode="cover"
              />
            )}

            {/* ── Header (hidden when the MapKit embed loads — it shows
                  name, category and brand itself) ───────────────────────── */}
            {embedState === 'hidden' && (
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
                  <Text
                    style={[styles.name, { color: textColor }]}
                    numberOfLines={2}
                    accessibilityRole="header"
                    accessibilityLabel={poi.name}
                  >
                    {poi.name}
                  </Text>
                  <Text style={[styles.categoryLabel, { color: subtextColor }]}>
                    {enrichedData?.poiCategory
                      ? formatPoiCategory(enrichedData.poiCategory)
                      : capitalise(poi.subtype)}
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
            )}

            {/* ── Action pill buttons ────────────────────────────────────── */}
            <View style={styles.actions}>
              <ActionPill
                icon="navigate"
                label="Directions"
                onPress={handleDirections}
                color={pillPrimaryContent}
                fillColor={pillPrimaryFill}
                borderColor={pillPrimaryFill}
              />
              {parsed.phone && (
                <ActionPill
                  icon="call"
                  label="Call"
                  onPress={handlePhone}
                  color={pillSecondaryContent}
                  fillColor={pillSecondaryFill}
                  borderColor={pillSecondaryBorder}
                />
              )}
              {parsed.website && (
                <ActionPill
                  icon="globe"
                  label="Website"
                  onPress={handleWebsite}
                  color={pillSecondaryContent}
                  fillColor={pillSecondaryFill}
                  borderColor={pillSecondaryBorder}
                />
              )}
              {parsed.menuUrl && (
                <ActionPill
                  icon="restaurant-outline"
                  label="Menu"
                  onPress={handleMenu}
                  color={pillSecondaryContent}
                  fillColor={pillSecondaryFill}
                  borderColor={pillSecondaryBorder}
                />
              )}
              {parsed.email && (
                <ActionPill
                  icon="mail"
                  label="Email"
                  onPress={handleEmail}
                  color={pillSecondaryContent}
                  fillColor={pillSecondaryFill}
                  borderColor={pillSecondaryBorder}
                />
              )}
              <ActionPill
                icon="bookmark-outline"
                label="Save"
                onPress={() => setShowSaveSheet(true)}
                color={pillSecondaryContent}
                fillColor={pillSecondaryFill}
                borderColor={pillSecondaryBorder}
              />
            </View>

            {/* ── Photos & Reviews (Apple MapKit JS PlaceDetail embed) ─── */}
            <PlaceDetailEmbed
              poi={poi}
              onLoaded={() => setEmbedState('embedded')}
              onFailed={() => setEmbedState((prev) => (prev === 'pending' ? 'hidden' : prev))}
            />

            <RNModal
              visible={showSaveSheet}
              animationType="slide"
              presentationStyle="pageSheet"
              onRequestClose={() => setShowSaveSheet(false)}
            >
              {poi && (
                <SaveToListSheet
                  poiUuid={String(poi.id)}
                  placeName={poi.name}
                  lat={poi.lat}
                  lng={poi.lng}
                  address={parsed?.address ?? undefined}
                  category={poi.subtype}
                  onDone={() => setShowSaveSheet(false)}
                />
              )}
            </RNModal>

            {/* ── Description ───────────────────────────────────────────── */}
            {parsed.description && (
              <GlassView material="regular" style={[styles.section, { borderColor }]}>
                <Text style={[styles.sectionDescription, { color: subtextColor }]}>
                  {parsed.description}
                </Text>
              </GlassView>
            )}

            {/* ── Info rows ─────────────────────────────────────────────── */}
            {infoRows.length > 0 && (
              <GlassView
                material="regular"
                style={[
                  styles.section,
                  {
                    borderRadius: borderRadius.lg,
                    overflow: 'hidden',
                  },
                ]}
              >
                {infoRows.map((row, i) => (
                  <InfoRow
                    key={i}
                    icon={row.icon}
                    label={row.label}
                    onPress={row.onPress}
                    iconColor={row.iconColor}
                    textColor={textColor}
                    subtextColor={subtextColor}
                    borderColor={borderColor}
                    isLast={i === infoRows.length - 1}
                  />
                ))}
              </GlassView>
            )}

            {(parsed.facebook || parsed.instagram || parsed.twitter) && (
              <View style={styles.socialRow}>
                {parsed.facebook && (
                  <TouchableOpacity onPress={handleFacebook}>
                    <GlassView material="regular" isInteractive style={styles.socialBtn}>
                      <Text style={[styles.socialLabel, { color: primary }]}>Facebook</Text>
                    </GlassView>
                  </TouchableOpacity>
                )}
                {parsed.instagram && (
                  <TouchableOpacity onPress={handleInstagram}>
                    <GlassView material="regular" isInteractive style={styles.socialBtn}>
                      <Text style={[styles.socialLabel, { color: primary }]}>Instagram</Text>
                    </GlassView>
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
                  >
                    <GlassView material="regular" isInteractive style={styles.socialBtn}>
                      <Text style={[styles.socialLabel, { color: primary }]}>X / Twitter</Text>
                    </GlassView>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ── Note ──────────────────────────────────────────────────── */}
            {parsed.note && (
              <GlassView material="regular" style={styles.noteBox}>
                <Ionicons
                  name="information-circle-outline"
                  size={15}
                  color={subtextColor}
                  style={{ marginTop: 1 }}
                />
                <Text style={[styles.noteText, { color: subtextColor }]}>{parsed.note}</Text>
              </GlassView>
            )}

            {/* ── Update Place Info (OSM edit) ──────────────────────── */}
            {selectedPoi && selectedPoi.id > 0 && (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  router.push({
                    pathname: '/poi/osm-edit',
                    params: {
                      nodeId: String(selectedPoi.id),
                      name: selectedPoi.name || '',
                    },
                  });
                }}
              >
                <GlassView material="regular" isInteractive style={styles.updatePlaceBtn}>
                  <Ionicons name="create-outline" size={18} color={primary} />
                  <Text style={[styles.updatePlaceBtnText, { color: primary }]}>
                    Update Place Info
                  </Text>
                </GlassView>
              </TouchableOpacity>
            )}

            {/* ── Add to OpenStreetMap (Overture POI) ───────────────── */}
            {selectedPoi &&
              selectedPoi.id <= 0 &&
              selectedPoi.tags['polaris:source'] === 'overture' && (
                <TouchableOpacity
                  style={styles.osmAddBtn}
                  activeOpacity={0.7}
                  onPress={() => {
                    const initialTags: Record<string, string> = {};
                    for (const [k, v] of Object.entries(selectedPoi.tags)) {
                      if (!k.startsWith('polaris:')) initialTags[k] = v;
                    }
                    router.push({
                      pathname: '/poi/osm-edit',
                      params: {
                        name: selectedPoi.name || '',
                        lat: String(selectedPoi.lat),
                        lng: String(selectedPoi.lng),
                        initialTags: JSON.stringify(initialTags),
                      },
                    });
                  }}
                >
                  <Ionicons name="add-circle-outline" size={18} color="#fff" />
                  <Text style={styles.osmAddBtnText}>Add to OpenStreetMap</Text>
                </TouchableOpacity>
              )}
          </ScrollView>
        )}
      </GlassView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  cardGlass: {
    ...StyleSheet.absoluteFill,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    borderCurve: 'continuous',
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
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  handleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    borderCurve: 'continuous',
  },
  closeCircle: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
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
    borderRadius: borderRadius.md,
    borderCurve: 'continuous',
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
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  brandLogo: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderCurve: 'continuous',
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
    borderRadius: borderRadius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
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
    borderCurve: 'continuous',
    overflow: 'hidden',
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
    borderCurve: 'continuous',
    alignItems: 'flex-start',
    overflow: 'hidden',
  },
  noteText: {
    ...typography.caption,
    flex: 1,
    lineHeight: 18,
  },
  updatePlaceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  updatePlaceBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  osmAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
    borderCurve: 'continuous',
    backgroundColor: '#7EBC6F',
  },
  osmAddBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
