// iPad support (getsubwave/app#10). The app ships on iPad as a native iPad
// app: every orientation there, portrait-only on iPhone, and a centred column
// once the window is wide enough. Split View narrows an iPad window to phone
// widths, so the wide layout keys on the window, never the device.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isWide, WIDE_MIN_WIDTH } from '../src/lib/layout.ts';

const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));

test('iPad is a supported device family', () => {
  assert.equal(appJson.expo.ios.supportsTablet, true);
});

test('iPad gets every orientation; iPhone stays portrait', () => {
  assert.equal(appJson.expo.orientation, 'portrait');
  assert.deepEqual(new Set(appJson.expo.ios.infoPlist['UISupportedInterfaceOrientations~ipad']), new Set([
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationPortraitUpsideDown',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ]));
});

test('the wide layout keys on window width', () => {
  assert.equal(isWide(320), false);
  assert.equal(isWide(430), false);
  assert.equal(isWide(507), false);
  assert.equal(isWide(WIDE_MIN_WIDTH), true);
  assert.equal(isWide(744), true);
  assert.equal(isWide(1366), true);
});

test('every Modal allows landscape', () => {
  const sheet = readFileSync(new URL('../src/components/ui/Sheet.tsx', import.meta.url), 'utf8');
  assert.match(sheet, /supportedOrientations=\{ALL_ORIENTATIONS\}/);
});
