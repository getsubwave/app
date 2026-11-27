package com.getsubwave.androidauto

import android.app.Application
import androidx.annotation.MainThread
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * Runs JS's car-connect task, which sets the player up so its session exists
 * for the car (src/intents/car.ts). Starts React Native first when the car is
 * what launched the app: there is no activity, so nothing else will.
 */
internal object CarConnectTask {
  // Matched by STRING with src/intents/car.ts (npm test checks).
  private const val TASK = "SubwaveCarConnect"
  private const val TIMEOUT_MS = 30_000L

  // The listener waiting on React Native, while it starts.
  private var waiting: Pair<ReactHost, ReactInstanceEventListener>? = null

  @MainThread
  fun run(app: Application) {
    val host = (app as? ReactApplication)?.reactHost ?: return
    host.currentReactContext?.let {
      start(it)
      return
    }
    if (waiting != null) return
    val listener = object : ReactInstanceEventListener {
      override fun onReactContextInitialized(context: ReactContext) {
        host.removeReactInstanceEventListener(this)
        UiThreadUtil.runOnUiThread {
          if (waiting?.second !== this) return@runOnUiThread
          waiting = null
          start(context)
        }
      }
    }
    waiting = host to listener
    host.addReactInstanceEventListener(listener)
    host.start()
  }

  /** The car gave up waiting (SubwaveBrowseService.connectFailed): the next
   *  connection starts over, rather than finding a start still pending. */
  @MainThread
  fun reset() {
    waiting?.let { (host, listener) -> host.removeReactInstanceEventListener(listener) }
    waiting = null
  }

  private fun start(context: ReactContext) {
    HeadlessJsTaskContext.getInstance(context)
      .startTask(HeadlessJsTaskConfig(TASK, Arguments.createMap(), TIMEOUT_MS, true))
  }
}
