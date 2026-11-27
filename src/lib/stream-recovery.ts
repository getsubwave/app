// A reload is not free: the new connection gets Icecast's burst-on-connect
// again, ~22s of audio the listener may already have heard, and a reload that
// overlaps another counts as a second listener at the station. A native state
// event cannot decide a reload alone: Buffering is an instant, not a verdict,
// and the last state JS hears can be stale (SwiftAudioEx's `.ready` is a
// check-then-set that can land after `.playing`).
//
// An iOS cut can report Buffering before its end, and an Android error can land
// after ExoPlayer's own retries, past the line.
//
// Icecast-KH holds a listener's socket open about 15s after its source stops,
// then closes it, and the mount refuses a reload while the source is down.

export const WATCHDOG_MS = 6000;

export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 60_000;
export const STAYED_UP_MS = 4000;
export const PLAYED_MAX_MS = 16_000;

// Buffering-churn guard (#1252). On a throttled network the native player
// retries the same URL internally every ~9s forever — Buffering→Playing flaps
// too short for the watchdog and with no PlaybackError, each abandoned
// connection lingering at Icecast as a phantom listener.
export const CHURN_WINDOW_MS = 60_000;
export const CHURN_LIMIT = 4;

export const WATCHDOG_MIN_PACE = 0.5;
export const CHURN_MIN_PACE = 0.8;

export interface ProgressSample {
  /** Wall clock, ms. */
  at: number;
  /** Native media clock, seconds. */
  position: number;
}

/** Media seconds per wall second between two samples; null when unmeasurable. */
export function pace(from: ProgressSample | null, to: ProgressSample | null): number | null {
  if (!from || !to) return null;
  const wallS = (to.at - from.at) / 1000;
  return wallS > 0 ? (to.position - from.position) / wallS : null;
}

/** Did the media clock move forward between the samples, at no less than
 *  `minPace`? An unknown sample says no, which falls back to reloading. */
export function keptPace(
  from: ProgressSample | null,
  to: ProgressSample | null,
  minPace: number,
): boolean {
  if (!from || !to) return false;
  const advancedS = to.position - from.position;
  return advancedS > 0 && advancedS >= (minPace * (to.at - from.at)) / 1000;
}

export function retryDelay(retries: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** retries, RECONNECT_MAX_MS);
}

/** How long a stall or a new load waits for its clock check: WATCHDOG_MS, or
 *  the backoff once failed reloads have pushed it past that. */
export function watchdogDelay(retries: number): number {
  return Math.max(WATCHDOG_MS, retryDelay(retries));
}

export interface Backoff {
  /** Automatic reloads that failed in a row. An item that played clears it. */
  retries: number;
  /** What that cleared, kept until the item is judged. */
  heldRetries: number;
  /** When this item first played; null until it does. */
  playingSince: number | null;
  /** When it stopped, if it hasn't played since. */
  stoppedAt: number | null;
}

export const NO_BACKOFF: Backoff = { retries: 0, heldRetries: 0, playingSince: null, stoppedAt: null };

/** The item is playing, and has been since `at`. Only the first sign starts its
 *  clock, or a slow link's Playing after each stall would look like a new item. */
export function itemPlaying(backoff: Backoff, at: number): Backoff {
  if (backoff.playingSince !== null) return { ...backoff, stoppedAt: null };
  return { retries: 0, heldRetries: backoff.retries, playingSince: at, stoppedAt: null };
}

/** A stall or a failure. The first stop since the item last played is the one
 *  judged, so an error that follows a stall can't move it past the line. */
export function itemStopped(backoff: Backoff, at: number): Backoff {
  if (backoff.playingSince === null || backoff.stoppedAt !== null) return backoff;
  return { ...backoff, stoppedAt: at };
}

function failures({ retries, heldRetries, playingSince, stoppedAt }: Backoff, now: number): number {
  if (playingSince === null) return retries;
  return (stoppedAt ?? now) - playingSince < STAYED_UP_MS ? heldRetries : 0;
}

/** How long an error waits before its reload. */
export function failureDelay(backoff: Backoff, now: number): number {
  const delay = retryDelay(failures(backoff, now));
  return backoff.playingSince === null ? delay : Math.min(delay, PLAYED_MAX_MS);
}

/** An automatic reload replaces the item: one failure more than it leaves.
 *  `failed` is an item that reported its own failure. One that played and only
 *  stalled leaves nothing, so the new load is the first failure. */
export function itemReplaced(backoff: Backoff, now: number, failed: boolean): Backoff {
  const stalled = backoff.playingSince !== null && !failed;
  return { ...NO_BACKOFF, retries: (stalled ? 0 : failures(backoff, now)) + 1 };
}

function describe(from: ProgressSample | null, to: ProgressSample | null): string {
  if (!from || !to) return 'media clock unknown';
  const p = pace(from, to);
  return `pos ${from.position.toFixed(1)}→${to.position.toFixed(1)}s over ${(
    (to.at - from.at) / 1000
  ).toFixed(1)}s, pace ${p === null ? '—' : p.toFixed(2)}`;
}

export type ReloadReason = 'tune' | 'remote' | 'format' | 'watchdog' | 'error' | 'link' | 'churn';
type CheckReason = 'watchdog' | 'error' | 'link';

export interface StreamRecoveryDeps {
  /** The native media clock in seconds (TrackPlayer.getProgress().position).
   *  A rejection or a non-finite value reads as unknown. */
  position(): Promise<number>;
  /** Load the stream afresh. A throw schedules a backoff retry, since it may
   *  not surface as a PlaybackError event. */
  reload(reason: ReloadReason): Promise<void>;
  /** The clock kept pace while the native state said otherwise: show playing. */
  onAdvancing(): void;
  log(msg: string): void;
  now?: () => number;
}

interface PendingCheck {
  token: number;
  reason: CheckReason;
  due: number;
  timer: ReturnType<typeof setTimeout>;
}

interface Flap {
  at: number;
  position: number | null;
}

export class StreamRecovery {
  private readonly deps: StreamRecoveryDeps;
  private readonly now: () => number;
  private active = false;
  private session = 0;
  private attempt = 0;
  private episode = 0;
  private token = 0;
  private check: PendingCheck | null = null;
  private baseline: ProgressSample | null = null;
  private flaps: Flap[] = [];
  private backoff = NO_BACKOFF;
  private erroredEpisode = -1;
  private reloading = false;
  private interrupted = false;
  private queued: ReloadReason | null = null;
  private lastState: string | null = null;

  constructor(deps: StreamRecoveryDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** A fresh tune-in: a new session that loads the stream. `remote` is a Play
   *  from the lock screen, a headset, CarPlay or Bluetooth, which loads the
   *  same way: the listener asking for audio, so it reloads even over a
   *  stream that plays, and the backoff starts over. */
  tuneIn(reason: 'tune' | 'remote' = 'tune'): void {
    this.begin();
    void this.reload(reason, null, true);
  }

  /** Playback the player didn't start, loaded while it wasn't mounted: by
   *  service.ts (Android's headless service) or by an App Intent
   *  (src/intents/tune.ts, a cold Siri launch). Watch it, no reload. */
  adopt(): void {
    this.begin();
  }

  /** A tune-out of any kind. Everything pending goes inert. */
  tuneOut(): void {
    this.session += 1;
    this.active = false;
    this.reset();
  }

  /** Every native PlaybackState, tuned in or not, so the churn guard knows
   *  which state a stall came out of. */
  onState(state: string): void {
    const prev = this.lastState;
    this.lastState = state;
    if (!this.active) return;
    switch (state) {
      case 'playing':
        this.endEpisode();
        this.backoff = itemPlaying(this.backoff, this.now());
        this.interrupted = false;
        return;
      case 'buffering':
      case 'loading':
        if (state === 'loading' && !this.reloading) this.interrupted = false;
        // Loading always means a new item (a tune-in or reload, both platforms),
        // never a mid-stream stall.
        if (prev === 'playing' && state === 'buffering') this.recordFlap();
        this.noteStop();
        this.arm('watchdog', watchdogDelay(this.backoff.retries));
        return;
      case 'error':
      case 'ended':
      case 'stopped':
        this.onError();
        return;
    }
  }

  /** A PlaybackError event, or a failed state. One reported mid-reload belongs
   *  to the item being replaced; the new load arms a check of its own. */
  onError(): void {
    if (this.active && !this.reloading) this.armRetry();
  }

  /** RNTP's RemoteDuck: on iOS, an audio-session interruption (a call, Siri,
   *  an alarm). RNTP pauses nothing for it, so AVPlayer stops with no state
   *  event and the clock stands still for as long as it lasts. A check would
   *  reload, and a new item can't play during it either, so it would be
   *  reloaded every WATCHDOG_MS until the call ended: nothing is armed until
   *  it ends. `paused: false` is the end with playback resumed by RNTP
   *  (autoHandleInterruptions), and a stall that outlived it sends no new
   *  state, so the clock is checked again. `permanent` is an end iOS wants
   *  left paused. Android doesn't emit it here: ExoPlayer takes audio focus. */
  onDuck(paused: boolean, permanent = false): void {
    const was = this.interrupted;
    this.interrupted = paused && !permanent;
    if (this.interrupted) {
      this.deps.log('interrupted: no checks or reloads until it ends');
      this.endEpisode();
      this.flaps = [];
      this.backoff = { ...this.backoff, stoppedAt: null };
    } else if (was) {
      this.deps.log(`interruption over${paused ? ', left paused' : ', resumed: checking the clock'}`);
      if (!paused) this.arm('watchdog', watchdogDelay(this.backoff.retries));
    }
  }

  /** The device regained a network link while the UI isn't showing playback:
   *  check now rather than wait out the pending check, or with none pending,
   *  reload now. */
  linkRegained(): void {
    this.backoff = NO_BACKOFF;
    if (!this.active) return;
    const check = this.check;
    if (!check) {
      void this.reload('link', null);
      return;
    }
    clearTimeout(check.timer);
    check.reason = 'link';
    void this.fire(check.token);
  }

  /** The listener picked another mount: reload onto it, after any reload in flight. */
  retune(): void {
    void this.reload('format', null, true);
  }

  private begin(): void {
    this.session += 1;
    this.active = true;
    // iOS doesn't promise an interruption's end, and a missed one mustn't
    // leave the watchdog off for good.
    this.interrupted = false;
    this.reset();
  }

  private reset(): void {
    this.endEpisode();
    this.flaps = [];
    this.backoff = NO_BACKOFF;
    this.queued = null;
  }

  private endEpisode(): void {
    if (this.check) clearTimeout(this.check.timer);
    this.check = null;
    this.baseline = null;
    this.episode += 1;
  }

  private async sample(): Promise<ProgressSample | null> {
    try {
      const position = await this.deps.position();
      return Number.isFinite(position) ? { at: this.now(), position } : null;
    } catch {
      return null;
    }
  }

  // Once per episode, which keeps the deadline bounded, so PlaybackError and
  // State.Error, which arrive as a pair, set it once.
  private armRetry(): void {
    this.noteStop();
    const replace = this.erroredEpisode !== this.episode;
    if (this.arm('error', failureDelay(this.backoff, this.now()), undefined, replace)) {
      this.erroredEpisode = this.episode;
    }
  }

  private noteStop(): void {
    if (!this.interrupted) this.backoff = itemStopped(this.backoff, this.now());
  }

  private arm(reason: CheckReason, delay: number, baseline?: ProgressSample, replace = false): boolean {
    if (!this.active || this.interrupted) return false;
    const due = this.now() + delay;
    if (this.check && this.check.due <= due && !replace) return false;
    if (this.check) {
      clearTimeout(this.check.timer);
    } else {
      this.episode += 1;
      this.baseline = baseline ?? null;
      if (!baseline) {
        const episode = this.episode;
        void this.sample().then((s) => {
          if (episode === this.episode) this.baseline = s;
        });
      }
    }
    const token = ++this.token;
    this.check = {
      token,
      reason,
      due,
      timer: setTimeout(() => { void this.fire(token); }, delay),
    };
    return true;
  }

  private async fire(token: number): Promise<void> {
    if (this.check?.token !== token) return;
    const from = this.baseline;
    const to = await this.sample();
    const check = this.check;
    if (!check || check.token !== token) return;
    this.check = null;
    const state = this.lastState ?? 'none';
    if (from && to && keptPace(from, to, WATCHDOG_MIN_PACE)) {
      this.deps.log(`hold [${check.reason}] state=${state}: ${describe(from, to)} — playing, not reloading`);
      this.backoff = itemPlaying(this.backoff, from.at);
      this.deps.onAdvancing();
      if (state === 'buffering' || state === 'loading') this.arm('watchdog', WATCHDOG_MS, to);
      return;
    }
    void this.reload(check.reason, describe(from, to));
  }

  private recordFlap(): void {
    const at = this.now();
    const flap: Flap = { at, position: null };
    this.flaps = this.flaps.filter((f) => at - f.at < CHURN_WINDOW_MS);
    this.flaps.push(flap);
    const first = this.flaps[0];
    const tripped = this.flaps.length >= CHURN_LIMIT;
    const { session, attempt } = this;
    void this.sample().then((s) => {
      if (s) flap.position = s.position;
      if (!tripped || session !== this.session || attempt !== this.attempt || !this.active) return;
      const from = first.position === null ? null : { at: first.at, position: first.position };
      const to = flap.position === null ? null : { at, position: flap.position };
      const detail = `${this.flaps.length} stalls inside ${CHURN_WINDOW_MS / 1000}s, ${describe(from, to)}`;
      if (keptPace(from, to, CHURN_MIN_PACE)) {
        this.deps.log(`hold [churn] ${detail} — kept pace, not reloading`);
        return;
      }
      void this.reload('churn', detail);
    });
  }

  private async reload(reason: ReloadReason, detail: string | null, explicit = false): Promise<void> {
    if (!this.active) return;
    if (this.interrupted && !explicit) {
      this.deps.log(`reload [${reason}] skipped: audio interrupted`);
      return;
    }
    if (this.reloading) {
      if (explicit) this.queued = reason;
      this.deps.log(`reload [${reason}] skipped: one in flight${explicit ? ', queued after it' : ''}`);
      return;
    }
    this.reloading = true;
    this.endEpisode();
    this.flaps = [];
    this.backoff = explicit ? NO_BACKOFF : itemReplaced(this.backoff, this.now(), reason === 'error');
    const session = this.session;
    this.attempt += 1;
    this.deps.log(
      `reload [${reason}] #${this.attempt} state=${this.lastState ?? 'none'}${detail ? `: ${detail}` : ''}${
        explicit ? '' : ` (failure ${this.backoff.retries})`
      }`,
    );
    try {
      await this.deps.reload(reason);
      // Check the new item even if it reports nothing: on iOS a reload made
      // while the old item was Loading emits no new Loading (#2143).
      if (session === this.session) this.arm('watchdog', watchdogDelay(this.backoff.retries));
    } catch {
      if (session === this.session) this.armRetry();
    } finally {
      this.reloading = false;
      const next = this.queued;
      this.queued = null;
      if (next) void this.reload(next, null, true);
    }
  }
}
