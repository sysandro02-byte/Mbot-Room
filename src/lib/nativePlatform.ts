/**
 * The Android APK owns this marker in MainActivity's WebView user agent.
 * Do not use viewport size here: the responsive web site intentionally keeps
 * its own visual language on phones and tablets.
 */
export const isNativeAndroidApp = (marker = 'MBoteRoomAndroid') =>
  typeof navigator !== 'undefined' && new RegExp(`${marker}\\/\\d+(?:\\.\\d+)*`, 'i').test(navigator.userAgent);
