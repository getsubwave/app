// Tune-ins and tune-outs from Siri, Shortcuts, Spotlight and the Control
// (src/intents/tune-flow.ts): with the player mounted every load is handed to
// it, so it goes through StreamRecovery; only with none mounted does the
// intent load the stream itself. Also the mounted player's side of a station
// switch (src/lib/remote-play.ts) and the bridge's deadline
// (src/intents/deadline.ts).

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  FALLBACK_BUDGET_MS,
  intentDeadline,
  REPLY_MARGIN_MS,
  timeLeft,
  TIMED_OUT,
  within,
} from '../src/intents/deadline.ts';
import { NO_STATION_MESSAGE } from '../src/intents/station-messages.ts';
import { NOT_SAVED_MESSAGE, tuneIn, tuneOut, type TuneDeps } from '../src/intents/tune-flow.ts';
import {
  claimRemotePlay,
  playerMounted,
  playOnMountedPlayer,
  takeArrival,
  tuneInOnArrival,
} from '../src/lib/remote-play.ts';

const NIGHT = { url: 'https://radio.example.com', name: 'Night Shift', lastUsed: 2 };
const WAVE = { url: 'https://www.getsubwave.com', name: 'SUB/WAVE', lastUsed: 1 };
const DEADLINE = 1_000_000;

interface Opts {
  mounted?: boolean;
  /** The mounted player has a station to load (the claim returns true). */
  playerTakes?: boolean;
  /** The mounted player reaches the new station on a switch. */
  arrives?: boolean;
  onAir?: boolean;
  hasStream?: boolean;
  active?: string | null;
  plays?: boolean;
}

function intents(o: Opts = {}) {
  const calls: string[] = [];
  const onAirStates: boolean[] = [];
  let active = o.active === undefined ? NIGHT.url : o.active;
  const deps: TuneDeps = {
    loadStore: async () => ({ activeStation: active, recents: [NIGHT, WAVE] }),
    setActiveStation: async (ref) => {
      active = ref.url;
      calls.push(`store ${ref.name}`);
    },
    announceSwitch: () => calls.push('announce'),
    onAir: async () => o.onAir ?? false,
    playerMounted: () => o.mounted ?? false,
    playOnMountedPlayer: () => {
      if (!(o.mounted && (o.playerTakes ?? true))) return false;
      calls.push('player tunes in');
      return true;
    },
    tuneInOnArrival: (base) => {
      calls.push(`arm ${base}`);
      return {
        taken: Promise.resolve(o.arrives ?? true),
        cancel: () => calls.push('disarm'),
      };
    },
    hasStream: () => o.hasStream ?? false,
    reloadLast: async () => {
      calls.push('direct reload');
    },
    teardown: async () => {
      calls.push('teardown');
    },
    activeStation: async () =>
      active
        ? {
            name: [NIGHT, WAVE].find((s) => s.url === active)?.name ?? null,
            load: async () => {
              calls.push(`direct load ${active}`);
            },
          }
        : null,
    startAndWait: async (start, deadline) => {
      assert.equal(deadline, DEADLINE);
      try {
        await start();
      } catch {
        return false;
      }
      return o.plays ?? true;
    },
    tuneOut: async () => {
      calls.push('tune out');
    },
    setOnAir: (on) => onAirStates.push(on),
    log: () => {},
  };
  return { deps, calls, onAirStates };
}

test('with the player mounted, a tune-in is handed to it, never loaded directly', async () => {
  for (const hasStream of [true, false]) {
    const s = intents({ mounted: true, hasStream });
    assert.deepEqual(await tuneIn(s.deps, undefined, DEADLINE), { ok: true });
    assert.deepEqual(s.calls, ['player tunes in']);
    assert.deepEqual(s.onAirStates, [true]);
  }
});

test('with no player mounted, the intent loads the stream itself', async () => {
  const warm = intents({ hasStream: true });
  await tuneIn(warm.deps, undefined, DEADLINE);
  assert.deepEqual(warm.calls, ['direct reload']);

  const cold = intents();
  assert.deepEqual(await tuneIn(cold.deps, undefined, DEADLINE), { ok: true });
  assert.deepEqual(cold.calls, [`direct load ${NIGHT.url}`]);
  assert.deepEqual(cold.onAirStates, [true]);
});

test('a mounted player with no station leaves the load to the intent', async () => {
  const s = intents({ mounted: true, playerTakes: false });
  await tuneIn(s.deps, undefined, DEADLINE);
  assert.deepEqual(s.calls, [`direct load ${NIGHT.url}`]);
});

test('a stream already on air is left alone, and the control says so', async () => {
  const s = intents({ mounted: true, onAir: true });
  assert.deepEqual(await tuneIn(s.deps, undefined, DEADLINE), { ok: true });
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.onAirStates, [true]);
});

test('naming the station already active tunes in to it without a switch', async () => {
  const s = intents({ mounted: true });
  await tuneIn(s.deps, `${NIGHT.url}/`, DEADLINE);
  assert.deepEqual(s.calls, ['player tunes in']);
});

test('a switch with the player mounted lets the player tune in on the new station', async () => {
  const s = intents({ mounted: true });
  assert.deepEqual(await tuneIn(s.deps, WAVE.url, DEADLINE), { ok: true });
  // Armed before StationContext hears of it; no teardown or load here.
  assert.deepEqual(s.calls, ['store SUB/WAVE', `arm ${WAVE.url}`, 'announce', 'disarm']);
  assert.deepEqual(s.onAirStates, [true]);
});

test('a switch the player never reaches is a failure, and the control is the player’s', async () => {
  const s = intents({ mounted: true, arrives: false });
  const reply = await tuneIn(s.deps, WAVE.url, DEADLINE);
  assert.equal(reply.ok, false);
  assert.match(reply.message ?? '', /SUB\/WAVE/);
  assert.ok(!s.calls.some((c) => c.startsWith('direct')));
  assert.deepEqual(s.onAirStates, []);
});

test('a switch with no player mounted loads the new station, then tells StationContext', async () => {
  const s = intents();
  assert.deepEqual(await tuneIn(s.deps, WAVE.url, DEADLINE), { ok: true });
  assert.deepEqual(s.calls, ['store SUB/WAVE', 'teardown', `direct load ${WAVE.url}`, 'announce']);
});

test('a stream that never starts is reported, and the control turns off with no player', async () => {
  const s = intents({ plays: false });
  const reply = await tuneIn(s.deps, undefined, DEADLINE);
  assert.equal(reply.ok, false);
  assert.match(reply.message ?? '', /Night Shift/);
  assert.deepEqual(s.onAirStates, [false]);
});

test('an unsaved station or no station at all is said, and nothing loads', async () => {
  const unsaved = intents();
  assert.deepEqual(await tuneIn(unsaved.deps, 'https://elsewhere.example.com', DEADLINE), {
    ok: false,
    message: NOT_SAVED_MESSAGE,
  });
  const none = intents({ active: null });
  assert.deepEqual(await tuneIn(none.deps, undefined, DEADLINE), {
    ok: false,
    message: NO_STATION_MESSAGE,
  });
  assert.deepEqual([...unsaved.calls, ...none.calls], []);
});

test('a tune-out stops the player and turns the control off', async () => {
  const s = intents({ mounted: true });
  assert.deepEqual(await tuneOut(s.deps), { ok: true });
  assert.deepEqual(s.calls, ['tune out']);
  assert.deepEqual(s.onAirStates, [false]);
});

function claim(t: TestContext, handler: () => boolean) {
  t.after(claimRemotePlay(handler));
}

test('the mounted player’s claim takes an intent’s tune-in', (t) => {
  assert.equal(playerMounted(), false);
  assert.equal(playOnMountedPlayer(), false);
  let plays = 0;
  claim(t, () => {
    plays += 1;
    return true;
  });
  assert.equal(playerMounted(), true);
  assert.equal(playOnMountedPlayer(), true);
  assert.equal(plays, 1);
});

test('the player takes a switch once, only on the station it was armed for', async () => {
  const arrival = tuneInOnArrival('https://www.getsubwave.com', 10_000);
  assert.equal(takeArrival('https://radio.example.com'), false);
  assert.equal(takeArrival('https://www.getsubwave.com/'), true);
  assert.equal(takeArrival('https://www.getsubwave.com'), false);
  assert.equal(await arrival.taken, true);
});

test('a newer switch replaces an older one, and a cancelled one is not taken', async () => {
  const older = tuneInOnArrival('https://radio.example.com', 10_000);
  const newer = tuneInOnArrival('https://www.getsubwave.com', 10_000);
  assert.equal(await older.taken, false);
  assert.equal(takeArrival('https://radio.example.com'), false);
  newer.cancel();
  assert.equal(await newer.taken, false);
  assert.equal(takeArrival('https://www.getsubwave.com'), false);
});

test('an arrival the player never reaches lapses at its cap', async () => {
  const arrival = tuneInOnArrival('https://www.getsubwave.com', 5);
  assert.equal(await arrival.taken, false);
  assert.equal(takeArrival('https://www.getsubwave.com'), false);
});

test('the answer is due a margin before the bridge stops waiting', () => {
  assert.equal(intentDeadline(20_000, 3_000), 20_000 - REPLY_MARGIN_MS);
  // A binary that sends none: the worst case, a whole ack window spent booting.
  assert.equal(intentDeadline(undefined, 3_000), 3_000 + FALLBACK_BUDGET_MS - REPLY_MARGIN_MS);
  assert.equal(intentDeadline(Number.NaN, 3_000), 3_000 + FALLBACK_BUDGET_MS - REPLY_MARGIN_MS);
  // A deadline far ahead (a clock change) is capped.
  assert.ok(intentDeadline(10_000_000, 3_000) <= 3_000 + 30_000);
  assert.equal(timeLeft(10, 25), 0);
  assert.equal(timeLeft(25, 10), 15);
});

test('within gives the work’s answer, or TIMED_OUT once the wait ends first', async () => {
  assert.equal(await within(Promise.resolve('done'), new Promise(() => {})), 'done');
  assert.equal(await within(new Promise(() => {}), Promise.resolve()), TIMED_OUT);
});
