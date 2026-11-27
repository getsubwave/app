package com.getsubwave.androidauto

import android.Manifest
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process

/**
 * Who may browse SUB/WAVE: Android Auto, Android Automotive's media centre,
 * the Google app (Assistant's voice search), and the system. Everything else
 * gets no root. The service is exported, so without this any app could read
 * the saved stations' hosts and start the player in the background.
 *
 * Google's Media Controller Test app passes too, in a debug build only.
 *
 * Follows Google's media sample (UAMP's PackageValidator): this app, the
 * system UID, a platform-signed caller or one holding MEDIA_CONTENT_CONTROL
 * pass. For the Google apps, UAMP pins signing certificates; here a known
 * package must instead own the calling UID and be a system app or installed
 * by the Play Store, which no other developer can publish under that name.
 * That needs no certificate list to keep up to date.
 */
internal object CarCallers {
  private val GOOGLE_CALLERS = setOf(
    "com.google.android.projection.gearhead", // Android Auto
    "com.google.android.carassistant", // Assistant on Android Automotive
    "com.android.car.media", // Android Automotive's media centre
    "com.google.android.googlequicksearchbox", // Google app, Assistant
    // Gemini (guideline VC-1). Unconfirmed as the package that binds in the
    // car: check logcat on the Desktop Head Unit (docs/TESTING.md).
    "com.google.android.apps.bard",
  )

  // Google's Media Controller Test app (github.com/googlesamples/android-media-controller),
  // sideloaded for testing: debug builds only.
  private const val MEDIA_CONTROLLER_TEST = "com.example.android.mediacontroller"
  private const val PLAY_STORE = "com.android.vending"

  fun allowed(context: Context, packageName: String, uid: Int): Boolean {
    if (uid == Process.myUid() || uid == Process.SYSTEM_UID) return true
    val pm = context.packageManager
    // The name must be the caller's own, not one it claims.
    if (pm.getPackagesForUid(uid)?.contains(packageName) != true) return false
    if (pm.checkSignatures("android", packageName) == PackageManager.SIGNATURE_MATCH) return true
    if (pm.checkPermission(Manifest.permission.MEDIA_CONTENT_CONTROL, packageName) ==
      PackageManager.PERMISSION_GRANTED
    ) return true
    if (packageName == MEDIA_CONTROLLER_TEST) return isDebuggable(context)
    return packageName in GOOGLE_CALLERS && (isSystemApp(pm, packageName) || fromPlay(pm, packageName))
  }

  // This app's own build, not the library's: a release build never passes.
  private fun isDebuggable(context: Context): Boolean =
    (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

  private fun isSystemApp(pm: PackageManager, packageName: String): Boolean = try {
    val flags = pm.getApplicationInfo(packageName, 0).flags
    (flags and (ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0
  } catch (e: PackageManager.NameNotFoundException) {
    false
  }

  private fun fromPlay(pm: PackageManager, packageName: String): Boolean = try {
    val installer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      pm.getInstallSourceInfo(packageName).installingPackageName
    } else {
      @Suppress("DEPRECATION")
      pm.getInstallerPackageName(packageName)
    }
    installer == PLAY_STORE
  } catch (e: Exception) {
    false
  }
}
