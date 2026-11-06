// Native integration through Capacitor: haptics, fullscreen, the Android back
// button and the splash screen. Every call is safe on the web.
import { App } from '@capacitor/app';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { SplashScreen } from '@capacitor/splash-screen';

const native = Capacitor.isNativePlatform();
const vibrate = (p: number | number[]) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* not available */
  }
};
const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);

export const platform = {
  native,
  /** `onBack` returns false when the game has nothing to go back to (then the app closes). */
  init(onBack: () => boolean, onPause: () => void, onResume: () => void) {
    if (!native) return;
    const fullscreen = () => {
      quiet(SystemBars.setStyle({ style: SystemBarsStyle.Light }));
      quiet(SystemBars.hide());
    };
    fullscreen();
    // Android only plays selectionChanged() between selectionStart() and selectionEnd()
    quiet(Haptics.selectionStart());
    quiet(
      App.addListener('backButton', () => {
        if (!onBack()) quiet(App.exitApp());
      }),
    );
    quiet(App.addListener('pause', onPause));
    quiet(
      App.addListener('resume', () => {
        fullscreen();
    // Android only plays selectionChanged() between selectionStart() and selectionEnd()
    quiet(Haptics.selectionStart());
        onResume();
      }),
    );
  },
  hideSplash() {
    if (native) quiet(SplashScreen.hide({ fadeOutDuration: 300 }));
  },
  haptic: {
    tick: () => (native ? quiet(Haptics.selectionChanged()) : vibrate(4)),
    kick: (power: number) =>
      native
        ? quiet(Haptics.impact({ style: power > 0.66 ? ImpactStyle.Heavy : power > 0.33 ? ImpactStyle.Medium : ImpactStyle.Light }))
        : vibrate(10 + Math.round(power * 25)),
    bump: () => (native ? quiet(Haptics.impact({ style: ImpactStyle.Light })) : vibrate(8)),
    success: () => (native ? quiet(Haptics.notification({ type: NotificationType.Success })) : vibrate([18, 50, 28])),
    error: () => (native ? quiet(Haptics.notification({ type: NotificationType.Error })) : vibrate([40, 60, 40])),
  },
};
