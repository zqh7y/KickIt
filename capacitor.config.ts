import type { CapacitorConfig } from '@capacitor/cli';
import { skies } from './src/theme.ts';

const config: CapacitorConfig = {
  // Change this to your own reverse-domain id before the first Play upload: it can never change after.
  appId: 'com.zzqxck.kickit',
  appName: 'KickIt!',
  webDir: 'dist',
  backgroundColor: skies[0],
  android: {
    backgroundColor: skies[0],
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: skies[0],
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    SystemBars: {
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
      style: 'LIGHT',
      hidden: true,
    },
  },
};

export default config;
