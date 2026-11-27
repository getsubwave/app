package com.getsubwave.androidauto

import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat.MediaItem
import android.support.v4.media.session.MediaSessionCompat
import androidx.media.MediaBrowserServiceCompat
import com.doublesymmetry.trackplayer.service.MediaBrowserBridge

/**
 * Android Auto's view of SUB/WAVE: the saved stations, each one playable.
 *
 * Kotlin lists, JS plays. The browse session is the player's own
 * (react-native-track-player), so the car's Now Playing screen, play and pause
 * work as they do on the lock screen. A tap on a station reaches that session,
 * which the RNTP patch (MediaBrowserBridge) turns into a remote-play-id event;
 * service.ts answers it with the tune-in Siri uses (src/intents/tune.ts).
 *
 * The car can bind this with the app not running, and the player's session
 * only exists once JS has set the player up. So the first connection starts
 * React Native and runs the car-connect task (CarConnectTask), and the car's
 * connection completes when the session token arrives.
 *
 * MediaBrowserServiceCompat takes a session token once, so an instance whose
 * session ended (its MusicService was destroyed) can't take the next one. It
 * stops answering instead: once its clients unbind it is destroyed, and the
 * car's next bind creates an instance that waits for the new session.
 */
class SubwaveBrowseService : MediaBrowserServiceCompat() {
  private var sessionEnded = false

  private val session = object : MediaBrowserBridge.SessionListener {
    override fun ready(token: MediaSessionCompat.Token) {
      if (sessionToken == null) sessionToken = token
    }

    override fun ended() {
      if (sessionToken != null) sessionEnded = true
    }
  }

  override fun onCreate() {
    super.onCreate()
    current = this
    MediaBrowserBridge.addListener(session)
  }

  override fun onDestroy() {
    MediaBrowserBridge.removeListener(session)
    current = null
    MediaBrowserBridge.browsing = false
    super.onDestroy()
  }

  override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot? {
    // System UI asks every media app for something to resume after a reboot.
    // A live station has nothing to resume, and answering would start the app
    // in the background on every boot.
    if (rootHints?.getBoolean(BrowserRoot.EXTRA_RECENT) == true) return null
    // Only the car, the Assistant and the system: anything else that binds
    // would read the saved stations and start the app in the background.
    if (!CarCallers.allowed(this, clientPackageName, clientUid)) return null
    // This instance holds a released session's token and can't take another.
    if (sessionEnded) return null
    MediaBrowserBridge.browsing = true
    if (sessionToken == null) CarConnectTask.run(application)
    return BrowserRoot(ROOT, ROOT_EXTRAS)
  }

  override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaItem>>) {
    val items = if (parentId == ROOT) CarStations.load(this).map { it.toMediaItem() } else emptyList()
    result.sendResult(items.toMutableList())
  }

  companion object {
    private const val ROOT = "subwave-root"

    // Stations as a list, not a grid of tiles.
    private val ROOT_EXTRAS = Bundle().apply {
      putBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED", true)
      putInt("android.media.browse.CONTENT_STYLE_PLAYABLE_HINT", 1)
    }

    @Volatile
    private var current: SubwaveBrowseService? = null

    /** Redraws the car's list, when the car is connected. */
    fun stationsChanged() {
      current?.notifyChildrenChanged(ROOT)
    }
  }
}
