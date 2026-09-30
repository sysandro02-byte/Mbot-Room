package com.loukatech.mboteroom;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowMetrics;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final String REMOTE_APP_HOST = "mboteroom.loukatech.com";
    private static final String LOCAL_APP_HOST = WebViewAssetLoader.DEFAULT_DOMAIN;
    private static final String LOCAL_APP_URL = "https://" + LOCAL_APP_HOST + "/index.html";
    private static final int REQUEST_SCREEN_CAPTURE = 2002;
    // The bridge sends compressed stills to the WebView canvas. 15 fps at 1280 px
    // keeps text legible while avoiding the memory and bandwidth spikes of 30 fps.
    private static final long FRAME_INTERVAL_MS = 67L;
    private static final int MAX_CAPTURE_EDGE = 1280;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private MediaProjectionManager mediaProjectionManager;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private long lastFrameAt;

    private final MediaProjection.Callback projectionCallback = new MediaProjection.Callback() {
        @Override
        public void onStop() {
            runOnUiThread(() -> releaseScreenCapture(false, true));
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(false);

        mediaProjectionManager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(LOCAL_APP_HOST)
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        settings.setUserAgentString(settings.getUserAgentString() + " MBoteRoomAndroid/0.3.0");

        webView.addJavascriptInterface(new AndroidBridge(), "MBoteRoomAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = assetLoader.shouldInterceptRequest(request.getUrl());
                return local != null ? local : super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isTrustedAppUri(uri)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // Keep unsupported external schemes out of the privileged WebView.
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!isTrustedAppUri(request.getOrigin())) {
                        request.deny();
                        return;
                    }
                    List<String> granted = new ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                                && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            granted.add(resource);
                        }
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            granted.add(resource);
                        }
                    }
                    if (granted.isEmpty()) request.deny();
                    else request.grant(granted.toArray(new String[0]));
                });
            }
        });

        requestRuntimePermissions();
        // Preserve the exact SPA route when Android recreates the activity after app switching.
        // If no WebView state exists, the bundled shell still opens without a network connection.
        boolean restored = savedInstanceState != null && webView.restoreState(savedInstanceState) != null;
        if (!restored) webView.loadUrl(LOCAL_APP_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView == null) return;
        webView.onResume();
        String currentUrl = webView.getUrl();
        if (currentUrl == null || currentUrl.isBlank() || "about:blank".equals(currentUrl)) {
            webView.loadUrl(LOCAL_APP_URL);
        }
    }

    private final class AndroidBridge {
        @JavascriptInterface
        public boolean isScreenCaptureSupported() {
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP;
        }

        @JavascriptInterface
        public void requestScreenCapture() {
            runOnUiThread(() -> {
                if (!isTrustedAppPage()) {
                    notifyWebScreenError("Partage d’écran refusé hors de MBotéRoom.");
                    return;
                }
                if (mediaProjection != null) {
                    notifyWebScreenStarted(
                            imageReader != null ? imageReader.getWidth() : 540,
                            imageReader != null ? imageReader.getHeight() : 960
                    );
                    return;
                }
                try {
                    startActivityForResult(mediaProjectionManager.createScreenCaptureIntent(), REQUEST_SCREEN_CAPTURE);
                } catch (Exception error) {
                    notifyWebScreenError("Impossible d’ouvrir l’autorisation de partage d’écran.");
                }
            });
        }

        @JavascriptInterface
        public void stopScreenCapture() {
            runOnUiThread(() -> releaseScreenCapture(true, true));
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_SCREEN_CAPTURE) return;

        if (resultCode != RESULT_OK || data == null) {
            notifyWebScreenError("Partage d’écran annulé.");
            return;
        }

        ScreenCaptureService.start(this);
        waitForProjectionService(resultCode, data, 0);
    }

    private void waitForProjectionService(int resultCode, Intent data, int attempt) {
        if (ScreenCaptureService.isRunning()) {
            beginScreenProjection(resultCode, data);
            return;
        }
        if (attempt >= 30) {
            ScreenCaptureService.stop(this);
            notifyWebScreenError("Le service de partage d’écran n’a pas pu démarrer.");
            return;
        }
        mainHandler.postDelayed(() -> waitForProjectionService(resultCode, data, attempt + 1), 50L);
    }

    private void beginScreenProjection(int resultCode, Intent data) {
        try {
            // The foreground mediaProjection service is already running here.
            // Do not stop it before getMediaProjection(): Android 14+ rejects that order.
            mediaProjection = mediaProjectionManager.getMediaProjection(resultCode, data);
            if (mediaProjection == null) {
                ScreenCaptureService.stop(this);
                notifyWebScreenError("Autorisation de partage d’écran invalide.");
                return;
            }
            mediaProjection.registerCallback(projectionCallback, mainHandler);

            int sourceWidth;
            int sourceHeight;
            int densityDpi = getResources().getDisplayMetrics().densityDpi;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowMetrics metrics = getWindowManager().getCurrentWindowMetrics();
                Rect bounds = metrics.getBounds();
                sourceWidth = Math.max(2, bounds.width());
                sourceHeight = Math.max(2, bounds.height());
            } else {
                DisplayMetrics metrics = new DisplayMetrics();
                //noinspection deprecation
                getWindowManager().getDefaultDisplay().getRealMetrics(metrics);
                sourceWidth = Math.max(2, metrics.widthPixels);
                sourceHeight = Math.max(2, metrics.heightPixels);
                densityDpi = metrics.densityDpi;
            }

            double scale = Math.min(1d, (double) MAX_CAPTURE_EDGE / Math.max(sourceWidth, sourceHeight));
            int width = Math.max(2, (int) Math.round(sourceWidth * scale));
            int height = Math.max(2, (int) Math.round(sourceHeight * scale));

            captureThread = new HandlerThread("MBoteRoom-ScreenCapture");
            captureThread.start();
            captureHandler = new Handler(captureThread.getLooper());
            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            imageReader.setOnImageAvailableListener(this::handleScreenImage, captureHandler);

            virtualDisplay = mediaProjection.createVirtualDisplay(
                    "MBoteRoomScreenShare",
                    width,
                    height,
                    densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader.getSurface(),
                    null,
                    captureHandler
            );
            lastFrameAt = 0L;
            notifyWebScreenStarted(width, height);
        } catch (Exception error) {
            releaseScreenCapture(true, false);
            notifyWebScreenError("Impossible de démarrer le partage d’écran sur cet appareil.");
        }
    }

    private void handleScreenImage(ImageReader reader) {
        Image image = null;
        Bitmap paddedBitmap = null;
        Bitmap croppedBitmap = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) return;

            long now = SystemClock.elapsedRealtime();
            if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
            lastFrameAt = now;

            Image.Plane[] planes = image.getPlanes();
            if (planes.length == 0) return;
            Image.Plane plane = planes[0];
            ByteBuffer buffer = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int rowPadding = Math.max(0, rowStride - pixelStride * image.getWidth());
            int paddedWidth = image.getWidth() + rowPadding / Math.max(1, pixelStride);

            paddedBitmap = Bitmap.createBitmap(paddedWidth, image.getHeight(), Bitmap.Config.ARGB_8888);
            paddedBitmap.copyPixelsFromBuffer(buffer);
            croppedBitmap = Bitmap.createBitmap(paddedBitmap, 0, 0, image.getWidth(), image.getHeight());

            ByteArrayOutputStream output = new ByteArrayOutputStream();
            croppedBitmap.compress(Bitmap.CompressFormat.JPEG, 78, output);
            String base64 = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
            String dataUrl = "data:image/jpeg;base64," + base64;
            int width = image.getWidth();
            int height = image.getHeight();
            runOnUiThread(() -> notifyWebScreenFrame(dataUrl, width, height));
        } catch (Exception ignored) {
            // Drop one bad frame; the following frame can recover the stream.
        } finally {
            if (croppedBitmap != null) croppedBitmap.recycle();
            if (paddedBitmap != null && paddedBitmap != croppedBitmap) paddedBitmap.recycle();
            if (image != null) image.close();
        }
    }

    private void releaseScreenCapture(boolean stopProjection, boolean notifyWeb) {
        boolean hadCapture = mediaProjection != null || virtualDisplay != null || imageReader != null;

        if (virtualDisplay != null) {
            try { virtualDisplay.release(); } catch (Exception ignored) {}
            virtualDisplay = null;
        }
        if (imageReader != null) {
            try { imageReader.setOnImageAvailableListener(null, null); } catch (Exception ignored) {}
            try { imageReader.close(); } catch (Exception ignored) {}
            imageReader = null;
        }

        MediaProjection projection = mediaProjection;
        mediaProjection = null;
        if (projection != null) {
            try { projection.unregisterCallback(projectionCallback); } catch (Exception ignored) {}
            if (stopProjection) {
                try { projection.stop(); } catch (Exception ignored) {}
            }
        }

        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
            captureHandler = null;
        }

        ScreenCaptureService.stop(this);
        if (notifyWeb && hadCapture) notifyWebScreenEnded();
    }

    private void notifyWebScreenStarted(int width, int height) {
        evaluateTrustedJavascript("window.__mboteAndroidScreenStarted&&window.__mboteAndroidScreenStarted(" + width + "," + height + ");");
    }

    private void notifyWebScreenFrame(String dataUrl, int width, int height) {
        evaluateTrustedJavascript("window.__mboteAndroidScreenFrame&&window.__mboteAndroidScreenFrame("
                + JSONObject.quote(dataUrl) + "," + width + "," + height + ");");
    }

    private void notifyWebScreenEnded() {
        evaluateTrustedJavascript("window.__mboteAndroidScreenEnded&&window.__mboteAndroidScreenEnded();");
    }

    private void notifyWebScreenError(String message) {
        evaluateTrustedJavascript("window.__mboteAndroidScreenError&&window.__mboteAndroidScreenError("
                + JSONObject.quote(message) + ");");
    }

    private void evaluateTrustedJavascript(String script) {
        if (webView == null || !isTrustedAppPage()) return;
        webView.evaluateJavascript(script, null);
    }

    private boolean isTrustedAppPage() {
        return webView != null && isTrustedAppUrl(webView.getUrl());
    }

    private boolean isTrustedAppUrl(String value) {
        if (value == null) return false;
        try {
            return isTrustedAppUri(Uri.parse(value));
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean isTrustedAppUri(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        String host = uri.getHost();
        return LOCAL_APP_HOST.equalsIgnoreCase(host) || REMOTE_APP_HOST.equalsIgnoreCase(host);
    }

    private void requestRuntimePermissions() {
        List<String> permissions = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.CAMERA);
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!permissions.isEmpty()) requestPermissions(permissions.toArray(new String[0]), 1001);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        releaseScreenCapture(true, false);
        if (webView != null) {
            webView.removeJavascriptInterface("MBoteRoomAndroid");
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
