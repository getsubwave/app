import CarPlay
import Foundation
import UIKit

// The CarPlay app: the saved stations as a list, and the system Now Playing
// screen once one is tuned in. Present only when the build carries Apple's
// com.apple.developer.carplay-audio entitlement and the CarPlay scene role
// (plugins/withCarPlay.js, SUBWAVE_CARPLAY=1); otherwise these classes are
// never instantiated.
//
// Swift draws, JS decides. The list reads the stations the app mirrors for
// Siri (SavedStations), and a tap hands the station to JS through the same
// bridge Siri's Tune in uses, so switching and tuning in are
// src/intents/tune.ts (decided in tune-flow.ts), which hands the load to the
// mounted player when there is one, and every wait fits the deadline the
// bridge sends. Now Playing is fed by the player as it is for the Lock Screen.
//
// App target only, like SubwaveShortcuts.swift.
#if canImport(ExpoModulesCore)
internal import Expo
import React

/// The CarPlay scene. Named in Info.plist by its Objective-C name.
@available(iOSApplicationExtension, unavailable)
@objc(SubwaveCarPlaySceneDelegate)
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  private var interfaceController: CPInterfaceController?
  private var stationsTemplate: CPListTemplate?
  private var observers: [NSObjectProtocol] = []

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController
    // The car can launch SUB/WAVE with no phone screen at all, and a station
    // tap needs JS to answer the bridge.
    ReactBoot.startIfNeeded()

    let template = CPListTemplate(title: "Stations", sections: stationSections())
    template.emptyViewTitleVariants = ["No saved stations"]
    template.emptyViewSubtitleVariants = ["Add a station in SUB/WAVE on your iPhone."]
    stationsTemplate = template
    interfaceController.setRootTemplate(template, animated: false, completion: nil)
    configureNowPlaying()

    let center = NotificationCenter.default
    for name in [savedStationsChanged, OnAirFlag.changed] {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          self?.refreshStations()
        })
    }
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    stationsTemplate = nil
    self.interfaceController = nil
  }

  // MARK: - Stations

  private func stationSections() -> [CPListSection] {
    let saved = SavedStations.load()
    let onAir = OnAirFlag.isOn
    let icon = UIImage(systemName: "dot.radiowaves.left.and.right")
    let items = saved.stations.map { station -> CPListItem in
      let host = URL(string: station.id)?.host() ?? station.id
      let item = CPListItem(text: station.name, detailText: host, image: icon)
      item.isPlaying = onAir && station.id == saved.active
      item.handler = { [weak self] _, completion in
        self?.tuneIn(station.id, completion: completion)
      }
      return item
    }
    return [CPListSection(items: items)]
  }

  private func refreshStations() {
    stationsTemplate?.updateSections(stationSections())
  }

  /// The row shows a spinner until `completion`, so it is called once the
  /// stream has started or failed, not when the tap lands: at most the
  /// bridge's reply window, which JS's waits are cut to.
  private func tuneIn(_ stationID: String, completion: @escaping () -> Void) {
    Task { @MainActor in
      do {
        try await SubwaveIntentBridge.perform(.tuneIn, ["station": stationID])
        showNowPlaying()
      } catch {
        showAlert(Self.message(for: error, else: "SUB/WAVE couldn't tune in."))
      }
      completion()
    }
  }

  // MARK: - Now Playing

  /// The system screen, fed from the player's Now Playing info. No skip or
  /// scrub (one shared live stream); a heart, liked through the same path as
  /// "like this song" from Siri. A like that fails says why, as Siri would.
  private func configureNowPlaying() {
    let nowPlaying = CPNowPlayingTemplate.shared
    nowPlaying.isUpNextButtonEnabled = false
    nowPlaying.isAlbumArtistButtonEnabled = false
    if let heart = UIImage(systemName: "heart") {
      let like = CPNowPlayingImageButton(image: heart) { [weak self] _ in
        Task { @MainActor in
          do {
            try await SubwaveIntentBridge.perform(.like)
          } catch {
            self?.showAlert(Self.message(for: error, else: "SUB/WAVE couldn't like that song."))
          }
        }
      }
      nowPlaying.updateNowPlayingButtons([like])
    }
  }

  private func showNowPlaying() {
    guard let controller = interfaceController,
      !(controller.topTemplate is CPNowPlayingTemplate)
    else { return }
    controller.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
  }

  /// The bridge's own message (JS's answer, or that the app didn't answer),
  /// else `fallback`.
  private static func message(for error: Error, else fallback: String) -> String {
    (error as? SubwaveIntentError)?.message ?? fallback
  }

  private func showAlert(_ message: String) {
    guard let controller = interfaceController else { return }
    let ok = CPAlertAction(title: "OK", style: .cancel) { _ in
      controller.dismissTemplate(animated: true, completion: nil)
    }
    controller.presentTemplate(
      CPAlertTemplate(titleVariants: [message], actions: [ok]), animated: true, completion: nil)
  }
}

// MARK: - Starting JS without the phone

/// Under the scene life cycle React Native starts when the phone's window
/// scene connects (ExpoAppSceneDelegate). A launch by the car connects only
/// the CarPlay scene, so the CarPlay delegate starts it here instead, into a
/// window with no scene: the same start the app delegate made before scenes,
/// so expo-updates still chooses the bundle. PhoneSceneDelegate then moves that
/// window onto the phone's scene rather than starting a second copy.
@available(iOSApplicationExtension, unavailable)
@MainActor
enum ReactBoot {
  static func startIfNeeded() {
    guard
      let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider,
      provider.window == nil,
      let factory = provider.reactNativeFactory
    else { return }
    // No player has run in this process yet, so an on-air flag still set was
    // left by an app killed while it played.
    OnAirFlag.clearStale()
    // Sized when PhoneSceneDelegate gives it a scene.
    let window = UIWindow(frame: .zero)
    provider.window = window
    factory.startReactNative(
      withModuleName: provider.reactNativeFactoryModuleName, in: window, launchOptions: nil)
  }
}

/// The phone's window scene: Expo's own, except when React Native is already
/// running in a window. A window with no scene (ReactBoot, or a scene the
/// system disconnected) is moved onto this scene. A window on another live
/// scene means a second window: CarPlay needs UIApplicationSupportsMultipleScenes,
/// which also lets iPadOS open more windows of the app, and one React tree
/// plays one stream, so the second is refused rather than given a second
/// player.
@available(iOSApplicationExtension, unavailable)
@objc(SubwavePhoneSceneDelegate)
final class PhoneSceneDelegate: ExpoAppSceneDelegate {
  override func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider,
      let running = provider.window
    else {
      super.scene(scene, willConnectTo: session, options: connectionOptions)
      return
    }
    if running.windowScene != nil {
      UIApplication.shared.requestSceneSessionDestruction(session, options: nil, errorHandler: nil)
      return
    }
    running.windowScene = windowScene
    // ReactBoot made it with no screen to size it by.
    running.frame = windowScene.coordinateSpace.bounds
    window = running
    running.makeKeyAndVisible()

    // What ExpoAppSceneDelegate forwards after its own start, through its own
    // handlers, so the open options, the RCTLinkingManager fallback and its
    // dedupe stay Expo's. React Native was started before this scene existed,
    // so a link that opened the app arrives as a `url` event rather than as
    // Linking.getInitialURL(). Re-check on the SDK 58 upgrade (TESTING.md).
    if !connectionOptions.urlContexts.isEmpty {
      self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    }
    connectionOptions.userActivities.forEach { self.scene(scene, continue: $0) }
    if let shortcutItem = connectionOptions.shortcutItem {
      self.windowScene(windowScene, performActionFor: shortcutItem) { _ in }
    }
  }
}

#endif
