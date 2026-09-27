plugins {
    id("com.android.application")
}

val repoRoot = rootProject.projectDir.resolve("../..")
val spinonNdkVersion = repoRoot.resolve("tools/android-ndk-version.txt").readText().trim()
val prepareSpinonBootstrap by tasks.registering(Exec::class) {
    workingDir = repoRoot
    commandLine("bash", "tools/build-android.sh")
}

tasks.named("preBuild").configure {
    dependsOn(prepareSpinonBootstrap)
}

tasks.configureEach {
    if (name.startsWith("merge") &&
        (name.endsWith("Assets") || name.endsWith("JniLibFolders") || name.endsWith("NativeLibs"))
    ) {
        dependsOn(prepareSpinonBootstrap)
    }
}

android {
    namespace = "dev.spinon.bootstrap"
    compileSdk = 36
    buildToolsVersion = "35.0.0"
    ndkVersion = spinonNdkVersion

    defaultConfig {
        applicationId = "dev.spinon.bootstrap"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-bootstrap"
    }

    sourceSets["main"].apply {
        assets.srcDir(repoRoot.resolve("build/spinon/bootstrap"))
        jniLibs.srcDir(repoRoot.resolve("build/spinon/android/jniLibs"))
    }
}
