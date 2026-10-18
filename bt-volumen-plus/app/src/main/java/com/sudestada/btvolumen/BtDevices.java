package com.sudestada.btvolumen;

import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.text.TextUtils;

/** Identifica la salida de audio Bluetooth conectada (audífonos, bocinas, LE Audio...). */
final class BtDevices {

    /** Salidas por orden de preferencia; SCO (llamadas) sólo si no hay otra. */
    private static int[] preferredTypes() {
        if (Build.VERSION.SDK_INT >= 33) {
            return new int[]{
                    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                    AudioDeviceInfo.TYPE_BLE_HEADSET,
                    AudioDeviceInfo.TYPE_BLE_SPEAKER,
                    AudioDeviceInfo.TYPE_BLE_BROADCAST,
                    AudioDeviceInfo.TYPE_HEARING_AID,
                    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            };
        }
        if (Build.VERSION.SDK_INT >= 31) {
            return new int[]{
                    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                    AudioDeviceInfo.TYPE_BLE_HEADSET,
                    AudioDeviceInfo.TYPE_BLE_SPEAKER,
                    AudioDeviceInfo.TYPE_HEARING_AID,
                    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            };
        }
        return new int[]{
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_HEARING_AID,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        };
    }

    static AudioDeviceInfo findBluetoothOutput(AudioManager am) {
        AudioDeviceInfo[] outputs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        for (int type : preferredTypes()) {
            for (AudioDeviceInfo d : outputs) {
                if (d.getType() == type) return d;
            }
        }
        return null;
    }

    static String nameOf(AudioDeviceInfo d) {
        CharSequence n = d.getProductName();
        return TextUtils.isEmpty(n) ? "Dispositivo Bluetooth" : n.toString().trim();
    }

    /** Clave estable para guardar el perfil de cada dispositivo. */
    static String keyOf(AudioDeviceInfo d) {
        String address = d.getAddress();
        String base = nameOf(d);
        return TextUtils.isEmpty(address) ? "bt:" + base : "bt:" + base + "|" + address;
    }

    static String typeLabel(AudioDeviceInfo d) {
        int t = d.getType();
        if (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) return "Audio Bluetooth (A2DP: música, video)";
        if (t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return "Bluetooth sólo llamadas (SCO)";
        if (t == AudioDeviceInfo.TYPE_HEARING_AID) return "Audífono médico Bluetooth";
        if (Build.VERSION.SDK_INT >= 31) {
            if (t == AudioDeviceInfo.TYPE_BLE_HEADSET) return "Bluetooth LE Audio (audífonos)";
            if (t == AudioDeviceInfo.TYPE_BLE_SPEAKER) return "Bluetooth LE Audio (bocina)";
        }
        if (Build.VERSION.SDK_INT >= 33 && t == AudioDeviceInfo.TYPE_BLE_BROADCAST) {
            return "Bluetooth LE Audio (transmisión)";
        }
        return "Bluetooth";
    }

    private BtDevices() {
    }
}
