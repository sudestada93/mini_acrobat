# Volumen BT+

App para Android que corrige el volumen bajo de audífonos y bocinas **Bluetooth** en teléfonos Xiaomi / Redmi / POCO (pensada para el POCO M6 Pro con HyperOS / Android 13–14).

APK lista para instalar: [`apk/VolumenBT.apk`](apk/VolumenBT.apk)

## Qué hace

- **Reconoce el dispositivo** que se conecta (nombre y tipo: A2DP, LE Audio, sólo llamadas…) y guarda **un perfil por cada audífono o bocina**. Los dispositivos nuevos copian el perfil «Predeterminado».
- **Amplificación** de hasta +20 dB por encima del volumen máximo del teléfono, con **limitador** para que no distorsione.
- **Ecualizador de 10 bandas** (31 Hz – 16 kHz, ±12 dB) con preajustes: Plano, Más volumen, Graves, Voces/podcast y Agudos claros.
- **Sube el volumen multimedia al conectar** (al porcentaje que elijas). HyperOS suele bajar el volumen Bluetooth al reconectar; la app lo vuelve a subir a los 1,5 s, 4 s y 8 s. Nunca lo baja.
- Sólo actúa mientras hay un dispositivo Bluetooth conectado: la bocina del teléfono no se toca.
- **Guía específica de Xiaomi** con accesos directos a los ajustes que una app no puede cambiar sola (volumen absoluto, códec, Dolby / efectos de sonido, batería e inicio automático).

## Instalación

1. Descarga `apk/VolumenBT.apk` en el teléfono.
2. Ábrela y permite «Instalar apps desconocidas» para el navegador o el gestor de archivos.
3. Abre **Volumen BT+**, acepta las notificaciones y conecta tus audífonos.
4. Sigue la sección «Soluciones para Xiaomi / POCO» de la app, empezando por **Desactivar volumen absoluto**, que es lo que más ayuda.
5. En «Batería sin restricciones» e «Inicio automático» da permiso para que HyperOS no cierre la app.

## Modos de procesamiento

- **Global** (por defecto): aplica el efecto a la mezcla de todo el sistema (sesión 0). Funciona con cualquier app en la mayoría de los equipos.
- **Por aplicación**: se engancha a las sesiones de audio que anuncian los reproductores (Spotify, YouTube Music, VLC, Poweramp…). Úsalo si en modo Global no notas cambios al mover la amplificación.

## Limitaciones honestas

- La app **no puede** activar por sí misma «Desactivar volumen absoluto», cambiar el códec ni quitar el aviso de volumen alto: son ajustes protegidos del sistema. Por eso incluye la guía y los botones que te llevan directo a cada pantalla.
- El audio de llamadas (perfil SCO) no se puede amplificar desde una app.
- Algunas apps (por ejemplo, ciertos juegos) pueden saltarse los efectos globales.

## Compilar

### Sin Android Studio (como se generó la APK incluida)

```bash
sudo apt install openjdk-17-jdk aapt dalvik-exchange zipalign apksigner
curl -L -o android.jar https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar
ANDROID_JAR=$PWD/android.jar ./build_apk.sh      # genera build/VolumenBT.apk
```

### Con Android Studio

Abre la carpeta `bt-volumen-plus/` como proyecto y ejecuta `assembleDebug`. (Los archivos de Gradle siguen la estructura estándar, pero la APK incluida se generó con `build_apk.sh`.)

Las dos opciones firman con `keystore/volumen-bt.jks` (contraseña `volumenbt`), así una versión nueva se instala encima de la anterior sin perder tus perfiles. Es una llave sólo para uso personal: no la uses para publicar en tiendas.

## Estructura

| Archivo | Función |
|---|---|
| `BoostService.java` | Servicio en primer plano: detecta conexión/desconexión, sube el volumen y aplica los efectos. |
| `AudioEngine.java` | Cadena de efectos: `DynamicsProcessing` (ganancia + EQ + limitador) o, si no está disponible, `LoudnessEnhancer` + `Equalizer`. |
| `BtDevices.java` | Identifica la salida Bluetooth activa y su tipo. |
| `ProfileStore.java` / `DeviceProfile.java` | Perfiles guardados por dispositivo. |
| `MainActivity.java` | Pantalla principal y guía. |
