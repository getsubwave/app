package com.getsubwave.androidauto

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaBrowserCompat.MediaItem
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.utils.MediaConstants
import com.doublesymmetry.trackplayer.service.MediaBrowserBridge

/**
 * Android Auto's view of SUB/WAVE: one Stations tab holding the saved
 * stations, the one listened to last first, each one playable.
 *
 * Kotlin lists, JS plays. The browse session is the player's own
 * (react-native-track-player), so the car's Now Playing screen, play and pause
 * work as they do on the lock screen. A tap on a station reaches that session,
 * which the RNTP patch (MediaBrowserBridge) turns into a remote-play-id event;
 * service.ts answers it with the tune-in Siri uses (src/intents/tune.ts), and
 * a pick that fails shows the car why (src/intents/car-errors.ts).
 *
 * The car can bind this with the app not running, and the player's session
 * only exists once JS has set the player up. So the first connection starts
 * React Native and runs the car-connect task (CarConnectTask), and the car's
 * connection completes when the session token arrives. If it hasn't within
 * CONNECT_TIMEOUT_MS, or JS says setupPlayer failed, the car gets a session of
 * this service's own that shows only an error, instead of waiting forever.
 *
 * MediaBrowserServiceCompat takes a session token once, so an instance whose
 * session ended (its MusicService was destroyed) can't take the next one. It
 * stops answering instead: once its clients unbind it is destroyed, and the
 * car's next bind creates an instance that waits for the new session. The
 * same goes for an instance that gave the car the error session.
 */
class SubwaveBrowseService : MediaBrowserServiceCompat() {
  private var sessionEnded = false
  private var errorSession: MediaSessionCompat? = null
  private val handler = Handler(Looper.getMainLooper())
  private val connectTimeout = Runnable { connectFailed() }

  private val session = object : MediaBrowserBridge.SessionListener {
    override fun ready(token: MediaSessionCompat.Token) {
      handler.removeCallbacks(connectTimeout)
      if (sessionToken == null) {
        sessionToken = token
      } else if (errorSession != null) {
        // The player came up after the car was shown the error. Ending the
        // error session tells the car this one is gone, so that it reconnects;
        // a fresh instance then takes the player's session.
        releaseErrorSession()
      }
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
    handler.removeCallbacks(connectTimeout)
    MediaBrowserBridge.removeListener(session)
    releaseErrorSession()
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
    if (sessionToken == null) {
      CarConnectTask.run(application)
      handler.removeCallbacks(connectTimeout)
      handler.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS)
    }
    return BrowserRoot(rootFor(rootHints), ROOT_EXTRAS)
  }

  override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaItem>>) {
    val items: List<MediaItem> = when (parentId) {
      ROOT_TABS -> listOf(stationsTab())
      STATIONS, ROOT_FLAT -> stationItems()
      else -> emptyList()
    }
    result.sendResult(items.toMutableList())
  }

  /** The player's session never came: setupPlayer was refused or React
   *  Native didn't start. The car shows why rather than a spinner. */
  internal fun connectFailed() {
    handler.removeCallbacks(connectTimeout)
    CarConnectTask.reset()
    if (sessionToken != null) return
    val error = MediaSessionCompat(this, "SubwaveCarError").apply {
      setPlaybackState(
        PlaybackStateCompat.Builder()
          .setState(PlaybackStateCompat.STATE_ERROR, 0L, 0f)
          .setErrorMessage(
            PlaybackStateCompat.ERROR_CODE_APP_ERROR,
            getString(R.string.subwave_car_start_failed),
          )
          .build(),
      )
      isActive = true
    }
    errorSession = error
    sessionToken = error.sessionToken
    // This instance can't take the player's session any more.
    sessionEnded = true
  }

  private fun releaseErrorSession() {
    errorSession?.run {
      isActive = false
      release()
    }
    errorSession = null
  }

  private fun stationsTab(): MediaItem {
    val description = MediaDescriptionCompat.Builder()
      .setMediaId(STATIONS)
      .setTitle(getString(R.string.subwave_car_stations))
      .setExtras(LIST_STYLE)
      .build()
    return MediaItem(description, MediaItem.FLAG_BROWSABLE)
  }

  private fun stationItems(): List<MediaItem> {
    val stations = CarStations.load(this)
    if (stations.isNotEmpty()) return stations.map { it.toMediaItem() }
    // Neither browsable nor playable: a line of text, nothing to tap into.
    val description = MediaDescriptionCompat.Builder()
      .setMediaId(EMPTY)
      .setTitle(getString(R.string.subwave_car_empty_title))
      .setSubtitle(getString(R.string.subwave_car_empty_subtitle))
      .build()
    return listOf(MediaItem(description, 0))
  }

  companion object {
    private const val CONNECT_TIMEOUT_MS = 8_000L

    // Tabs: the root holds only the Stations tab. Android Auto and Automotive
    // show only browsable root children, as tabs, unless the car's root hints
    // say playable ones are supported.
    private const val ROOT_TABS = "subwave-root"
    // A car whose hints allow only playable root children: the stations there.
    private const val ROOT_FLAT = "subwave-stations-root"
    private const val STATIONS = "subwave-stations"
    private const val EMPTY = "subwave-no-stations"

    private val LIST_STYLE = Bundle().apply {
      putInt(
        MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
        MediaConstants.DESCRIPTION_EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
      )
    }

    // Stations as a list, not a grid of tiles.
    private val ROOT_EXTRAS = Bundle().apply {
      putBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED", true)
      putInt(
        MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
        MediaConstants.DESCRIPTION_EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
      )
    }

    /** The Stations tab, unless the caller can show only playable items at
     *  its root. No hints means Google's defaults: browsable only. */
    internal fun rootFor(hints: Bundle?): String {
      val flags = hints?.getInt(
        MediaConstants.BROWSER_ROOT_HINTS_KEY_ROOT_CHILDREN_SUPPORTED_FLAGS,
        MediaItem.FLAG_BROWSABLE,
      ) ?: MediaItem.FLAG_BROWSABLE
      val browsable = (flags and MediaItem.FLAG_BROWSABLE) != 0
      val playable = (flags and MediaItem.FLAG_PLAYABLE) != 0
      return if (!browsable && playable) ROOT_FLAT else ROOT_TABS
    }

    @Volatile
    private var current: SubwaveBrowseService? = null

    private val main = Handler(Looper.getMainLooper())

    /** Redraws the car's list, when the car is connected. */
    fun stationsChanged() {
      main.post {
        current?.run {
          notifyChildrenChanged(STATIONS)
          notifyChildrenChanged(ROOT_FLAT)
        }
      }
    }

    /** JS couldn't set the player up for the car (src/intents/car.ts). */
    fun setupFailed() {
      main.post { current?.connectFailed() }
    }
  }
}
