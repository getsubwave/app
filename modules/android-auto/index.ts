// The JS half of Android Auto: the station list the car shows. The car's side
// is android/…/SubwaveBrowseService.kt. A no-op outside Android.

import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { MirroredStation } from '@/lib/station-store';

interface NativeAndroidAuto {
  setStations(json: string): void;
  // Absent from binaries before car error states.
  showError?(kind: string, message: string): void;
  clearError?(): void;
  setupFailed?(): void;
}

// Binaries older than Android Auto support lack this module, and an OTA
// update must not crash them.
const native: NativeAndroidAuto | null = (() => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeModule('SubwaveAndroidAuto') as unknown as NativeAndroidAuto;
  } catch {
    return null;
  }
})();

/** The saved stations and the active one, for a car that may connect while JS
 *  is not running. Names and credential-free bases only, as for Siri. */
export function setStations(active: string | null, stations: MirroredStation[]): void {
  try {
    native?.setStations(JSON.stringify({ active, stations }));
  } catch {
    /* a binary older than Android Auto support */
  }
}

/** Why a car pick failed, in place of Now Playing (src/intents/car-errors.ts),
 *  until the next pick or until audio plays. */
export function showCarError(kind: string, message: string): void {
  try {
    native?.showError?.(kind, message);
  } catch {
    /* no session to show it on */
  }
}

export function clearCarError(): void {
  try {
    native?.clearError?.();
  } catch {
    /* no session */
  }
}

/** setupPlayer failed for a car that is waiting on the player's session: the
 *  car shows an error instead of waiting. */
export function carSetupFailed(): void {
  try {
    native?.setupFailed?.();
  } catch {
    /* a binary older than car error states */
  }
}
