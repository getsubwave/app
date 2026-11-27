// What Siri says for "what's playing on SUB/WAVE" and "like this song on
// SUB/WAVE". Pure, so scripts/intent-on-air.test.ts can drive it; the fetching
// and the choice of track are in src/intents/on-air.ts.

import type { IntentReply } from '../../modules/app-intents';
import type { LikeResult } from '../lib/types';
import { timeLeft, TIMED_OUT, within } from './deadline';

/** Enough of a now-playing track or a history entry to name it and like it. */
export interface OnAirTrack {
  title?: string;
  artist?: string;
  subsonic_id?: string;
}

/** One read of the station for the listener: whether it answered, whether
 *  the stream is up, and the track they are hearing. */
export interface OnAirSnapshot {
  reachable: boolean;
  /** False only when the station said its stream is down. */
  online: boolean;
  track: OnAirTrack | null;
}

export function unreachableReply(station: string): IntentReply {
  return { ok: false, message: `Couldn't reach ${station}. Check your connection and try again.` };
}

/** Ends a sentence once: POST /like's messages carry no full stop. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function named(track: OnAirTrack): string {
  return track.artist ? `${track.title} by ${track.artist}` : `${track.title}`;
}

export function whatsPlayingReply(station: string, snap: OnAirSnapshot): IntentReply {
  if (!snap.reachable) return unreachableReply(station);
  if (!snap.online) return { ok: true, message: `${station} is off air right now.` };
  if (!snap.track?.title) return { ok: true, message: `Nothing's playing on ${station} right now.` };
  return { ok: true, message: `On ${station}: ${named(snap.track)}.` };
}

// Mirrors POST /like's own refusal, for the case that never reaches it: a
// jingle or a spoken segment carries no song id.
const NOTHING_TO_LIKE = 'Nothing likeable on air right now';

/** Whether there is a song to send to POST /like, and if not, what to say. */
export function likeTarget(station: string, snap: OnAirSnapshot): { songId: string } | IntentReply {
  if (!snap.reachable) return unreachableReply(station);
  if (!snap.online || !snap.track?.subsonic_id) return { ok: false, message: sentence(NOTHING_TO_LIKE) };
  return { songId: snap.track.subsonic_id };
}

/** POST /like's answer in words. A refusal (likes off, the song just ended,
 *  too many likes) is the station's own message. */
export function likeReply(station: string, track: OnAirTrack, result: LikeResult | null): IntentReply {
  if (!result) return unreachableReply(station);
  if (result.error) return { ok: false, message: sentence(result.error) };
  if (result.alreadyLiked) return { ok: true, message: `You've already liked ${named(track)}.` };
  if (!result.ok) return { ok: false, message: `${station} didn't take the like.` };
  return { ok: true, message: `Liked ${named(track)}.` };
}

/** Said when the station hasn't told us what's on by the deadline: nothing
 *  was liked, so asking again is the whole remedy. */
export function slowReply(station: string): IntentReply {
  return { ok: false, message: `${station} is slow to answer. Try again in a moment.` };
}

/** Said when POST /like is still out at the deadline. A failure, not "liked":
 *  a repeat like is harmless (the station answers alreadyLiked and counts it
 *  once), so the listener asking again costs nothing, while saying "liked"
 *  for a like that never landed would lose it for good. The song request
 *  answers the other way because a repeat request queues the song twice. */
export function likeUnconfirmedReply(station: string): IntentReply {
  return {
    ok: false,
    message: `${station} didn't confirm the like in time. Ask again: it won't count twice.`,
  };
}

/** A read of the station on behalf of an intent, cut to its deadline. */
export interface OnAirDeps {
  station: string;
  /** The track the listener is hearing, read until `signal` aborts. */
  snapshot(signal: AbortSignal): Promise<OnAirSnapshot>;
  /** Epoch ms by which Siri must have its answer (deadline.ts). */
  deadline: number;
  now?: () => number;
  /** The timer the deadline races the station's answers against. */
  timer?: (ms: number) => Promise<void>;
}

export interface LikeHeardDeps extends OnAirDeps {
  /** POST /like, sent until `signal` aborts. */
  like(songId: string, signal: AbortSignal): Promise<LikeResult | null>;
  /** The in-app heart and the Live Activity follow a like that landed. */
  announce(like: { songId: string; count?: number }): void;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `call`'s answer, or TIMED_OUT once the deadline passes first, its request
 *  aborted then (readJson honours the signal), so nothing keeps fetching for
 *  an answer no one will hear. */
function inTime<T>(
  deps: OnAirDeps,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T | typeof TIMED_OUT> {
  const now = deps.now ?? Date.now;
  const timer = deps.timer ?? wait;
  const abort = new AbortController();
  return within(call(abort.signal), timer(timeLeft(deps.deadline, now()))).then((result) => {
    if (result === TIMED_OUT) abort.abort();
    return result;
  });
}

/** "What's playing": the heard track, its reads cut to the deadline. */
export async function whatsPlayingHeard(deps: OnAirDeps): Promise<IntentReply> {
  const snap = await inTime(deps, deps.snapshot);
  return snap === TIMED_OUT ? slowReply(deps.station) : whatsPlayingReply(deps.station, snap);
}

/** "Like this song": the heard track, liked, both steps cut to the deadline. */
export async function likeHeard(deps: LikeHeardDeps): Promise<IntentReply> {
  const snap = await inTime(deps, deps.snapshot);
  if (snap === TIMED_OUT) return slowReply(deps.station);
  const target = likeTarget(deps.station, snap);
  if (!('songId' in target)) return target;

  // Cancelled at the deadline. The station may still have counted it before
  // the cancel reached it; the listener's repeat then hears alreadyLiked.
  const result = await inTime(deps, (signal) => deps.like(target.songId, signal));
  if (result === TIMED_OUT) return likeUnconfirmedReply(deps.station);
  if (result && !result.error && (result.ok || result.alreadyLiked)) {
    deps.announce({ songId: target.songId, count: result.count });
  }
  return likeReply(deps.station, snap.track ?? {}, result);
}
