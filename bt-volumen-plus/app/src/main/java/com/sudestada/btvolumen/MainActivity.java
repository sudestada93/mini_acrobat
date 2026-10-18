package com.sudestada.btvolumen;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.LinearLayout;
import android.widget.RadioGroup;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {

    private static final int EQ_STEPS_PER_DB = 2;
    private static final long SAVE_DELAY_MS = 120;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<String> profileKeys = new ArrayList<>();
    private final SeekBar[] eqBars = new SeekBar[DeviceProfile.BAND_FREQS.length];
    private final TextView[] eqLabels = new TextView[DeviceProfile.BAND_FREQS.length];

    private ProfileStore store;
    private DeviceProfile profile;
    private String profileKey = ProfileStore.DEFAULT_KEY;
    private String shownDeviceKey;
    /** Evita guardar mientras se cargan valores en los controles. */
    private boolean loading;
    private boolean savePending;

    private TextView txtDevice, txtDeviceType, txtEngine, txtBoost, txtAutoVolume;
    private Switch switchMaster, switchProfile;
    private Spinner spinnerProfile;
    private SeekBar seekBoost, seekAutoVolume;
    private CheckBox checkLimiter, checkAutoVolume;
    private RadioGroup radioMode;

    private final Runnable saveRunnable = new Runnable() {
        @Override
        public void run() {
            savePending = false;
            store.save(profileKey, profile);
            refreshService();
        }
    };

    private final BoostService.Listener statusListener = new BoostService.Listener() {
        @Override
        public void onStatusChanged() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    showStatus();
                }
            });
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        store = new ProfileStore(this);

        txtDevice = findViewById(R.id.txtDevice);
        txtDeviceType = findViewById(R.id.txtDeviceType);
        txtEngine = findViewById(R.id.txtEngine);
        txtBoost = findViewById(R.id.txtBoost);
        txtAutoVolume = findViewById(R.id.txtAutoVolume);
        switchMaster = findViewById(R.id.switchMaster);
        switchProfile = findViewById(R.id.switchProfile);
        spinnerProfile = findViewById(R.id.spinnerProfile);
        seekBoost = findViewById(R.id.seekBoost);
        seekAutoVolume = findViewById(R.id.seekAutoVolume);
        checkLimiter = findViewById(R.id.checkLimiter);
        checkAutoVolume = findViewById(R.id.checkAutoVolume);
        radioMode = findViewById(R.id.radioMode);

        buildPresets();
        buildEqualizer();
        bindControls();
        bindGuideButtons();
        requestNotificationPermission();
    }

    @Override
    protected void onResume() {
        super.onResume();
        BoostService.setListener(statusListener);
        loading = true;
        switchMaster.setChecked(store.isMasterEnabled());
        radioMode.check(ProfileStore.MODE_SESSION.equals(store.getMode()) ? R.id.radioSession : R.id.radioGlobal);
        loading = false;
        shownDeviceKey = BoostService.getDeviceKey();
        reloadProfiles(shownDeviceKey != null ? shownDeviceKey : profileKey);
        showStatus();
        if (store.isMasterEnabled()) refreshService();
    }

    @Override
    protected void onPause() {
        BoostService.setListener(null);
        flushPendingSave();
        super.onPause();
    }

    // ---------------------------------------------------------------- estado

    private void showStatus() {
        String name = BoostService.getDeviceName();
        if (name == null) {
            txtDevice.setText(R.string.no_device);
            txtDeviceType.setText("Conecta tus audífonos o bocina; la app los reconoce sola.");
        } else {
            txtDevice.setText(name);
            txtDeviceType.setText(BoostService.getDeviceType());
        }
        txtEngine.setText(BoostService.getEngineStatus());

        // Si se conecta otro dispositivo con la app abierta, mostrar su perfil.
        String key = BoostService.getDeviceKey();
        if (key != null && !key.equals(shownDeviceKey)) {
            shownDeviceKey = key;
            reloadProfiles(key);
        } else if (key == null) {
            shownDeviceKey = null;
        }
    }

    private void refreshService() {
        if (!store.isMasterEnabled()) return;
        try {
            BoostService.start(this, BoostService.ACTION_REFRESH);
        } catch (RuntimeException e) {
            Toast.makeText(this, "No se pudo iniciar el servicio: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    // --------------------------------------------------------------- perfiles

    private void reloadProfiles(String selectKey) {
        String connected = BoostService.getDeviceKey();
        if (connected != null) store.getOrCreate(connected, BoostService.getDeviceName());

        profileKeys.clear();
        List<String> labels = new ArrayList<>();
        profileKeys.add(ProfileStore.DEFAULT_KEY);
        labels.add("Predeterminado (dispositivos nuevos)");
        for (String key : store.deviceKeys()) {
            profileKeys.add(key);
            String label = store.get(key).name;
            labels.add(key.equals(connected) ? label + "  • conectado" : label);
        }
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);

        int index = Math.max(0, profileKeys.indexOf(selectKey));
        loading = true;
        spinnerProfile.setAdapter(adapter);
        spinnerProfile.setSelection(index, false);
        loading = false;
        loadProfile(profileKeys.get(index));
    }

    private void loadProfile(String key) {
        profileKey = key;
        profile = store.get(key);
        loading = true;
        switchProfile.setChecked(profile.enabled);
        seekBoost.setProgress(Math.round(profile.boostDb * 2));
        checkLimiter.setChecked(profile.limiter);
        checkAutoVolume.setChecked(profile.autoVolume);
        seekAutoVolume.setProgress(profile.autoVolumePercent - 10);
        for (int i = 0; i < eqBars.length; i++) {
            eqBars[i].setProgress(Math.round((profile.eq[i] + DeviceProfile.EQ_RANGE_DB) * EQ_STEPS_PER_DB));
        }
        loading = false;
        updateLabels();
        findViewById(R.id.btnDeleteProfile).setEnabled(!ProfileStore.DEFAULT_KEY.equals(key));
    }

    private void updateLabels() {
        txtBoost.setText(String.format(Locale.US, "Amplificación: +%.1f dB", profile.boostDb));
        txtAutoVolume.setText(String.format(Locale.US, "Volumen al conectar: %d %%", profile.autoVolumePercent));
        seekAutoVolume.setEnabled(profile.autoVolume);
        for (int i = 0; i < eqLabels.length; i++) {
            eqLabels[i].setText(String.format(Locale.US, "%s  %+.1f dB",
                    freqLabel(DeviceProfile.BAND_FREQS[i]), profile.eq[i]));
        }
    }

    private void profileChanged() {
        if (loading) return;
        updateLabels();
        handler.removeCallbacks(saveRunnable);
        handler.postDelayed(saveRunnable, SAVE_DELAY_MS);
        savePending = true;
    }

    private void flushPendingSave() {
        if (!savePending) return;
        handler.removeCallbacks(saveRunnable);
        saveRunnable.run();
    }

    // -------------------------------------------------------------- controles

    private void bindControls() {
        switchMaster.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton b, boolean checked) {
                if (loading) return;
                store.setMasterEnabled(checked);
                if (checked) refreshService();
                else BoostService.stop(MainActivity.this);
            }
        });

        spinnerProfile.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (loading || position >= profileKeys.size()) return;
                flushPendingSave();
                loadProfile(profileKeys.get(position));
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });

        findViewById(R.id.btnDeleteProfile).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (ProfileStore.DEFAULT_KEY.equals(profileKey)) return;
                handler.removeCallbacks(saveRunnable);
                savePending = false;
                store.delete(profileKey);
                Toast.makeText(MainActivity.this, "Perfil borrado", Toast.LENGTH_SHORT).show();
                // Si es el dispositivo conectado, se vuelve a crear desde el predeterminado.
                reloadProfiles(BoostService.getDeviceKey() != null ? BoostService.getDeviceKey() : ProfileStore.DEFAULT_KEY);
                refreshService();
            }
        });

        switchProfile.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton b, boolean checked) {
                profile.enabled = checked;
                profileChanged();
            }
        });

        seekBoost.setOnSeekBarChangeListener(new SimpleSeek() {
            @Override
            public void onProgressChanged(SeekBar s, int progress, boolean fromUser) {
                profile.boostDb = progress / 2f;
                profileChanged();
            }
        });

        checkLimiter.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton b, boolean checked) {
                profile.limiter = checked;
                profileChanged();
            }
        });

        checkAutoVolume.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton b, boolean checked) {
                profile.autoVolume = checked;
                profileChanged();
            }
        });

        seekAutoVolume.setOnSeekBarChangeListener(new SimpleSeek() {
            @Override
            public void onProgressChanged(SeekBar s, int progress, boolean fromUser) {
                profile.autoVolumePercent = progress + 10;
                profileChanged();
            }
        });

        radioMode.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(RadioGroup group, int checkedId) {
                if (loading) return;
                store.setMode(checkedId == R.id.radioSession ? ProfileStore.MODE_SESSION : ProfileStore.MODE_GLOBAL);
                refreshService();
            }
        });
    }

    private void buildPresets() {
        LinearLayout container = findViewById(R.id.presetContainer);
        for (int i = 0; i < Presets.NAMES.length; i++) {
            final int index = i;
            Button b = new Button(this);
            b.setText(Presets.NAMES[i]);
            b.setAllCaps(false);
            b.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    Presets.apply(index, profile);
                    loadEqBars();
                    profileChanged();
                }
            });
            container.addView(b);
        }
    }

    private void loadEqBars() {
        loading = true;
        for (int i = 0; i < eqBars.length; i++) {
            eqBars[i].setProgress(Math.round((profile.eq[i] + DeviceProfile.EQ_RANGE_DB) * EQ_STEPS_PER_DB));
        }
        loading = false;
    }

    private void buildEqualizer() {
        LinearLayout container = findViewById(R.id.eqContainer);
        int barHeight = Math.round(40 * getResources().getDisplayMetrics().density);
        for (int i = 0; i < eqBars.length; i++) {
            final int band = i;
            TextView label = new TextView(this);
            label.setTextSize(13);
            label.setPadding(0, Math.round(6 * getResources().getDisplayMetrics().density), 0, 0);
            container.addView(label);

            SeekBar bar = new SeekBar(this);
            bar.setMax(Math.round(DeviceProfile.EQ_RANGE_DB * 2 * EQ_STEPS_PER_DB));
            bar.setOnSeekBarChangeListener(new SimpleSeek() {
                @Override
                public void onProgressChanged(SeekBar s, int progress, boolean fromUser) {
                    profile.eq[band] = progress / (float) EQ_STEPS_PER_DB - DeviceProfile.EQ_RANGE_DB;
                    profileChanged();
                }
            });
            container.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, barHeight));
            eqLabels[i] = label;
            eqBars[i] = bar;
        }
    }

    private static String freqLabel(int hz) {
        return hz >= 1000 ? (hz / 1000) + " kHz" : hz + " Hz";
    }

    // ------------------------------------------------------------------ guía

    private void bindGuideButtons() {
        findViewById(R.id.btnDevOptions).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                boolean devEnabled = Settings.Global.getInt(getContentResolver(),
                        Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1;
                if (devEnabled && open(new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))) return;
                Toast.makeText(MainActivity.this,
                        "Primero activa las opciones de desarrollador: toca 7 veces «Versión de HyperOS / MIUI».",
                        Toast.LENGTH_LONG).show();
                open(new Intent(Settings.ACTION_DEVICE_INFO_SETTINGS));
            }
        });
        findViewById(R.id.btnSound).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                open(new Intent(Settings.ACTION_SOUND_SETTINGS));
            }
        });
        findViewById(R.id.btnBluetooth).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                open(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS));
            }
        });
        findViewById(R.id.btnBattery).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                PowerManager pm = getSystemService(PowerManager.class);
                if (!pm.isIgnoringBatteryOptimizations(getPackageName())
                        && open(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + getPackageName())))) {
                    return;
                }
                Toast.makeText(MainActivity.this,
                        "En «Ahorro de batería» elige «Sin restricciones».", Toast.LENGTH_LONG).show();
                openAppDetails();
            }
        });
        findViewById(R.id.btnAutostart).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent miui = new Intent().setComponent(new ComponentName("com.miui.securitycenter",
                        "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                if (open(miui)) return;
                Toast.makeText(MainActivity.this,
                        "Busca «Inicio automático» y actívalo.", Toast.LENGTH_LONG).show();
                openAppDetails();
            }
        });
    }

    private void openAppDetails() {
        open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
    }

    private boolean open(Intent intent) {
        try {
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    /** SeekBar listener con los métodos que no usamos ya vacíos. */
    private abstract static class SimpleSeek implements SeekBar.OnSeekBarChangeListener {
        @Override
        public void onStartTrackingTouch(SeekBar seekBar) {
        }

        @Override
        public void onStopTrackingTouch(SeekBar seekBar) {
        }
    }
}
