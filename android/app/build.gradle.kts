val ciVersionCode = (System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1).coerceAtLeast(1)
val ciVersionName = System.getenv("GITHUB_SHA")?.take(7)?.let { "0.2.$ciVersionCode+$it" } ?: "0.2.$ciVersionCode"

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

    buildTypes {
        release {
            isMinifyEnabled = true
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
