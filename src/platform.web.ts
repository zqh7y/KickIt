// Browser-only twin of platform.ts, used by the preview build (no Capacitor).
const vibrate = (p: number | number[]) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* not available */
  }
};

export const platform = {
  native: false,
  init(_onBack: () => boolean, _onPause: () => void, _onResume: () => void) {},
  hideSplash() {},
  haptic: {
    tick: () => vibrate(4),
    kick: (power: number) => vibrate(10 + Math.round(power * 25)),
    bump: () => vibrate(8),
    success: () => vibrate([18, 50, 28]),
    error: () => vibrate([40, 60, 40]),
  },
};
