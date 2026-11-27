package com.getsubwave.androidauto

import android.os.Handler
import android.os.Looper
import android.support.v4.media.session.PlaybackStateCompat
import com.doublesymmetry.trackplayer.service.MediaBrowserBridge
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The JS half is modules/android-auto/index.ts; the car's side is
// SubwaveBrowseService.
class SubwaveAndroidAutoModule : Module() {
  private val main = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("SubwaveAndroidAuto")

    /** The saved stations and the active one, as JSON from JS:
     *  `{ active, stations: [{ id, name }] }`. Redraws the car's list. */
    Function("setStations") { json: String ->
      val context = appContext.reactContext ?: return@Function
      CarStations.save(context, json)
      SubwaveBrowseService.stationsChanged()
    }

    /** Why a car pick failed, shown in place of Now Playing until the next
     *  pick or until audio plays. `kind` is CarErrorKind in
     *  src/intents/car-errors.ts (npm test checks the two match). */
    Function("showError") { kind: String, message: String ->
      val code = errorCode(kind)
      main.post { MediaBrowserBridge.showError(message, code) }
    }

    Function("clearError") {
      main.post { MediaBrowserBridge.clearError() }
    }

    /** setupPlayer failed in the car-connect task (src/intents/car.ts). */
    Function("setupFailed") {
      SubwaveBrowseService.setupFailed()
    }
  }

  private fun errorCode(kind: String): Int = when (kind) {
    "locked" -> PlaybackStateCompat.ERROR_CODE_AUTHENTICATION_EXPIRED
    "not-saved", "no-station" -> PlaybackStateCompat.ERROR_CODE_NOT_SUPPORTED
    "unreachable" -> PlaybackStateCompat.ERROR_CODE_APP_ERROR
    else -> PlaybackStateCompat.ERROR_CODE_UNKNOWN_ERROR
  }
}
