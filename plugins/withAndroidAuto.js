// Expo config plugin: Android Auto, behind SUBWAVE_ANDROID_AUTO=1.
//
// The car's side is modules/android-auto (SubwaveBrowseService and friends).
// That module's own manifest declares nothing, so its classes are compiled
// into every Android build but reachable only once this plugin declares them:
//
//   1. SubwaveBrowseService, exported, with the
//      android.media.browse.MediaBrowserService intent filter Android Auto
//      binds through.
//   2. The com.google.android.gms.car.application meta-data, pointing at
//      res/xml/subwave_automotive_app_desc.xml (`<uses name="media"/>`),
//      which this plugin also writes.
//
// Play enforced against the app's Android Auto listing once (#477), so the
// Play build can ship without it: unset, or any value but 1, and the merged
// manifest declares no Android Auto support at all, and a descriptor left by
// an earlier flagged prebuild is deleted. docs/RELEASE.md has the plan,
// scripts/android-auto-plugin.test.ts checks both states.
//
// Usage in app.json plugins: "./plugins/withAndroidAuto"

const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const SERVICE = 'com.getsubwave.androidauto.SubwaveBrowseService';
const BROWSE_ACTION = 'android.media.browse.MediaBrowserService';
const CAR_META = 'com.google.android.gms.car.application';
const DESC = 'subwave_automotive_app_desc';
const DESC_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by plugins/withAndroidAuto.js when SUBWAVE_ANDROID_AUTO=1. -->
<automotiveApp>
  <uses name="media" />
</automotiveApp>
`;

function androidAutoEnabled() {
  return process.env.SUBWAVE_ANDROID_AUTO === '1';
}

/** Adds or removes the browse service and the car meta-data on a parsed
 *  AndroidManifest.xml (as @expo/config-plugins hands it over). */
function applyAndroidAuto(manifest, enabled) {
  const app = manifest.manifest.application?.[0];
  if (!app) throw new Error('withAndroidAuto: the manifest has no <application>.');
  const named = (name) => (entry) => entry.$?.['android:name'] === name;

  app['meta-data'] = (app['meta-data'] ?? []).filter((m) => !named(CAR_META)(m));
  app.service = (app.service ?? []).filter((s) => !named(SERVICE)(s));
  if (enabled) {
    app['meta-data'].push({
      $: { 'android:name': CAR_META, 'android:resource': `@xml/${DESC}` },
    });
    app.service.push({
      $: { 'android:name': SERVICE, 'android:exported': 'true' },
      'intent-filter': [{ action: [{ $: { 'android:name': BROWSE_ACTION } }] }],
    });
  }
  if (!app['meta-data'].length) delete app['meta-data'];
  if (!app.service.length) delete app.service;
  return manifest;
}

/** Writes res/xml/subwave_automotive_app_desc.xml, or deletes it. */
function writeAutomotiveDescriptor(platformProjectRoot, enabled) {
  const file = path.join(platformProjectRoot, 'app/src/main/res/xml', `${DESC}.xml`);
  if (enabled) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, DESC_XML);
  } else {
    fs.rmSync(file, { force: true });
  }
}

function withAndroidAuto(config) {
  config = withAndroidManifest(config, (cfg) => {
    applyAndroidAuto(cfg.modResults, androidAutoEnabled());
    return cfg;
  });
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      writeAutomotiveDescriptor(cfg.modRequest.platformProjectRoot, androidAutoEnabled());
      return cfg;
    },
  ]);
}

module.exports = withAndroidAuto;
module.exports.applyAndroidAuto = applyAndroidAuto;
module.exports.writeAutomotiveDescriptor = writeAutomotiveDescriptor;
