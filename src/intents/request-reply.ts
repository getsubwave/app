// What Siri says back to "request a song on SUB/WAVE" (RequestSongIntent). The
// same POST /request and polling the request drawer does, cut short: Siri has
// to answer while the listener waits, where the drawer can wait a minute.
// Pure, so scripts/intent-request.test.ts can drive it.

import type { IntentReply } from '../../modules/app-intents';
import type { StationApi } from '../lib/api';
import { requestResultLabel } from '../lib/request-outcome';
import { timeLeft, TIMED_OUT, within } from './deadline';
import type { RequestResult } from '../lib/types';

// How long Siri is kept waiting for the DJ to match the request. Matching is
// a model call on the station's own LLM and can run longer; past this, Siri
// says the request is in and it carries on resolving without anyone waiting.
export const REQUEST_WAIT_MS = 10_000;
// The drawer's interval.
const POLL_INTERVAL_MS = 1500;

// The drawer's own line for a request still being matched.
export const ACCEPTED_MESSAGE = 'Got it — taking it to the booth.';

// Said when the station hasn't answered the POST by the deadline. It may well
// have taken the request, so this is no error: Siri saying "try again" would
// send it twice.
export const SLOW_MESSAGE = "Sent. The station's slow to answer, so it may take a moment.";

export interface AskForSongDeps {
  api: Pick<StationApi, 'postRequest' | 'pollRequest'>;
  sleep?: (ms: number) => Promise<void>;
  /** The timer the deadline races the station's answers against; apart from
   *  `sleep` so a test's clock moves only on the polling interval. */
  timer?: (ms: number) => Promise<void>;
  now?: () => number;
  waitMs?: number;
  /** Epoch ms by which Siri must have its answer (src/intents/deadline.ts).
   *  Every wait, the POST and each poll included, is cut to it. */
  deadline?: number;
}

export async function askForSong(text: string, deps: AskForSongDeps): Promise<IntentReply> {
  const asked = text.trim();
  if (!asked) return { ok: false, message: 'Tell me a song, an artist or a mood.' };
  const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const sleep = deps.sleep ?? realSleep;
  const timer = deps.timer ?? realSleep;
  const now = deps.now ?? Date.now;

  // A refusal is answered in the station's words: requests closed, nobody
  // tuned in, a rate limit, a full queue. A 400 carries `error`, not `message`.
  const end = deps.deadline ?? Number.POSITIVE_INFINITY;
  const untilEnd = () => timer(timeLeft(end, now()));

  let posted: (RequestResult & { error?: string }) | typeof TIMED_OUT;
  try {
    posted = Number.isFinite(end)
      ? await within(deps.api.postRequest({ text: asked }), untilEnd())
      : await deps.api.postRequest({ text: asked });
  } catch {
    return { ok: false, message: "Couldn't reach the station. Check your connection and try again." };
  }
  if (posted === TIMED_OUT) return { ok: true, message: SLOW_MESSAGE };
  if (!posted.success) {
    return {
      ok: false,
      message: posted.message || posted.error || "The station didn't take the request.",
    };
  }
  if (!posted.requestId) return { ok: true, message: ACCEPTED_MESSAGE };

  const requestId = posted.requestId;
  // A poll needs time to come back, so the last one starts an interval early.
  const pollUntil = Math.min(now() + (deps.waitMs ?? REQUEST_WAIT_MS), end - POLL_INTERVAL_MS);
  while (now() < pollUntil) {
    await sleep(POLL_INTERVAL_MS);
    let data: RequestResult | null;
    try {
      const polled = Number.isFinite(end)
        ? await within(deps.api.pollRequest(requestId), untilEnd())
        : await deps.api.pollRequest(requestId);
      if (polled === TIMED_OUT) break;
      data = polled;
    } catch {
      data = null;
    }
    if (data?.status === 'resolved') return { ok: true, message: spokenAnswer(data) };
    if (data?.status === 'failed') {
      return { ok: false, message: data.message || 'No match — try different words.' };
    }
    if (data?.status === 'unknown') break;
  }
  return { ok: true, message: ACCEPTED_MESSAGE };
}

/** The DJ's own acknowledgement when there is one; otherwise the drawer's
 *  label with the track it names. */
export function spokenAnswer(result: RequestResult): string {
  if (result.ack) return result.ack;
  const label = requestResultLabel({ ...result, pending: false });
  const title = result.track?.title;
  if (!title) return `${label}.`;
  const artist = result.track?.artist;
  return artist ? `${label}: ${title} by ${artist}.` : `${label}: ${title}.`;
}
