// Android Auto: the car's picks (src/intents/car-picks.ts), and the two
// contracts JS shares with native code by text alone, which drift with no
// build error: the car-connect task's name, and the spoken-name rule Google's
// voice search shares with Siri's.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { IntentReply } from '../modules/app-intents/index.ts';
import { CAR_PICK_BUDGET_MS, createCarPicks } from '../src/intents/car-picks.ts';

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
    'car search "x" failed: load failed',
  ]);
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
