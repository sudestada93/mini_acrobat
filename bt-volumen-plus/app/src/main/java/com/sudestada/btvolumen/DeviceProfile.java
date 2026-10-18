package com.sudestada.btvolumen;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Ajustes de sonido guardados para un dispositivo Bluetooth concreto. */
final class DeviceProfile {

    /** Frecuencias centrales del ecualizador de 10 bandas (Hz). */
    static final int[] BAND_FREQS = {31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
    static final float MAX_BOOST_DB = 20f;
    static final float EQ_RANGE_DB = 12f;

    String name;
    boolean enabled = true;
    float boostDb = 6f;
    boolean limiter = true;
    boolean autoVolume = true;
    int autoVolumePercent = 90;
    float[] eq = new float[BAND_FREQS.length];

    DeviceProfile(String name) {
        this.name = name;
    }

    DeviceProfile copyAs(String newName) {
        DeviceProfile p = fromJson(newName, toJson());
        p.name = newName;
        return p;
    }

    /** Ganancia del ecualizador en una frecuencia arbitraria, interpolada en escala logarítmica. */
    float gainAt(float hz) {
        if (hz <= BAND_FREQS[0]) return eq[0];
        int last = BAND_FREQS.length - 1;
        if (hz >= BAND_FREQS[last]) return eq[last];
        for (int i = 0; i < last; i++) {
            if (hz <= BAND_FREQS[i + 1]) {
                double lo = Math.log(BAND_FREQS[i]);
                double hi = Math.log(BAND_FREQS[i + 1]);
                float t = (float) ((Math.log(hz) - lo) / (hi - lo));
                return eq[i] + (eq[i + 1] - eq[i]) * t;
            }
        }
        return 0f;
    }

    String toJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("name", name);
            o.put("enabled", enabled);
            o.put("boostDb", (double) boostDb);
            o.put("limiter", limiter);
            o.put("autoVolume", autoVolume);
            o.put("autoVolumePercent", autoVolumePercent);
            JSONArray a = new JSONArray();
            for (float g : eq) a.put((double) g);
            o.put("eq", a);
            return o.toString();
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    static DeviceProfile fromJson(String fallbackName, String json) {
        DeviceProfile p = new DeviceProfile(fallbackName);
        if (json == null) return p;
        try {
            JSONObject o = new JSONObject(json);
            p.name = o.optString("name", fallbackName);
            p.enabled = o.optBoolean("enabled", p.enabled);
            p.boostDb = clamp((float) o.optDouble("boostDb", p.boostDb), 0f, MAX_BOOST_DB);
            p.limiter = o.optBoolean("limiter", p.limiter);
            p.autoVolume = o.optBoolean("autoVolume", p.autoVolume);
            p.autoVolumePercent = (int) clamp(o.optInt("autoVolumePercent", p.autoVolumePercent), 10, 100);
            JSONArray a = o.optJSONArray("eq");
            if (a != null) {
                for (int i = 0; i < p.eq.length && i < a.length(); i++) {
                    p.eq[i] = clamp((float) a.optDouble(i, 0), -EQ_RANGE_DB, EQ_RANGE_DB);
                }
            }
        } catch (JSONException ignored) {
            // Perfil dañado: se usan los valores por defecto.
        }
        return p;
    }

    static float clamp(float v, float min, float max) {
        return Math.max(min, Math.min(max, v));
    }
}
