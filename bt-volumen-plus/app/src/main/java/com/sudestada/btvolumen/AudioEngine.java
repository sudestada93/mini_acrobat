package com.sudestada.btvolumen;

import android.media.audiofx.DynamicsProcessing;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;
import android.util.Log;

/**
 * Cadena de efectos (ganancia + ecualizador + limitador) sobre una sesión de audio.
 * La sesión 0 es la mezcla global del sistema; otras sesiones son reproductores concretos.
 */
abstract class AudioEngine {

    private static final String TAG = "BtVolumen";
    /** Prioridad máxima para que otros ecualizadores (p. ej. el de MIUI) no nos quiten el control. */
    private static final int PRIORITY = Integer.MAX_VALUE;

    abstract void apply(DeviceProfile p);

    abstract void release();

    abstract String describe();

    /** Crea la mejor cadena disponible: DynamicsProcessing y, si falla, LoudnessEnhancer + Equalizer. */
    static AudioEngine create(int session) {
        try {
            return new Dynamics(session);
        } catch (Throwable t) {
            Log.w(TAG, "DynamicsProcessing no disponible en sesión " + session, t);
        }
        Legacy legacy = new Legacy(session);
        if (legacy.isUsable()) return legacy;
        legacy.release();
        return null;
    }

    /**
     * Límite superior de cada banda: punto medio (logarítmico) entre centros vecinos,
     * así las 10 bandas se comportan como un ecualizador gráfico normal.
     */
    static float cutoffFor(int band) {
        int[] f = DeviceProfile.BAND_FREQS;
        if (band == f.length - 1) return 20000f;
        return (float) Math.sqrt((double) f[band] * f[band + 1]);
    }

    /** Android 9+: ganancia de entrada, EQ de 10 bandas y limitador en un solo efecto. */
    static final class Dynamics extends AudioEngine {
        private final DynamicsProcessing dp;
        private final int session;

        Dynamics(int session) {
            this.session = session;
            int bands = DeviceProfile.BAND_FREQS.length;
            DynamicsProcessing.Config config = new DynamicsProcessing.Config.Builder(
                    DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
                    2,
                    true, bands,
                    false, 0,
                    false, 0,
                    true)
                    .setPreferredFrameDuration(10f)
                    .build();
            dp = new DynamicsProcessing(PRIORITY, session, config);
        }

        @Override
        void apply(DeviceProfile p) {
            int bands = DeviceProfile.BAND_FREQS.length;
            DynamicsProcessing.Eq eq = new DynamicsProcessing.Eq(true, true, bands);
            for (int i = 0; i < bands; i++) {
                DynamicsProcessing.EqBand band = eq.getBand(i);
                band.setEnabled(true);
                band.setCutoffFrequency(cutoffFor(i));
                band.setGain(p.eq[i]);
            }
            dp.setPreEqAllChannelsTo(eq);

            // Ataque 1 ms, liberación 60 ms, relación 10:1, umbral -1 dB: evita la distorsión al subir la ganancia.
            DynamicsProcessing.Limiter limiter =
                    new DynamicsProcessing.Limiter(true, p.limiter, 0, 1f, 60f, 10f, -1f, 0f);
            dp.setLimiterAllChannelsTo(limiter);

            dp.setInputGainAllChannelsTo(p.boostDb);
            dp.setEnabled(true);
        }

        @Override
        void release() {
            try {
                dp.setEnabled(false);
            } catch (Throwable ignored) {
            }
            dp.release();
        }

        @Override
        String describe() {
            return "DynamicsProcessing (sesión " + (session == 0 ? "global" : session) + ")";
        }
    }

    /** Alternativa para equipos donde DynamicsProcessing no se puede crear. */
    static final class Legacy extends AudioEngine {
        private LoudnessEnhancer loudness;
        private Equalizer equalizer;
        private final int session;

        Legacy(int session) {
            this.session = session;
            try {
                loudness = new LoudnessEnhancer(session);
            } catch (Throwable t) {
                Log.w(TAG, "LoudnessEnhancer no disponible", t);
            }
            try {
                equalizer = new Equalizer(PRIORITY, session);
            } catch (Throwable t) {
                Log.w(TAG, "Equalizer no disponible", t);
            }
        }

        boolean isUsable() {
            return loudness != null || equalizer != null;
        }

        @Override
        void apply(DeviceProfile p) {
            if (loudness != null) {
                loudness.setTargetGain(Math.round(p.boostDb * 100f));
                loudness.setEnabled(p.boostDb > 0f);
            }
            if (equalizer != null) {
                short[] range = equalizer.getBandLevelRange();
                short n = equalizer.getNumberOfBands();
                for (short b = 0; b < n; b++) {
                    float hz = equalizer.getCenterFreq(b) / 1000f;
                    int level = Math.round(p.gainAt(hz) * 100f);
                    level = Math.max(range[0], Math.min(range[1], level));
                    equalizer.setBandLevel(b, (short) level);
                }
                equalizer.setEnabled(true);
            }
        }

        @Override
        void release() {
            if (loudness != null) loudness.release();
            if (equalizer != null) equalizer.release();
        }

        @Override
        String describe() {
            String parts = (loudness != null ? "LoudnessEnhancer" : "")
                    + (loudness != null && equalizer != null ? " + " : "")
                    + (equalizer != null ? "Equalizer" : "");
            return parts + " (sesión " + (session == 0 ? "global" : session) + ")";
        }
    }
}
