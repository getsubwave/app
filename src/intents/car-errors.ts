// What Android Auto shows when a pick fails: the session's error state, in
// place of Now Playing, until the next pick or until audio plays
// (modules/android-auto's showError, the RNTP patch's MediaBrowserBridge).
//
// A driver may be sent to the phone only "when it's safe to do so" (Google's
// car app quality guideline VI-1), so every fix that needs the phone says so.

import type { TuneReply } from './tune-flow';

/** Matched by STRING with SubwaveAndroidAutoModule.kt's errorCode (npm test
 *  checks), which turns each into a PlaybackStateCompat error code. */
export const CAR_ERROR_KINDS = ['not-saved', 'no-station', 'locked', 'unreachable'] as const;
export type CarErrorKind = (typeof CAR_ERROR_KINDS)[number];

export interface CarError {
  kind: CarErrorKind;
  message: string;
}

const SAFE = "When it's safe,";

/** The car's error for a refused or failed pick. `locked` is whether the
 *  station needs a password the app doesn't have, asked only after a stream
 *  failed to start. */
export function carErrorFor(reply: TuneReply, locked: boolean): CarError {
  const station = reply.station ?? 'the station';
  switch (reply.reason) {
    case 'not-saved':
      return {
        kind: 'not-saved',
        message: `That station isn't saved. ${SAFE} add it in SUB/WAVE on your phone.`,
      };
    case 'no-station':
      return {
        kind: 'no-station',
        message: `No station yet. ${SAFE} add one in SUB/WAVE on your phone.`,
      };
    default:
      if (locked) {
        return {
          kind: 'locked',
          message: `${capitalise(station)} needs its password. ${SAFE} unlock it in SUB/WAVE on your phone.`,
        };
      }
      return {
        kind: 'unreachable',
        message: `Couldn't reach ${station}. Try again in a moment.`,
      };
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
