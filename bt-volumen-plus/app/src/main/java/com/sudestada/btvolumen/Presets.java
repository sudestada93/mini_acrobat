package com.sudestada.btvolumen;

/** Curvas de ecualizador predefinidas (10 bandas, dB). */
final class Presets {

    static final String[] NAMES = {"Plano", "Más volumen", "Graves", "Voces / podcast", "Agudos claros"};

    private static final float[][] CURVES = {
            {0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
            // Realza la zona donde el oído es más sensible: suena más fuerte sin saturar graves.
            {2, 2, 1, 0, 1, 3, 4, 4, 3, 2},
            {6, 5, 4, 2, 0, 0, 0, 0, 1, 1},
            {-3, -2, -1, 1, 3, 4, 4, 3, 1, 0},
            {0, 0, 0, 0, 0, 1, 2, 4, 5, 5},
    };

    static void apply(int index, DeviceProfile p) {
        System.arraycopy(CURVES[index], 0, p.eq, 0, p.eq.length);
    }

    private Presets() {
    }
}
