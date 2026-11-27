// The subscriber sets an App Intent tells about a tune-out, a station switch
// or a like (src/lib/announcer.ts).

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnnouncer } from '../src/lib/announcer.ts';

test('every subscriber hears an announcement until it unsubscribes', () => {
  const a = createAnnouncer<number>();
  const heard: string[] = [];
  const off = a.subscribe((n) => heard.push(`a${n}`));
  a.subscribe((n) => heard.push(`b${n}`));
  a.announce(1);
  off();
  a.announce(2);
  assert.deepEqual(heard, ['a1', 'b1', 'b2']);
});

test('a subscriber that throws reaches neither the others nor the announcer', () => {
  const a = createAnnouncer();
  let heard = 0;
  a.subscribe(() => {
    throw new Error('broken');
  });
  a.subscribe(() => {
    heard += 1;
  });
  assert.doesNotThrow(() => a.announce());
  assert.equal(heard, 1);
});
