// Headless starts (an FCM wake with no UI) never render the router, so the
// wake task must be defined here, before expo-router's entry.
import '@/lib/polyfills';
import '@/lib/push/background';
import 'expo-router/entry';
