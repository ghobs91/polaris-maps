import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

/**
 * Settings categories — the iOS Settings pattern: a list of categories, then one
 * screen per category.
 *
 * Settings had grown into a single scrolling list with a horizontal "jump to"
 * strip bolted on top, which is a table of contents pretending to be navigation.
 * This replaces it with the structure everybody already knows: pick a category,
 * go into it.
 *
 * A category names the section ids it contains (the ids `SettingsContent` already
 * uses for its groups), so the two never drift: moving a group between categories
 * is a data change here, not a re-layout there.
 */

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface SettingsCategory {
  id: string;
  title: string;
  /** One line under the title on the category list. */
  subtitle: string;
  icon: IconName;
  /** iOS-style icon tile colour. */
  tint: string;
  /** Section ids rendered inside this category, in order. */
  sections: readonly string[];
  /** Only listed while developer mode is on. */
  developerOnly?: boolean;
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: 'general',
    title: 'General',
    subtitle: 'Appearance, units, app info',
    icon: 'settings-outline',
    tint: '#8E8E93',
    sections: ['display', 'about'],
  },
  {
    id: 'maps',
    title: 'Maps & offline',
    subtitle: 'Pack downloads, desktop relay, seeding',
    icon: 'map-outline',
    tint: '#0A84FF',
    sections: ['offline-maps'],
  },
  {
    id: 'navigation',
    title: 'Navigation',
    subtitle: 'Voice guidance, routing, auto-advance',
    icon: 'navigate-outline',
    tint: '#30D158',
    sections: ['navigation'],
  },
  {
    id: 'camera',
    title: 'Camera & imagery',
    subtitle: 'Street imagery, dash cam',
    icon: 'camera-outline',
    tint: '#FF9F0A',
    sections: ['street-imagery', 'dash-cam'],
  },
  {
    id: 'accounts',
    title: 'Accounts',
    subtitle: 'OSM, AT Protocol, identity',
    icon: 'person-circle-outline',
    tint: '#BF5AF2',
    sections: ['accounts'],
  },
  {
    id: 'privacy',
    title: 'Privacy & permissions',
    subtitle: 'What this device contributes',
    icon: 'lock-closed-outline',
    tint: '#FF453A',
    sections: ['privacy'],
  },
  {
    id: 'developer',
    title: 'Developer',
    subtitle: 'Pack origins, diagnostics, dev mode',
    icon: 'construct-outline',
    tint: '#64D2FF',
    sections: ['developer'],
    developerOnly: true,
  },
];

/** Categories visible for the current dev-mode setting. */
export function visibleCategories(devMode: boolean): readonly SettingsCategory[] {
  return SETTINGS_CATEGORIES.filter((category) => !category.developerOnly || devMode);
}

export function findCategory(id: string | undefined): SettingsCategory | null {
  if (!id) return null;
  return SETTINGS_CATEGORIES.find((category) => category.id === id) ?? null;
}
