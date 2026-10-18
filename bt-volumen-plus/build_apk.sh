#!/usr/bin/env bash
# Compila la APK sin Android Studio ni Gradle, sólo con herramientas de línea de comandos.
#
# Requisitos (Ubuntu/Debian):  sudo apt install openjdk-17-jdk aapt dalvik-exchange zipalign apksigner
# y un android.jar de la API 34, por ejemplo:
#   curl -L -o android.jar https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar
#
# Uso:  ANDROID_JAR=/ruta/android.jar ./build_apk.sh
set -euo pipefail

cd "$(dirname "$0")"
ANDROID_JAR="${ANDROID_JAR:?Define ANDROID_JAR con la ruta a android.jar (API 34)}"
SRC=app/src/main
OUT=build
KEYSTORE=keystore/volumen-bt.jks
KS_PASS=volumenbt
PACKAGE=com.sudestada.btvolumen
VERSION_CODE=1
VERSION_NAME=1.0

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes"

echo "> Recursos (aapt)"
# El manifiesto fuente no lleva package (formato de Gradle); aapt sí lo necesita.
sed "s|<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">|<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"$PACKAGE\" android:versionCode=\"$VERSION_CODE\" android:versionName=\"$VERSION_NAME\">|" \
    "$SRC/AndroidManifest.xml" > "$OUT/AndroidManifest.xml"
grep -q "package=\"$PACKAGE\"" "$OUT/AndroidManifest.xml"
aapt package -f -m \
    --min-sdk-version 28 --target-sdk-version 34 \
    -M "$OUT/AndroidManifest.xml" -S "$SRC/res" -I "$ANDROID_JAR" \
    -J "$OUT/gen" -F "$OUT/unsigned.apk"

echo "> Java (javac)"
find "$SRC/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -nowarn -Xlint:-options -encoding UTF-8 -source 8 -target 8 \
    -bootclasspath "$ANDROID_JAR" -d "$OUT/classes" @"$OUT/sources.txt"

echo "> Dex (dx)"
DX=$(command -v dalvik-exchange || command -v dx)
"$DX" --dex --min-sdk-version=28 --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && aapt add -f unsigned.apk classes.dex > /dev/null)

echo "> Alinear y firmar"
if [ ! -f "$KEYSTORE" ]; then
    mkdir -p keystore
    keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
        -alias volumenbt -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Volumen BT, O=sudestada93, C=MX"
fi
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
apksigner sign --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias volumenbt \
    --out "$OUT/VolumenBT.apk" "$OUT/aligned.apk"
apksigner verify "$OUT/VolumenBT.apk"

echo "Listo: $OUT/VolumenBT.apk"
