#!/usr/bin/env bash
set -euo pipefail

spike_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$spike_dir/../.." && pwd)"
v8_dir="${V8_ANDROID_CHECKOUT:-$repo_dir/build/v8-source/v8}"
v8_out="${V8_ANDROID_OUT:-out/boson-android-mac}"
v8_archive="$v8_dir/$v8_out/obj/libv8_monolith.a"
v8_libcxx="$v8_dir/$v8_out/obj/buildtools/third_party/libc++/libc++.a"
v8_libcxxabi="$v8_dir/$v8_out/obj/buildtools/third_party/libc++abi/libc++abi.a"
output_dir="$repo_dir/build/dynamic-tree/android"
ndk_dir="${ANDROID_NDK_HOME:-$(find "$HOME/Library/Android/sdk/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)}"
ndk_root="$ndk_dir/toolchains/llvm/prebuilt/darwin-x86_64"
android_cxx="$ndk_root/bin/aarch64-linux-android29-clang++"
v8_cxx="$v8_dir/third_party/llvm-build/Release+Asserts/bin/clang++"
v8_lld="$v8_dir/third_party/llvm-build/Release+Asserts/bin/ld.lld"
sdk_dir="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
build_tools="$sdk_dir/build-tools/$(ls "$sdk_dir/build-tools" | sort -V | tail -1)"
android_jar="$sdk_dir/platforms/android-36/android.jar"
java_home="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export JAVA_HOME="$java_home"
export PATH="$java_home/bin:$PATH"

for required in "$v8_archive" "$v8_libcxx" "$v8_libcxxabi" "$android_jar" "$java_home/bin/javac"; do
  if [[ ! -f "$required" ]]; then echo "Android 빌드 입력이 없습니다: $required" >&2; exit 1; fi
done

mkdir -p "$output_dir/classes" "$output_dir/dex" "$output_dir/stage/assets" \
  "$output_dir/stage/lib/arm64-v8a"
"$v8_cxx" --target=aarch64-linux-android29 "--sysroot=$ndk_root/sysroot" \
  -std=c++20 -O2 -fPIC -fexperimental-relative-c++-abi-vtables \
  -nostdinc++ -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE \
  -I"$v8_dir/buildtools/third_party/libc++" \
  -isystem "$v8_dir/third_party/libc++/src/include" \
  -isystem "$v8_dir/third_party/libc++abi/src/include" \
  -I"$v8_dir/include" -I"$spike_dir/runtime" \
  -c "$spike_dir/runtime/v8_tree.cc" -o "$output_dir/runtime.o"
"$v8_cxx" --target=aarch64-linux-android29 "--sysroot=$ndk_root/sysroot" \
  -std=c++20 -O2 -fPIC -fexperimental-relative-c++-abi-vtables \
  -nostdinc++ -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE \
  -I"$v8_dir/buildtools/third_party/libc++" \
  -isystem "$v8_dir/third_party/libc++/src/include" \
  -isystem "$v8_dir/third_party/libc++abi/src/include" \
  -I"$v8_dir/include" -I"$spike_dir/runtime" \
  -c "$spike_dir/android/jni.cc" -o "$output_dir/jni.o"

rustc --edition=2024 --crate-type staticlib --target aarch64-linux-android \
  -O -C debuginfo=0 -C panic=abort "$spike_dir/rust/tree.rs" \
  -o "$output_dir/libboson_tree_core.a"

"$android_cxx" -shared "$output_dir/runtime.o" "$output_dir/jni.o" \
  "$output_dir/libboson_tree_core.a" \
  "$v8_archive" "$v8_libcxx" "$v8_libcxxabi" \
  "-fuse-ld=$v8_lld" -Wl,--gc-sections -nostdlib++ -llog -ldl \
  -o "$output_dir/stage/lib/arm64-v8a/libboson_tree.so"

"$java_home/bin/javac" -source 8 -target 8 -cp "$android_jar" \
  -d "$output_dir/classes" "$spike_dir/android/src/dev/boson/tree/TreeActivity.java"
"$build_tools/d8" --min-api 29 --lib "$android_jar" --output "$output_dir/dex" \
  "$output_dir/classes/dev/boson/tree/TreeActivity.class"
cp "$spike_dir/tree.js" "$output_dir/stage/assets/tree.js"
cp "$spike_dir/scenarios/stress.js" "$output_dir/stage/assets/stress.js"
cp "$spike_dir/scenarios/long_text.js" "$output_dir/stage/assets/long_text.js"
cp "$spike_dir/scenarios/error.js" "$output_dir/stage/assets/error.js"
cp "$output_dir/dex/classes.dex" "$output_dir/stage/classes.dex"

keystore="$output_dir/debug.keystore"
if [[ ! -f "$keystore" ]]; then
  "$java_home/bin/keytool" -genkeypair -noprompt -keystore "$keystore" \
    -storepass android -keypass android -alias androiddebugkey \
    -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 \
    -validity 10000 >/dev/null
fi

unsigned="$output_dir/unsigned.apk"
aligned="$output_dir/aligned.apk"
final="$output_dir/boson-dynamic-tree.apk"
"$build_tools/aapt2" link -o "$unsigned" -I "$android_jar" \
  --manifest "$spike_dir/android/AndroidManifest.xml" \
  --min-sdk-version 29 --target-sdk-version 36
(cd "$output_dir/stage" && zip -q -u "$unsigned" classes.dex assets/tree.js \
  assets/stress.js assets/long_text.js assets/error.js lib/arm64-v8a/libboson_tree.so)
"$build_tools/zipalign" -f 4 "$unsigned" "$aligned"
"$build_tools/apksigner" sign --ks "$keystore" --ks-pass pass:android \
  --key-pass pass:android --out "$final" "$aligned"
echo "$final"
