// Plays through a woken station's stale idle silence fast (#9), the app's port
// of web/lib/idleSkipPlayback.ts. The policy is idle-skip.ts; this is the
// mechanism. It raises the native player's rate and never seeks, so the media
// clock the stream-recovery checks read stays continuous. The lag shed is
// measured on that clock (media time gained minus wall time spent), so a
// player that ignores the rate sheds nothing, is put back to 1x after STALL_MS
// and reports no trim. The last SLOW_SHED_SECONDS go at SLOW_RATE, so a late
// check overshoots by at most about twice its lateness, inside the 1s music
// margin. A stall, a pause or the app leaving the foreground ends the skip:
// JS timers can stop in the background while the native rate would not.
//
// RNTP keeps its rate across loads on both platforms (SwiftAudioEx re-applies
// it to each item, ExoPlayer keeps its playback parameters), so loadAndPlay
// puts it back to 1x before every load as well.

import { idleSkipSeconds, type IdleSkipInput } from './idle-skip';
import type { IdleWindow } from './types';

export const SKIP_RATE = 8;
export const SLOW_SHED_SECONDS = 1.5;
export const SLOW_RATE = 2;
export const CHECK_MS = 50;
export const STALL_MS = 1500;
export const MIN_TRIM_MS = 100;
export const READ_TIMEOUT_MS = 8000;

export interface IdleSkipDeps {
  /** The station's advertised stream.bufferSeconds. */
  bufferSeconds: number;
  /** A fresh GET /state; only `streamIdleWindow` is read. */
  readState(signal: AbortSignal): Promise<{ streamIdleWindow?: IdleWindow | null } | null | undefined>;
  /** The native media clock in seconds. */
  position(): Promise<number>;
  setRate(rate: number): Promise<void>;
  /** Called once, if any lag was shed, with how much in ms. */
  onTrim(ms: number): void;
  log(msg: string): void;
  now?: () => number;
}

const STOPS = new Set(['buffering', 'loading', 'paused', 'stopped', 'ended', 'error']);

/** One run per connection. Create it right before the load, call `loaded()`
 *  once the load has resolved, and feed it every native PlaybackState. */
export class IdleSkip {
  private readonly deps: IdleSkipDeps;
  private readonly now: () => number;
  private readonly requestedAt: number;
  private readonly abort = new AbortController();
  private ended = false;
  private live = false;
  private playing = false;
  private fast = false;
  private waiters: (() => void)[] = [];
  private cleanups: (() => void)[] = [];
  private stopFastForward: (() => void) | null = null;

  constructor(deps: IdleSkipDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.requestedAt = this.now();
    void this.run().catch(() => {}).finally(() => this.cancel());
  }

  /** The load resolved: states from here on belong to this connection. */
  loaded(): void {
    this.live = true;
  }

  onState(state: string): void {
    if (!this.live || this.ended) return;
    if (state === 'playing') {
      this.playing = true;
      for (const w of this.waiters.splice(0)) w();
    } else if (STOPS.has(state)) {
      this.playing = false;
      this.stopFastForward?.();
    }
  }

  /** The app left the foreground: a fast-forward stops with what it shed, and
   *  one not yet started never starts. */
  background(): void {
    if (this.stopFastForward) this.stopFastForward();
    else this.cancel();
  }

  /** Restores 1x and reports nothing. */
  cancel(): void {
    if (this.ended) return;
    this.ended = true;
    this.abort.abort();
    for (const fn of this.cleanups.splice(0)) fn();
    for (const w of this.waiters.splice(0)) w();
    if (this.fast) void this.deps.setRate(1).catch(() => {});
    this.fast = false;
  }

  private untilPlaying(): Promise<void> {
    if (this.playing || this.ended) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private async measure(pos0: number, t0: number): Promise<number | null> {
    try {
      const p = await this.deps.position();
      return Number.isFinite(p) ? p - pos0 - (this.now() - t0) / 1000 : null;
    } catch {
      return null;
    }
  }

  private async run(): Promise<void> {
    await this.untilPlaying();
    if (this.ended) return;
    const firstAudioAt = this.now();
    const readSentAt = this.now();
    const signal = this.abort.signal;
    const timer = setTimeout(() => this.abort.abort(), READ_TIMEOUT_MS);
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    aborted.catch(() => {});
    let window: IdleWindow | null | undefined;
    try {
      window = (await Promise.race([this.deps.readState(signal), aborted]))?.streamIdleWindow;
    } catch {
      return;
    } finally {
      clearTimeout(timer);
    }
    if (this.ended) return;
    const at: Omit<IdleSkipInput, 'now'> = {
      bufferSeconds: this.deps.bufferSeconds,
      window,
      requestedAt: this.requestedAt,
      firstAudioAt,
      readSentAt,
      readReceivedAt: this.now(),
    };
    const target = () => idleSkipSeconds({ ...at, now: this.now() });
    const first = target();
    if (first <= 0) return;
    this.deps.log(`idle skip: woken station, shedding up to ${first.toFixed(1)}s of silence`);
    await this.untilPlaying();
    if (this.ended || target() <= 0) return;
    await this.fastForward(target);
  }

  private async fastForward(target: () => number): Promise<void> {
    let pos0: number;
    try {
      pos0 = await this.deps.position();
    } catch {
      return;
    }
    if (this.ended || !Number.isFinite(pos0)) return;
    const t0 = this.now();
    await new Promise<void>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let best = 0;
      let bestAt = t0;
      let rate = 1;

      const finish = async () => {
        if (done) return;
        done = true;
        this.stopFastForward = null;
        if (timer !== null) clearTimeout(timer);
        if (this.ended) return resolve();
        this.fast = false;
        await this.deps.setRate(1).catch(() => {});
        const shed = await this.measure(pos0, t0);
        if (this.ended) return resolve();
        const ms = Math.round(Math.max(0, shed ?? 0) * 1000);
        this.cancel();
        this.deps.log(`idle skip: back to 1x, shed ${(ms / 1000).toFixed(1)}s`);
        if (ms >= MIN_TRIM_MS) this.deps.onTrim(ms);
        resolve();
      };

      const check = async () => {
        if (done) return;
        if (this.ended) return void finish();
        const shed = await this.measure(pos0, t0);
        if (done) return;
        if (shed === null) return void finish();
        const left = target() - shed;
        if (left <= 0) return void finish();
        if (shed > best + 0.05) {
          best = shed;
          bestAt = this.now();
        } else if (this.now() - bestAt > STALL_MS) {
          return void finish();
        }
        const fastLeft = left - SLOW_SHED_SECONDS;
        const next = fastLeft > 0 ? SKIP_RATE : SLOW_RATE;
        if (next !== rate) {
          rate = next;
          this.fast = true;
          try {
            await this.deps.setRate(next);
          } catch {
            return void finish();
          }
          if (done) return;
        }
        const due = fastLeft > 0 ? fastLeft / SKIP_RATE : left / SLOW_RATE;
        timer = setTimeout(() => void check(), Math.min(CHECK_MS, due * 1000));
      };

      this.stopFastForward = () => void finish();
      this.cleanups.push(() => {
        done = true;
        this.stopFastForward = null;
        if (timer !== null) clearTimeout(timer);
        resolve();
      });
      void check();
    });
  }
}
