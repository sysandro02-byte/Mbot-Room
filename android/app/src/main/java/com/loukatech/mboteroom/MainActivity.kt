package com.loukatech.mboteroom

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var pendingMediaRequest: PermissionRequest? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val appUri: Uri by lazy { Uri.parse(BuildConfig.APP_URL) }

    private val mediaPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            val request = pendingMediaRequest
            pendingMediaRequest = null
            if (request == null) return@registerForActivityResult

            val allowed = request.resources.filter { resource ->
                when (resource) {
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
                        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
                        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                    else -> false
                }
            }.toTypedArray()

            if (allowed.isNotEmpty()) request.grant(allowed) else request.deny()
        }

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = filePathCallback
            filePathCallback = null
            if (callback == null) return@registerForActivityResult
            callback.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            )
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Même pour l'APK QA, on ne rend pas le WebView inspectable via chrome://inspect.
        WebView.setWebContentsDebuggingEnabled(false)

        webView = WebView(this)
        setContentView(webView)
        configureWebView()

        val initialUrl = intent?.data?.takeIf(::isTrustedUri)?.toString() ?: BuildConfig.APP_URL
        if (savedInstanceState == null) {
            webView.loadUrl(initialUrl)
        } else {
            webView.restoreState(savedInstanceState)
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    private fun configureWebView() {
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            userAgentString = "${userAgentString} MBoteRoom-Android/1.0"
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val target = request.url
                if (isTrustedUri(target)) return false
                openExternal(target)
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (!isTrustedUri(request.origin)) {
                        request.deny()
                        return@runOnUiThread
                    }

                    val androidPermissions = mutableListOf<String>()
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources &&
                        ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
                    ) {
                        androidPermissions += Manifest.permission.CAMERA
                    }
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources &&
                        ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
                    ) {
                        androidPermissions += Manifest.permission.RECORD_AUDIO
                    }

                    if (androidPermissions.isEmpty()) {
                        val safeResources = request.resources.filter {
                            it == PermissionRequest.RESOURCE_VIDEO_CAPTURE ||
                                it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
                        }.toTypedArray()
                        if (safeResources.isNotEmpty()) request.grant(safeResources) else request.deny()
                    } else {
                        pendingMediaRequest?.deny()
                        pendingMediaRequest = request
                        mediaPermissionLauncher.launch(androidPermissions.distinct().toTypedArray())
                    }
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingMediaRequest === request) pendingMediaRequest = null
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                return try {
                    val chooserIntent = fileChooserParams?.createIntent()
                        ?: Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                    fileChooserLauncher.launch(chooserIntent)
                    true
                } catch (_: Exception) {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = null
                    false
                }
            }
        }
    }

    private fun isTrustedUri(uri: Uri): Boolean {
        val expectedHost = appUri.host ?: return false
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(expectedHost, ignoreCase = true)
    }

    private fun openExternal(uri: Uri) {
        if (uri.scheme != "https" && uri.scheme != "mailto" && uri.scheme != "tel") return
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.data?.takeIf(::isTrustedUri)?.let { webView.loadUrl(it.toString()) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        pendingMediaRequest?.deny()
        pendingMediaRequest = null
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        webView.stopLoading()
        webView.webChromeClient = null
        webView.webViewClient = WebViewClient()
        webView.destroy()
        super.onDestroy()
    }
}
