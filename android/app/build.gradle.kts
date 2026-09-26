val ciVersionCode = (System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1).coerceAtLeast(1)
val ciVersionName = System.getenv("GITHUB_SHA")?.take(7)?.let { "0.2.$ciVersionCode+$it" } ?: "0.2.$ciVersionCode"

val releaseKeystorePath = System.getenv("MBOTEROOM_KEYSTORE_FILE")
val releaseStorePassword = System.getenv("MBOTEROOM_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("MBOTEROOM_KEY_ALIAS")
val releaseKeyPassword = System.getenv("MBOTEROOM_KEY_PASSWORD")
val hasReleaseSigning = listOf(
    releaseKeystorePath,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

plugins {
    id("com.android.application")
}

android {
    namespace = "com.loukatech.mboteroom"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.loukatech.mboteroom"
        minSdk = 24
        targetSdk = 35
        versionCode = ciVersionCode
        versionName = ciVersionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    buildTypes {
        release {
            isDebuggable = false
            isJniDebuggable = false
            isMinifyEnabled = true
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}


dependencies {
    implementation("androidx.webkit:webkit:1.17.1")
}
