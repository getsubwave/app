import type { StationAuthResult } from './station-password';

export interface GateAudioState {
  /** A lock is on. */
  required: boolean;
  takesAudio: boolean;
  phase: 'open' | 'checking' | 'prompt' | 'ok';
  tunedIn: boolean;
}

/** Whether the gate holds a listener to tune back in, given whether it did
 *  before this state. */
export function gateHolds(held: boolean, { required, takesAudio, phase, tunedIn }: GateAudioState): boolean {
  if (phase !== 'prompt' && !(required && phase === 'checking')) return false;
  if (!required || !tunedIn) return held;
  return phase === 'prompt' || takesAudio;
}

/** Whether this answer to a typed password tunes the held listener back in. */
export function resumeOnAnswer(held: boolean, result: StationAuthResult): boolean {
  return held && result === 'ok';
}
