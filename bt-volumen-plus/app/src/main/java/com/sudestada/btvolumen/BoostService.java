package com.sudestada.btvolumen;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.audiofx.AudioEffect;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * Servicio en primer plano: detecta cuándo se conecta un dispositivo Bluetooth de audio,
 * carga su perfil, sube el volumen multimedia y aplica ganancia + ecualizador.
 */
public class BoostService extends Service {

    static final String ACTION_REFRESH = "com.sudestada.btvolumen.REFRESH";
    static final String ACTION_STOP = "com.sudestada.btvolumen.STOP";

    private static final String CHANNEL_ID = "boost";
    private static final int NOTIFICATION_ID = 1;
    private static final int GLOBAL_SESSION = 0;
    /** MIUI/HyperOS a veces restablece el volumen Bluetooth unos segundos después de conectar. */
    private static final long[] VOLUME_DELAYS_MS = {1500, 4000, 8000};

    /** Estado visible para la pantalla principal. */
    interface Listener {
        void onStatusChanged();
    }

    private static volatile String deviceName;
    private static volatile String deviceType;
    private static volatile String deviceKey;
    private static volatile String engineStatus = "Servicio detenido";
    private static Listener listener;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<Integer, AudioEngine> engines = new HashMap<>();
    private final Set<Integer> appSessions = new LinkedHashSet<>();
    private AudioManager audioManager;
    private ProfileStore store;
    private String notificationText = "Esperando un dispositivo Bluetooth…";

    static void start(Context context, String action) {
        Intent i = new Intent(context, BoostService.class).setAction(action);
        context.startForegroundService(i);
    }

    static void stop(Context context) {
        context.startService(new Intent(context, BoostService.class).setAction(ACTION_STOP));
    }

    static String getDeviceName() {
        return deviceName;
    }

    static String getDeviceType() {
        return deviceType;
    }

    static String getDeviceKey() {
        return deviceKey;
    }

    static String getEngineStatus() {
        return engineStatus;
    }

    static void setListener(Listener l) {
        listener = l;
    }

    private final AudioDeviceCallback deviceCallback = new AudioDeviceCallback() {
        @Override
        public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
            checkDevice();
        }

        @Override
        public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            checkDevice();
        }
    };

    /** Reproductores (Spotify, YouTube Music, VLC...) anuncian sus sesiones de audio con esta difusión. */
    private final BroadcastReceiver sessionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int session = intent.getIntExtra(AudioEffect.EXTRA_AUDIO_SESSION, AudioEffect.ERROR);
            if (session <= 0) return;
            if (AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION.equals(intent.getAction())) {
                appSessions.add(session);
            } else {
                appSessions.remove(session);
                releaseEngine(session);
            }
            applyEffects();
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        store = new ProfileStore(this);
        createChannel();
        goForeground("Esperando un dispositivo Bluetooth…");

        IntentFilter filter = new IntentFilter();
        filter.addAction(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION);
        filter.addAction(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(sessionReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(sessionReceiver, filter);
        }
        audioManager.registerAudioDeviceCallback(deviceCallback, handler);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) store.setMasterEnabled(false);
        if (!store.isMasterEnabled()) {
            // startForegroundService exige llamar a startForeground antes de detenerse.
            goForeground("Deteniendo…");
            stopSelf();
            return START_NOT_STICKY;
        }
        // Cada startForegroundService() debe ir seguido de startForeground().
        goForeground(notificationText);
        checkDevice();
        applyEffects();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        audioManager.unregisterAudioDeviceCallback(deviceCallback);
        unregisterReceiver(sessionReceiver);
        releaseAll();
        deviceName = null;
        deviceType = null;
        deviceKey = null;
        setEngineStatus("Servicio detenido");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void checkDevice() {
        AudioDeviceInfo bt = BtDevices.findBluetoothOutput(audioManager);
        String newKey = bt != null ? BtDevices.keyOf(bt) : null;
        if (newKey == null ? deviceKey == null : newKey.equals(deviceKey)) return;

        deviceKey = newKey;
        if (bt == null) {
            deviceName = null;
            deviceType = null;
            handler.removeCallbacksAndMessages(null);
            goForeground("Esperando un dispositivo Bluetooth…");
        } else {
            deviceName = BtDevices.nameOf(bt);
            deviceType = BtDevices.typeLabel(bt);
            DeviceProfile p = store.getOrCreate(deviceKey, deviceName);
            goForeground("Conectado: " + deviceName);
            if (p.enabled && p.autoVolume) scheduleVolumeRaise();
        }
        applyEffects();
    }

    /** Sube (nunca baja) el volumen multimedia al porcentaje elegido para el dispositivo. */
    private void scheduleVolumeRaise() {
        for (long delay : VOLUME_DELAYS_MS) {
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    raiseVolume();
                }
            }, delay);
        }
    }

    private void raiseVolume() {
        if (deviceKey == null || !store.isMasterEnabled()) return;
        DeviceProfile p = store.get(deviceKey);
        if (!p.enabled || !p.autoVolume) return;
        int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int target = Math.round(max * p.autoVolumePercent / 100f);
        int current = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        if (current < target) {
            try {
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, AudioManager.FLAG_SHOW_UI);
            } catch (SecurityException ignored) {
                // Modo "No molestar" u otra restricción del sistema.
            }
        }
    }

    /** Crea, actualiza o libera los efectos según el dispositivo conectado y la configuración. */
    private void applyEffects() {
        if (deviceKey == null || !store.isMasterEnabled()) {
            releaseAll();
            setEngineStatus(deviceKey == null
                    ? "En espera: se activa al conectar un dispositivo Bluetooth"
                    : "Mejora desactivada");
            return;
        }
        DeviceProfile p = store.get(deviceKey);
        if (!p.enabled) {
            releaseAll();
            setEngineStatus("Perfil desactivado para este dispositivo");
            return;
        }

        boolean global = ProfileStore.MODE_GLOBAL.equals(store.getMode());
        Set<Integer> wanted = new LinkedHashSet<>();
        if (global) {
            wanted.add(GLOBAL_SESSION);
        } else {
            wanted.addAll(appSessions);
        }
        for (Integer s : new LinkedHashSet<>(engines.keySet())) {
            if (!wanted.contains(s)) releaseEngine(s);
        }

        StringBuilder status = new StringBuilder();
        for (Integer s : wanted) {
            AudioEngine e = engines.get(s);
            if (e == null) {
                e = AudioEngine.create(s);
                if (e == null) continue;
                engines.put(s, e);
            }
            try {
                e.apply(p);
                if (status.length() > 0) status.append('\n');
                status.append("Activo: ").append(e.describe());
            } catch (Throwable t) {
                releaseEngine(s);
                if (status.length() > 0) status.append('\n');
                status.append("Error en sesión ").append(s).append(": ").append(t.getMessage());
            }
        }
        if (status.length() == 0) {
            status.append(global
                    ? "No se pudo crear el efecto global. Prueba el modo «Por aplicación»."
                    : "Modo por aplicación: abre música en una app compatible (Spotify, YouTube Music, VLC…).");
        }
        setEngineStatus(status.toString());
    }

    private void releaseEngine(int session) {
        AudioEngine e = engines.remove(session);
        if (e != null) e.release();
    }

    private void releaseAll() {
        for (AudioEngine e : engines.values()) e.release();
        engines.clear();
    }

    private static void setEngineStatus(String status) {
        engineStatus = status;
        Listener l = listener;
        if (l != null) l.onStatusChanged();
    }

    private void createChannel() {
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Mejora de volumen Bluetooth", NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    private void goForeground(String text) {
        notificationText = text;
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, BoostService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text)
                .setContentIntent(open)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(null, "Detener", stop).build())
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }
}
