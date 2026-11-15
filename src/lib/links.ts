// None of them is a
// payment page: the Ko-fi link lives on the site, never in the binary, because
// an in-app donation call-to-action fails App Store 3.1.1 and Play's Payments
// policy outside the US.

import { Linking } from 'react-native';

export const PROJECT_LINKS = {
  setup: 'https://www.getsubwave.com/setup',
  about: 'https://www.getsubwave.com/landing',
  source: 'https://github.com/perminder-klair/subwave',
  community: 'https://discord.gg/vjVbVKnMBa',
} as const;

export function openExternal(url: string): void {
  Linking.openURL(url).catch(() => {});
}
