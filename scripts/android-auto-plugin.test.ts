// plugins/withAndroidAuto.js declares Android Auto only when
// SUBWAVE_ANDROID_AUTO=1 is set at prebuild, because Play enforced against the
// app's car listing once (#477) and the Play build must be able to ship
// without it. Unset, or any other value, the manifest must declare no Android
// Auto support at all: no browse service, no car meta-data, no descriptor.
//
// The plugin's manifest and file mods run here as prebuild calls them, on a
// minimal manifest and a scratch android/ folder.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import type { ExpoConfig } from 'expo/config';
import withAndroidAuto from '../plugins/withAndroidAuto.js';

const ROOT = path.join(import.meta.dirname, '..');
const SERVICE = 'com.getsubwave.androidauto.SubwaveBrowseService';
const CAR_META = 'com.google.android.gms.car.application';

type Manifest = { manifest: { application?: Record<string, unknown>[] } & Record<string, unknown> };
type Mod = (config: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Set or unset SUBWAVE_ANDROID_AUTO for one test. */
function flag(t: TestContext, value: string | undefined) {
  const before = process.env.SUBWAVE_ANDROID_AUTO;
  if (value === undefined) delete process.env.SUBWAVE_ANDROID_AUTO;
  else process.env.SUBWAVE_ANDROID_AUTO = value;
  t.after(() => {
    if (before === undefined) delete process.env.SUBWAVE_ANDROID_AUTO;
    else process.env.SUBWAVE_ANDROID_AUTO = before;
  });
}

function emptyManifest(): Manifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [{ $: { 'android:name': '.MainActivity' } }],
        },
      ],
    },
  };
}

/** Runs the plugin's mods: the manifest one on `manifest`, the file one on a
 *  scratch android/ folder. */
async function prebuild(t: TestContext, manifest: Manifest = emptyManifest()) {
  const android = mkdtempSync(path.join(tmpdir(), 'subwave-auto-'));
  t.after(() => rmSync(android, { recursive: true, force: true }));
  const config = withAndroidAuto({
    name: 'SUB/WAVE',
    slug: 'subwave',
    _internal: { projectRoot: ROOT },
  } as ExpoConfig);
  const mods = config.mods?.android as Record<string, Mod> | undefined;
  const request = (modName: string) => ({
    platform: 'android',
    modName,
    projectRoot: ROOT,
    platformProjectRoot: android,
  });
  const out = await mods?.manifest?.({
    ...config,
    modResults: manifest,
    modRequest: request('manifest'),
  });
  await mods?.dangerous?.({ ...config, modResults: {}, modRequest: request('dangerous') });
  const desc = path.join(android, 'app/src/main/res/xml/subwave_automotive_app_desc.xml');
  return { manifest: (out?.modResults ?? manifest) as Manifest, android, desc };
}

function declared(manifest: Manifest) {
  const app = manifest.manifest.application?.[0] ?? {};
  const names = (key: string) =>
    ((app[key] as { $?: Record<string, string> }[] | undefined) ?? []).map(
      (e) => e.$?.['android:name'],
    );
  return { services: names('service'), meta: names('meta-data'), xml: JSON.stringify(manifest) };
}

for (const value of [undefined, '', '0', 'true', 'yes', ' 1']) {
  test(`SUBWAVE_ANDROID_AUTO=${JSON.stringify(value)} declares no Android Auto support`, async (t) => {
    flag(t, value);
    const { manifest, desc } = await prebuild(t);
    assert.deepEqual(manifest, emptyManifest(), 'the manifest is what it was without the plugin');
    const { xml } = declared(manifest);
    for (const needle of [SERVICE, CAR_META, 'MediaBrowserService', 'automotive_app_desc']) {
      assert.equal(xml.includes(needle), false, `${needle} in a flag-off manifest`);
    }
    assert.equal(existsSync(desc), false, 'no automotive descriptor is written');
  });
}

test('SUBWAVE_ANDROID_AUTO=1 declares the browse service, the car meta-data and its descriptor', async (t) => {
  flag(t, '1');
  const { manifest, desc } = await prebuild(t);
  const app = manifest.manifest.application?.[0] as Record<string, unknown>;
  assert.deepEqual(app.service, [
    {
      $: { 'android:name': SERVICE, 'android:exported': 'true' },
      'intent-filter': [
        { action: [{ $: { 'android:name': 'android.media.browse.MediaBrowserService' } }] },
      ],
    },
  ]);
  assert.deepEqual(app['meta-data'], [
    { $: { 'android:name': CAR_META, 'android:resource': '@xml/subwave_automotive_app_desc' } },
  ]);
  assert.match(
    readFileSync(desc, 'utf8'),
    /<automotiveApp>\s*<uses name="media" \/>\s*<\/automotiveApp>/,
  );
});

test('a second flagged prebuild declares each once, and an unflagged one removes them', async (t) => {
  flag(t, '1');
  const once = (await prebuild(t)).manifest;
  const twice = (await prebuild(t, once)).manifest;
  assert.deepEqual(declared(twice).services, [SERVICE]);
  assert.deepEqual(declared(twice).meta, [CAR_META]);

  process.env.SUBWAVE_ANDROID_AUTO = '0';
  const off = await prebuild(t, twice);
  assert.deepEqual(off.manifest, emptyManifest());
});

test('a flag-off prebuild deletes the descriptor a flagged one left', async (t) => {
  flag(t, '1');
  const on = await prebuild(t);
  assert.ok(existsSync(on.desc));
  process.env.SUBWAVE_ANDROID_AUTO = '';
  const { writeAutomotiveDescriptor } = withAndroidAuto as unknown as {
    writeAutomotiveDescriptor(root: string, enabled: boolean): void;
  };
  writeAutomotiveDescriptor(on.android, false);
  assert.equal(existsSync(on.desc), false);
});

test("the module's own manifest declares nothing for the car, and app.json runs the plugin", () => {
  const module = readFileSync(
    path.join(ROOT, 'modules/android-auto/android/src/main/AndroidManifest.xml'),
    'utf8',
  ).replace(/<!--[\s\S]*?-->/g, '');
  for (const needle of ['service', 'meta-data', 'gms.car', 'MediaBrowserService']) {
    assert.equal(
      module.includes(needle),
      false,
      `the module manifest declares ${needle}: move it to the plugin`,
    );
  }
  assert.equal(
    existsSync(
      path.join(
        ROOT,
        'modules/android-auto/android/src/main/res/xml/subwave_automotive_app_desc.xml',
      ),
    ),
    false,
    'the descriptor is written by the plugin, not shipped by the module',
  );
  const plugins = JSON.parse(readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo
    .plugins as unknown[];
  assert.ok(plugins.includes('./plugins/withAndroidAuto'));
});
