package com.loukatech.mboteroom;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** FCM delivery for the native APK, independent of WebView/Web Push lifecycle. */
public final class MBoteRoomFirebaseService extends FirebaseMessagingService {
    public static final String CHANNEL_ID = "mboteroom_updates";
    private static final String PREFS = "mboteroom_fcm";
    private static final String TOKEN = "token";

    public static boolean isConfigured() {
        return !BuildConfig.FCM_PROJECT_ID.isEmpty()
                && !BuildConfig.FCM_SENDER_ID.isEmpty()
                && !BuildConfig.FCM_APP_ID.isEmpty()
                && !BuildConfig.FCM_API_KEY.isEmpty();
    }

    public static String getStoredToken(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(TOKEN, "");
    }

    public static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Alertes MBotéRoom", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Réunions, invitations et messages MBotéRoom");
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    public static void initialize(Activity activity) {
        createChannel(activity);
        if (!isConfigured()) return;
        try {
            if (FirebaseApp.getApps(activity).isEmpty()) {
                FirebaseOptions options = new FirebaseOptions.Builder()
                        .setProjectId(BuildConfig.FCM_PROJECT_ID)
                        .setApplicationId(BuildConfig.FCM_APP_ID)
                        .setGcmSenderId(BuildConfig.FCM_SENDER_ID)
                        .setApiKey(BuildConfig.FCM_API_KEY)
                        .build();
                FirebaseApp.initializeApp(activity, options);
            }
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token ->
                    activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                            .edit().putString(TOKEN, token).apply());
        } catch (RuntimeException ignored) {
            // Missing/incomplete config must not prevent the APK from starting.
        }
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(TOKEN, token).apply();
        // Account-bound registration happens only from an authenticated, opted-in WebView session.
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        // Android displays notification messages automatically when the APK is in background.
        // Only show a local alert when the SDK dispatches the message to this service.
        RemoteMessage.Notification remote = message.getNotification();
        if (remote == null) return;
        createChannel(this);
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String title = remote.getTitle() == null ? "MBotéRoom" : remote.getTitle();
        String body = remote.getBody() == null ? "" : remote.getBody();
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.mboteroom_logo)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(open)
                .setAutoCancel(true);
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify((int) (System.currentTimeMillis() & 0x7fffffff), builder.build());
    }
}
