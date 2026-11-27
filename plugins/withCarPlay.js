// Expo config plugin: the CarPlay app, behind SUBWAVE_CARPLAY=1.
//
// The CarPlay UI is Swift in targets/live-activity/_shared/SubwaveCarPlay.swift. This
// plugin only switches it on:
//
//   1. `com.apple.developer.carplay-audio` in the entitlements. Apple grants
//      it on request, and a DEVICE build cannot be signed with it until the
//      grant is on the App ID, so it is opt-in: set SUBWAVE_CARPLAY=1 for a
//      simulator build (the CarPlay simulator ignores provisioning) and, once
//      the grant lands, in eas.json. Unset, the app is exactly as before.
//   2. A CarPlay scene role in the scene manifest that `ios.enableSceneSupport`
//      writes, multiple scenes on, and the phone role's delegate swapped for
//      PhoneSceneDelegate, which adopts React Native when the car launched the
//      app first and refuses a second window.
//
// Must come BEFORE expo-build-properties in app.json: a later plugin's Info.plist
// mod runs first, and this one edits the manifest that one creates.
// scripts/carplay-plugin.test.ts checks both, flag set and unset.
//
// Usage in app.json plugins: "./plugins/withCarPlay"

const { withEntitlementsPlist, withInfoPlist } = require('@expo/config-plugins');

const ENTITLEMENT = 'com.apple.developer.carplay-audio';
const PHONE_ROLE = 'UIWindowSceneSessionRoleApplication';
const CAR_ROLE = 'CPTemplateApplicationSceneSessionRoleApplication';

function carPlayEnabled() {
  return process.env.SUBWAVE_CARPLAY === '1';
}

function withCarPlayEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    if (carPlayEnabled()) cfg.modResults[ENTITLEMENT] = true;
    else delete cfg.modResults[ENTITLEMENT];
    return cfg;
  });
}

function withCarPlayScene(config) {
  return withInfoPlist(config, (cfg) => {
    if (!carPlayEnabled()) return cfg;
    const written = cfg.modResults.UIApplicationSceneManifest;
    if (!written?.UISceneConfigurations?.[PHONE_ROLE]?.[0]) {
      throw new Error(
        'withCarPlay: no scene manifest. Turn on expo-build-properties ios.enableSceneSupport, ' +
          'and list ./plugins/withCarPlay before expo-build-properties in app.json.',
      );
    }
    // A copy: expo-build-properties hands over its own module-level manifest,
    // and compares later ones against it to tell its manifest from the app's.
    const manifest = structuredClone(written);
    // Apple's CarPlay manifest (developer.apple.com/documentation/carplay/
    // building-your-apps-initial-carplay-interface): multiple scenes on, since
    // the app declares a phone scene and a CarPlay one, and the CarPlay class
    // named. On iPad that also allows a second window, which
    // PhoneSceneDelegate refuses.
    manifest.UIApplicationSupportsMultipleScenes = true;
    manifest.UISceneConfigurations[PHONE_ROLE][0].UISceneDelegateClassName =
      'SubwavePhoneSceneDelegate';
    manifest.UISceneConfigurations[CAR_ROLE] = [
      {
        UISceneClassName: 'CPTemplateApplicationScene',
        UISceneConfigurationName: 'CarPlay',
        UISceneDelegateClassName: 'SubwaveCarPlaySceneDelegate',
      },
    ];
    cfg.modResults.UIApplicationSceneManifest = manifest;
    return cfg;
  });
}

module.exports = function withCarPlay(config) {
  return withCarPlayScene(withCarPlayEntitlement(config));
};
