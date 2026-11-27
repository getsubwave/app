// Android Auto: the car's picks (src/intents/car-picks.ts), and the two
// contracts JS shares with native code by text alone, which drift with no
// build error: the car-connect task's name, and the spoken-name rule Google's
// voice search shares with Siri's.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { IntentReply } from '../modules/app-intents/index.ts';
import { CAR_ERROR_KINDS, carErrorFor } from '../src/intents/car-errors.ts';
import { CAR_PICK_BUDGET_MS, createCarPicks } from '../src/intents/car-picks.ts';
import type { TuneReply } from '../src/intents/tune-flow.ts';

const ROOT = path.join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

function picks() {
  const logged: string[] = [];
  const tuned: string[] = [];
  const car = createCarPicks((msg) => logged.push(msg));
  const pick = (label: string, reply: IntentReply | Error = { ok: true }) => ({
    label,
    tune: async () => {
      tuned.push(label);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });
  return { car, pick, logged, tuned };
}

test('a pick that plays tunes in at once', async () => {
  const { car, pick, tuned } = picks();
  await car.pick(pick('pick a'), true);
  assert.deepEqual(tuned, ['pick a']);
  assert.equal(car.playPrepared(), false);
});

test('a prepare starts nothing, and the next Play tunes in to it once', async () => {
  const { car, pick, tuned } = picks();
  await car.pick(pick('pick a'), false);
  assert.deepEqual(tuned, []);
  assert.equal(car.playPrepared(), true);
  await Promise.resolve();
  assert.deepEqual(tuned, ['pick a']);
  assert.equal(car.playPrepared(), false, 'a later Play is the usual remote Play');
});

test("a prepared pick's deadline runs from its Play, not from the prepare", async () => {
  let now = 1_000;
  const deadlines: number[] = [];
  const car = createCarPicks(
    () => {},
    () => now,
  );
  await car.pick(
    {
      label: 'pick a',
      tune: async (deadline) => {
        deadlines.push(deadline);
        return { ok: true };
      },
    },
    false,
  );
  now = 61_000;
  car.playPrepared();
  await Promise.resolve();
  assert.deepEqual(deadlines, [61_000 + CAR_PICK_BUDGET_MS]);
});

test('a pick that plays replaces a held prepare', async () => {
  const { car, pick, tuned } = picks();
  await car.pick(pick('pick a'), false);
  await car.pick(pick('pick b'), true);
  assert.equal(car.playPrepared(), false);
  assert.deepEqual(tuned, ['pick b']);
});

test('pause or stop drops a held prepare', async () => {
  const { car, pick, tuned } = picks();
  await car.pick(pick('pick a'), false);
  car.forget();
  assert.equal(car.playPrepared(), false);
  assert.deepEqual(tuned, []);
});

test('a refused or failed tune-in is logged, never thrown', async () => {
  const { car, pick, logged } = picks();
  await car.pick(pick('pick a', { ok: false, message: "That station isn't saved" }), true);
  await car.pick(pick('search "x"', new Error('load failed')), true);
  assert.deepEqual(logged, [
    "car pick a refused: That station isn't saved",
    'car error shown: unreachable',
    'car search "x" failed: load failed',
    'car error shown: unreachable',
  ]);
});

// The car's error state (src/intents/car-errors.ts).
function screened(locked = false) {
  const shown: string[] = [];
  const lockChecks: number[] = [];
  const logged: string[] = [];
  const car = createCarPicks((msg) => logged.push(msg), Date.now, {
    show: (e) => shown.push(`${e.kind}: ${e.message}`),
    clear: () => shown.push('clear'),
    locked: async () => {
      lockChecks.push(1);
      return locked;
    },
  });
  const pick = (reply: TuneReply | Error, tune?: () => Promise<TuneReply>) => ({
    label: 'pick',
    tune:
      tune ??
      (async () => {
        if (reply instanceof Error) throw reply;
        return reply;
      }),
  });
  return { car, pick, shown, lockChecks, logged };
}

test('each failure shows the car why, and sends it to the phone only when safe', () => {
  const unreachable = carErrorFor(
    { ok: false, reason: 'unreachable', station: 'Night Shift' },
    false,
  );
  assert.deepEqual(unreachable, {
    kind: 'unreachable',
    message: "Couldn't reach Night Shift. Try again in a moment.",
  });
  assert.equal(
    carErrorFor({ ok: false, reason: 'unreachable' }, false).message,
    "Couldn't reach the station. Try again in a moment.",
  );
  assert.deepEqual(
    carErrorFor({ ok: false, reason: 'unreachable', station: 'Night Shift' }, true),
    {
      kind: 'locked',
      message:
        "Night Shift needs its password. When it's safe, unlock it in SUB/WAVE on your phone.",
    },
  );
  assert.equal(
    carErrorFor({ ok: false, reason: 'unreachable' }, true).message.startsWith('The station needs'),
    true,
  );
  assert.equal(
    carErrorFor({ ok: false, reason: 'not-saved' }, true).kind,
    'not-saved',
    'locked only reads a failed stream',
  );
  assert.equal(carErrorFor({ ok: false, reason: 'no-station' }, false).kind, 'no-station');
  for (const kind of ['not-saved', 'no-station', 'locked'] as const) {
    const reason = kind === 'locked' ? 'unreachable' : kind;
    const { message } = carErrorFor({ ok: false, reason }, kind === 'locked');
    assert.match(
      message,
      /When it's safe, .* on your phone\./,
      `${kind} sends the driver to the phone safely`,
    );
  }
});

test('a pick clears the last error first, and a success shows none', async () => {
  const { car, pick, shown } = screened();
  await car.pick(pick({ ok: false, reason: 'not-saved' }), true);
  await car.pick(pick({ ok: true }), true);
  assert.deepEqual(shown, [
    'clear',
    "not-saved: That station isn't saved. When it's safe, add it in SUB/WAVE on your phone.",
    'clear',
  ]);
});

test('a prepare clears the error too, and its Play reports its own failure', async () => {
  const { car, pick, shown } = screened();
  await car.pick(pick({ ok: false, reason: 'no-station' }), false);
  assert.deepEqual(shown, ['clear']);
  assert.equal(car.playPrepared(), true);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(shown, [
    'clear',
    'clear',
    "no-station: No station yet. When it's safe, add one in SUB/WAVE on your phone.",
  ]);
});

test('only a failed stream asks whether the station is locked', async () => {
  const locked = screened(true);
  await locked.car.pick(
    locked.pick({ ok: false, reason: 'unreachable', station: 'Night Shift' }),
    true,
  );
  assert.deepEqual(
    locked.shown.at(-1),
    "locked: Night Shift needs its password. When it's safe, unlock it in SUB/WAVE on your phone.",
  );
  assert.equal(locked.lockChecks.length, 1);

  const unsaved = screened(true);
  await unsaved.car.pick(unsaved.pick({ ok: false, reason: 'not-saved' }), true);
  assert.equal(unsaved.lockChecks.length, 0);
});

test('a lock check that fails reads as unreachable', async () => {
  const shown: string[] = [];
  const car = createCarPicks(() => {}, Date.now, {
    show: (e) => shown.push(e.kind),
    clear: () => {},
    locked: async () => {
      throw new Error('offline');
    },
  });
  await car.pick({ label: 'pick', tune: async () => ({ ok: false, reason: 'unreachable' }) }, true);
  assert.deepEqual(shown, ['unreachable']);
});

test("an older pick's failure never covers a newer pick", async () => {
  const { car, pick, shown } = screened();
  let fail: (reply: TuneReply) => void = () => {};
  const slow = car.pick(
    pick({ ok: true }, () => new Promise<TuneReply>((resolve) => (fail = resolve))),
    true,
  );
  await car.pick(pick({ ok: true }), true);
  fail({ ok: false, reason: 'unreachable' });
  await slow;
  assert.deepEqual(shown, ['clear', 'clear']);
});

test('every car error kind has its own error code in Kotlin', () => {
  const kotlin = read(
    'modules/android-auto/android/src/main/java/com/getsubwave/androidauto/SubwaveAndroidAutoModule.kt',
  );
  const mapped = [
    ...(kotlin.match(/fun errorCode[\s\S]*?\n {2}}/)?.[0] ?? '').matchAll(/"([a-z-]+)"/g),
  ].map((m) => m[1]);
  assert.deepEqual(
    [...mapped].sort(),
    [...CAR_ERROR_KINDS].sort(),
    'errorCode and CAR_ERROR_KINDS differ: change both',
  );
});

test('the car-connect task tells the car when setupPlayer fails', () => {
  const car = read('src/intents/car.ts');
  assert.match(car, /setupPlayer\(\)\.catch\([\s\S]*carSetupFailed\(\)/);
});

test('the car-connect task has the same name in JS and Kotlin', () => {
  const js = read('src/intents/car.ts').match(/CAR_CONNECT_TASK = '([^']+)'/)?.[1];
  const kotlin = read(
    'modules/android-auto/android/src/main/java/com/getsubwave/androidauto/CarConnectTask.kt',
  ).match(/const val TASK = "([^"]+)"/)?.[1];
  assert.ok(js, 'CAR_CONNECT_TASK not found in src/intents/car.ts');
  assert.equal(kotlin, js, 'CarConnectTask.kt starts a task JS never registered');
});

test("matchStations keeps Siri's rule: the same generic words and shortest term", () => {
  const ts = read('src/lib/station-store.ts');
  const swift = read('targets/live-activity/_shared/StationEntities.swift');
  const words = (block: string | undefined) =>
    [...(block ?? '').matchAll(/['"]([a-z]+)['"]/g)].map((m) => m[1]).sort();
  const tsWords = words(ts.match(/GENERIC_TERMS = new Set\(\[([^\]]*)\]/)?.[1]);
  const swiftWords = words(swift.match(/genericTerms: Set<String> = \[([^\]]*)\]/)?.[1]);
  assert.ok(tsWords.length, 'GENERIC_TERMS not found in station-store.ts');
  assert.deepEqual(swiftWords, tsWords, 'the generic words differ: change both');
  const tsMin = ts.match(/wanted\.length < (\d+)/)?.[1];
  const swiftMin = swift.match(/wanted\.count >= (\d+)/)?.[1];
  assert.ok(tsMin, 'the shortest-term check not found in station-store.ts');
  assert.equal(swiftMin, tsMin, 'the shortest term differs: change both');
});
