// The mechanism behind the skip over a woken station's stale idle silence (#9,
// the app's port of web #2125). It reads /state only after this connection's
// first Playing, leaves a live station's playback alone, sheds lag by the
// native rate and reports what the media clock measured. A player that ignores
// the rate gets today's behaviour, a stall or the app leaving the foreground
// ends the skip, and every ending puts the rate back to 1x. A fake player runs
// on the real clock, so each test takes a second or two at a small buffer.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SKIP_CUSHION_SECONDS } from '../src/lib/idle-skip.ts';
import { IdleSkip, SKIP_RATE, SLOW_RATE } from '../src/lib/idle-skip-playback.ts';
import type { IdleWindow } from '../src/lib/types.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const IDLE: IdleWindow = { startedMsAgo: 10 * 60_000, endedMsAgo: null };

class FakePlayer {
  honoursRate = true;
  playing = false;
  rates: number[] = [];
  private base = 0;
  private since = performance.now();
  private rate = 1;
  private clock() {
    if (!this.playing) return this.base;
    return this.base + ((performance.now() - this.since) / 1000) * (this.honoursRate ? this.rate : 1);
  }
  async position() {
    return this.clock();
  }
  async setRate(r: number) {
    this.base = this.clock();
    this.since = performance.now();
    this.rate = r;
    this.rates.push(r);
  }
  start() {
    this.base = this.clock();
    this.since = performance.now();
    this.playing = true;
  }
  stall() {
    this.base = this.clock();
    this.playing = false;
  }
}

function run(opts: { buffer?: number; window?: IdleWindow | null; read?: () => Promise<unknown> } = {}) {
  const player = new FakePlayer();
  const reads: number[] = [];
  const trims: number[] = [];
  const skip = new IdleSkip({
    bufferSeconds: opts.buffer ?? SKIP_CUSHION_SECONDS + 2.5,
    readState: async () => {
      reads.push(performance.now());
      if (opts.read) return opts.read() as never;
      return { streamIdleWindow: opts.window === undefined ? IDLE : opts.window };
    },
    position: () => player.position(),
    setRate: (r) => player.setRate(r),
    onTrim: (ms) => trims.push(ms),
    log: () => {},
    now: () => performance.now(),
  });
  const play = () => {
    player.start();
    skip.onState('playing');
  };
  return { player, reads, trims, skip, play };
}

test('a live station is read after the first Playing and its playback left alone', async () => {
  for (const window of [null, { startedMsAgo: 900_000, endedMsAgo: 300_000 }]) {
    const r = run({ window });
    r.skip.loaded();
    await sleep(20);
    assert.equal(r.reads.length, 0, 'nothing is read before the first audio');
    r.play();
    await sleep(200);
    assert.equal(r.reads.length, 1);
    assert.deepEqual(r.player.rates, [], 'the rate is never touched');
    assert.deepEqual(r.trims, []);
    r.skip.cancel();
    assert.deepEqual(r.player.rates, []);
  }
});

test('states before the load resolved belong to the old item and are ignored', async () => {
  const r = run();
  r.skip.onState('playing');
  await sleep(50);
  assert.equal(r.reads.length, 0);
  r.skip.loaded();
  r.play();
  await sleep(50);
  assert.equal(r.reads.length, 1);
  r.skip.cancel();
});

test('an idle tune-in sheds down to the cushion and reports what it measured', async () => {
  const r = run();
  r.skip.loaded();
  r.play();
  // 2.5s to shed: 1s at 8x, then the last 1.5s at 2x.
  await sleep(2_200);
  assert.deepEqual(r.player.rates, [SKIP_RATE, SLOW_RATE, 1]);
  assert.equal(r.trims.length, 1);
  const trim = r.trims[0] ?? 0;
  assert.ok(trim >= 2_500 && trim < 2_800, String(trim));
});

test('a player that ignores the rate is put back to 1x and reports nothing', async () => {
  const r = run();
  r.player.honoursRate = false;
  r.skip.loaded();
  r.play();
  await sleep(1_900);
  assert.deepEqual(r.player.rates, [SKIP_RATE, 1]);
  assert.deepEqual(r.trims, []);
});

test('a stall ends the skip with what was shed', async () => {
  const r = run({ buffer: 22 });
  r.skip.loaded();
  r.play();
  await sleep(400);
  r.player.stall();
  r.skip.onState('buffering');
  await sleep(50);
  assert.deepEqual(r.player.rates, [SKIP_RATE, 1]);
  assert.equal(r.trims.length, 1);
  assert.ok((r.trims[0] ?? 0) > 1_500, String(r.trims[0]));
});

test('leaving the foreground ends the skip with what was shed', async () => {
  const r = run({ buffer: 22 });
  r.skip.loaded();
  r.play();
  await sleep(400);
  r.skip.background();
  await sleep(50);
  assert.deepEqual(r.player.rates, [SKIP_RATE, 1]);
  assert.equal(r.trims.length, 1);
  r.skip.onState('playing');
  await sleep(200);
  assert.deepEqual(r.player.rates, [SKIP_RATE, 1], 'a later Playing does not resume it');
});

test('leaving the foreground before the fast-forward never starts it', async () => {
  let answer: (v: unknown) => void = () => {};
  const r = run({ read: () => new Promise((res) => { answer = res; }) });
  r.skip.loaded();
  r.play();
  await sleep(20);
  r.skip.background();
  answer({ streamIdleWindow: IDLE });
  await sleep(200);
  assert.deepEqual(r.player.rates, []);
  assert.deepEqual(r.trims, []);
});

test('a read that answers while stalled waits for Playing before it sheds', async () => {
  const r = run();
  r.skip.loaded();
  r.play();
  r.player.stall();
  r.skip.onState('buffering');
  await sleep(100);
  assert.deepEqual(r.player.rates, []);
  r.play();
  await sleep(2_200);
  assert.deepEqual(r.player.rates, [SKIP_RATE, SLOW_RATE, 1]);
  assert.equal(r.trims.length, 1);
});

test('cancelling mid-skip restores 1x and reports nothing', async () => {
  const r = run({ buffer: 22 });
  r.skip.loaded();
  r.play();
  await sleep(300);
  r.skip.cancel();
  await sleep(50);
  assert.deepEqual(r.player.rates, [SKIP_RATE, 1]);
  assert.deepEqual(r.trims, []);
});

test('a failed read, or one cancelled in flight, skips nothing', async () => {
  const failed = run({ read: async () => { throw new Error('offline'); } });
  failed.skip.loaded();
  failed.play();
  await sleep(100);
  assert.deepEqual(failed.player.rates, []);

  const inFlight = run({ read: () => new Promise(() => {}) });
  inFlight.skip.loaded();
  inFlight.play();
  await sleep(20);
  inFlight.skip.cancel();
  await sleep(50);
  assert.deepEqual(inFlight.player.rates, []);
  assert.deepEqual(inFlight.trims, []);
});
