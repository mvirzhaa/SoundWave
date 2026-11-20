// Pintu masuk aplikasi: Expo Router + penangan widget layar utama Android.
import { Platform } from 'react-native';
import 'expo-router/entry';

if (Platform.OS === 'android') {
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./src/widget/handler');
  registerWidgetTaskHandler(widgetTaskHandler);
}
