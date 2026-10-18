package com.sudestada.btvolumen;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Guarda la configuración general y un perfil por cada dispositivo Bluetooth detectado. */
final class ProfileStore {

    static final String DEFAULT_KEY = "default";
    static final String MODE_GLOBAL = "global";
    static final String MODE_SESSION = "session";

    private static final String PREFS = "bt_volumen";
    private static final String KEY_MASTER = "master_enabled";
    private static final String KEY_MODE = "mode";
    private static final String KEY_DEVICES = "devices";
    private static final String PROFILE_PREFIX = "profile:";

    private final SharedPreferences prefs;

    ProfileStore(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    boolean isMasterEnabled() {
        return prefs.getBoolean(KEY_MASTER, true);
    }

    void setMasterEnabled(boolean enabled) {
        prefs.edit().putBoolean(KEY_MASTER, enabled).apply();
    }

    String getMode() {
        return prefs.getString(KEY_MODE, MODE_GLOBAL);
    }

    void setMode(String mode) {
        prefs.edit().putString(KEY_MODE, mode).apply();
    }

    DeviceProfile getDefault() {
        return DeviceProfile.fromJson("Predeterminado", prefs.getString(PROFILE_PREFIX + DEFAULT_KEY, null));
    }

    /** Devuelve el perfil del dispositivo; si es nuevo, lo crea copiando el perfil predeterminado. */
    DeviceProfile getOrCreate(String key, String name) {
        String json = prefs.getString(PROFILE_PREFIX + key, null);
        if (json != null) return DeviceProfile.fromJson(name, json);
        DeviceProfile p = getDefault().copyAs(name);
        save(key, p);
        return p;
    }

    DeviceProfile get(String key) {
        if (DEFAULT_KEY.equals(key)) return getDefault();
        return DeviceProfile.fromJson(key, prefs.getString(PROFILE_PREFIX + key, null));
    }

    void save(String key, DeviceProfile p) {
        SharedPreferences.Editor e = prefs.edit().putString(PROFILE_PREFIX + key, p.toJson());
        if (!DEFAULT_KEY.equals(key)) {
            Set<String> keys = new HashSet<>(prefs.getStringSet(KEY_DEVICES, Collections.<String>emptySet()));
            keys.add(key);
            e.putStringSet(KEY_DEVICES, keys);
        }
        e.apply();
    }

    void delete(String key) {
        Set<String> keys = new HashSet<>(prefs.getStringSet(KEY_DEVICES, Collections.<String>emptySet()));
        keys.remove(key);
        prefs.edit().remove(PROFILE_PREFIX + key).putStringSet(KEY_DEVICES, keys).apply();
    }

    List<String> deviceKeys() {
        List<String> keys = new ArrayList<>(prefs.getStringSet(KEY_DEVICES, Collections.<String>emptySet()));
        Collections.sort(keys);
        return keys;
    }
}
