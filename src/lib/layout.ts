import type { ModalProps, ViewStyle } from 'react-native';

export const WIDE_MIN_WIDTH = 700;

export const PLAYER_MAX_WIDTH = 680;
export const SHEET_MAX_WIDTH = 560;
export const FORM_MAX_WIDTH = 520;
export const CARD_MAX_WIDTH = 480;

export function isWide(width: number): boolean {
  return width >= WIDE_MIN_WIDTH;
}

export function column(maxWidth: number): ViewStyle {
  return { width: '100%', maxWidth, alignSelf: 'center' };
}

// A Modal defaults to portrait only, and iPad runs in every orientation.
export const ALL_ORIENTATIONS: NonNullable<ModalProps['supportedOrientations']> = [
  'portrait',
  'portrait-upside-down',
  'landscape',
  'landscape-left',
  'landscape-right',
];
