package com.sudestada.btvolumen;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Vuelve a iniciar el servicio tras reiniciar el teléfono o actualizar la app. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (new ProfileStore(context).isMasterEnabled()) {
            try {
                BoostService.start(context, BoostService.ACTION_REFRESH);
            } catch (RuntimeException ignored) {
                // El sistema puede negar el arranque en segundo plano; se iniciará al abrir la app.
            }
        }
    }
}
