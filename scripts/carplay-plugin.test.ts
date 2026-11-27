// plugins/withCarPlay.js switches the CarPlay app on only when SUBWAVE_CARPLAY=1
// is set at prebuild, because a device build cannot be signed with Apple's
// CarPlay entitlement until the grant is on the App ID. Unset, the Info.plist
// and entitlements must be what expo-build-properties alone writes: a stray
// CarPlay role or entitlement fails every store build's signing.
//
// The two plugins run here in app.json's order, with their Info.plist and
// entitlements mods called directly on an empty plist, as prebuild calls them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import type { ExpoConfig } from 'expo/config';
// What prebuild loads for "expo-build-properties" in app.json.
import withBuildProperties from 'expo-build-properties/app.plugin.js';
import withCarPlay from '../plugins/withCarPlay.js';

const ROOT = path.join(import.meta.dirname, '..');
const ENTITLEMENT = 'com.apple.developer.carplay-audio';

type Plist = Record<string, unknown>;
type Mod = (config: Plist) => Promise<Plist>;

/** Set or unset SUBWAVE_CARPLAY for one test. */
function flag(t: TestContext, value: string | undefined) {
  const before = process.env.SUBWAVE_CARPLAY;
  if (value === undefined) delete process.env.SUBWAVE_CARPLAY;
  else process.env.SUBWAVE_CARPLAY = value;
  t.after(() => {
    if (before === undefined) delete process.env.SUBWAVE_CARPLAY;
    else process.env.SUBWAVE_CARPLAY = before;
  });
}

/** What the iOS mods write into an empty Info.plist and entitlements, with
 *  or without the CarPlay plugin ahead of expo-build-properties. */
async function prebuild(withPlugin: boolean): Promise<{ info: Plist; entitlements: Plist }> {
  let config = {
    name: 'SUB/WAVE',
    slug: 'subwave',
    _internal: { projectRoot: ROOT },
  } as ExpoConfig;
  if (withPlugin) config = withCarPlay(config);
  config = withBuildProperties(config, { ios: { enableSceneSupport: true } });

  const run = async (name: 'infoPlist' | 'entitlements') => {
    const mod = (config.mods?.ios as Record<string, Mod> | undefined)?.[name];
    const base = { ...config, modResults: {}, modRequest: { platform: 'ios', modName: name, projectRoot: ROOT } };
    return ((await mod?.(base)) ?? base).modResults as Plist;
  };
  return { info: await run('infoPlist'), entitlements: await run('entitlements') };
}

test('unset, the Info.plist and entitlements are what they are without the plugin', async (t) => {
  flag(t, undefined);
  const without = await prebuild(false);
  const withIt = await prebuild(true);
  assert.ok(without.info.UIApplicationSceneManifest, 'expo-build-properties wrote no scene manifest');
  assert.deepEqual(withIt, without);
  assert.equal(ENTITLEMENT in withIt.entitlements, false);
});

test('any value but 1 leaves CarPlay off', async (t) => {
  flag(t, 'true');
  const { info, entitlements } = await prebuild(true);
  assert.deepEqual(info, (await prebuild(false)).info);
  assert.equal(ENTITLEMENT in entitlements, false);
});

test('set, it adds the entitlement, the CarPlay role, multiple scenes and the phone delegate', async (t) => {
  flag(t, '1');
  const { info, entitlements } = await prebuild(true);
  assert.equal(entitlements[ENTITLEMENT], true);
  assert.deepEqual(info.UIApplicationSceneManifest, {
    // Apple's CarPlay manifest: a phone scene and a CarPlay one.
    UIApplicationSupportsMultipleScenes: true,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [
        {
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: 'SubwavePhoneSceneDelegate',
        },
      ],
      CPTemplateApplicationSceneSessionRoleApplication: [
        {
          UISceneClassName: 'CPTemplateApplicationScene',
          UISceneConfigurationName: 'CarPlay',
          UISceneDelegateClassName: 'SubwaveCarPlaySceneDelegate',
        },
      ],
    },
  });
});

test('set, it leaves expo-build-properties’ own manifest as it was', async (t) => {
  // That plugin compares a plist's manifest against its module-level one to
  // tell its own from the app's, so an edit in place would leak into the next.
  flag(t, '1');
  await prebuild(true);
  flag(t, undefined);
  const after = await prebuild(false);
  const phone = (after.info.UIApplicationSceneManifest as {
    UISceneConfigurations: Record<string, { UISceneDelegateClassName: string }[]>;
  }).UISceneConfigurations.UIWindowSceneSessionRoleApplication[0];
  assert.equal(phone.UISceneDelegateClassName, 'EXExpoAppSceneDelegate');
});

test('set, it fails the prebuild when there is no scene manifest to edit', async (t) => {
  flag(t, '1');
  let config = { name: 'SUB/WAVE', slug: 'subwave' } as ExpoConfig;
  config = withCarPlay(config);
  const mod = (config.mods?.ios as Record<string, Mod>).infoPlist;
  await assert.rejects(
    mod({ ...config, modResults: {}, modRequest: { platform: 'ios', modName: 'infoPlist' } }),
    /no scene manifest/,
  );
});

test('app.json lists the plugin before expo-build-properties', () => {
  // A later plugin's Info.plist mod runs first, and withCarPlay edits the
  // manifest that expo-build-properties writes.
  const plugins: unknown[] = JSON.parse(readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo.plugins;
  const name = (p: unknown) => (Array.isArray(p) ? p[0] : p);
  const carPlay = plugins.findIndex((p) => name(p) === './plugins/withCarPlay');
  const buildProperties = plugins.findIndex((p) => name(p) === 'expo-build-properties');
  assert.ok(carPlay >= 0, 'withCarPlay is not in app.json');
  assert.ok(carPlay < buildProperties, 'withCarPlay must come before expo-build-properties');
});
