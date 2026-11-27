import Foundation

// Whether the station is on, for the code that cannot ask the player: the
// tune control (TuneControl.swift, widget) and the CarPlay station list
// (SubwaveCarPlay.swift, app). JS writes it through the app-intents module's
// setOnAir, which posts `changed` after a change.
//
// The suite, key and name are matched by STRING with
// modules/app-intents/ios/SubwaveAppIntentsModule.swift, which cannot import
// this file. Change one side, change both.
enum OnAirFlag {
  static let changed = Notification.Name("SubwaveOnAirChanged")
  private static let suite = "group.com.getsubwave.app"
  private static let key = "subwave.onAir"

  static var isOn: Bool {
    UserDefaults(suiteName: suite)?.bool(forKey: key) ?? false
  }

  /// A process that has just started plays nothing, so a flag still on was
  /// left by an app that was killed while it played. Cleared before anything
  /// reads it, so neither the CarPlay list nor the tune control (when it next
  /// asks) marks a station as playing until JS says one is.
  static func clearStale() {
    guard let defaults = UserDefaults(suiteName: suite), defaults.bool(forKey: key) else { return }
    defaults.set(false, forKey: key)
    NotificationCenter.default.post(name: changed, object: nil)
  }
}
