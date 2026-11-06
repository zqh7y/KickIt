# KickIt!

A 3D football challenge game: kick the ball across 50 floating pitch floors and stop it
inside the circle, within a kick limit and a countdown. Every 5 floors bring a new mechanic:

| Floors | Mechanic |
|---|---|
| 1-5 | Ramps, ledges and fences (bank shots) |
| 6-10 | Plank bridges |
| 11-15 | Trampolines |
| 16-20 | Magnets (pull, later also push) |
| 21-25 | Ice and sand |
| 26-30 | Boost pads |
| 31-35 | Pinball bumpers |
| 36-40 | Portals |
| 41-45 | Conveyor belts |
| 46-50 | Everything at once |

Two modes:

- **Play**: any mistake retries the floor; the countdown starts on your first touch; `<` and `>`
  move between floors you have reached (saved on the device).
- **Speedrun**: all 50 floors in one run; any mistake sends you back to floor 1; the run clock and
  your best time are saved on the device.

Controls: grab the ball and drag it back, let go to kick. Touch anywhere else to look around:
pinch (or the mouse wheel) to zoom, drag to pan, double-tap to zoom in or back out. The focus
button under the kicks frames the shot (the ball and the circle). Looking around never starts
the countdown.

**Shop**: in the lobby, Shop zooms the camera in on the ball (twice the lobby's zoom) and floats
16 real 3D balls with their shadows over the top of the screen, 4 by 4: footballs (Classic, Gold,
Neon, Diamond) and a tennis ball, basketball, volleyball, baseball, beach ball, 8-ball, cricket
ball, bowling ball, golf ball, disco ball, watermelon and the Earth. Each has its own goal: reach a floor, clear a number of
floors, clear floors with the first kick, or finish a Speedrun (under a time, for the best ones).
A locked ball shows as its shadow with its goal underneath; tap an unlocked one to play with it.
Progress is saved on the device.

**Tester mode** (for development): the bug button under the focus button turns it on. The
`<` and `>` arrows then go to any floor, in either mode, as fast as you tap, and every shop ball
is unlocked. Runs that used it set no records. Turn the button off for release builds with
`TESTER_TOOLS = false` in `src/config.ts`.

## What is where

| Path | What it is |
|---|---|
| `src/levels.ts` | Floor format and parsing (tiles, surfaces, bridges, belts, objects, rounded corners) |
| `src/floors.ts` | Floors 1-2 (hand-made); floors 3-50 are in `src/floors.generated.ts` |
| `src/physics.ts` | Ball physics: friction, ramps, walls, ledges, falls and every mechanic |
| `src/props.ts`, `src/propsView.ts` | The 3D props (fences, trampolines, magnets...) and their placement |
| `src/game.ts` | Game flow, both modes, every transition and effect |
| `src/floor.ts`, `src/pitchTexture.ts` | The floating pitch blocks and their markings |
| `src/player.ts`, `src/ball.ts` | The 3D footballer and the football |
| `src/theme.ts` | Every colour, font size and spacing value (the UI and the 3D scene both read it) |
| `src/sky.ts` | The giant stadium far below the floors |
| `src/skins.ts`, `src/shopBalls.ts` | The shop's 16 balls and their goals, and the shop's 3D balls (the patterns are painted in `src/ball.ts`) |
| `src/config.ts` | Build switches (`TESTER_TOOLS`) |
| `src/audio.ts` | All sounds, synthesised at runtime (no audio files) |
| `scripts/gen-floors.ts` | Generates floors 3-50 (each one solved before it is kept) |
| `scripts/solve.ts` | Checks every floor can be beaten within its kick limit |
| `scripts/feature-tests.ts` | One tiny floor per mechanic, solved through the real physics |
| `android/` | The Android app (Capacitor 8, targets API 36 / Android 16) |
| `store/` | Play Store icon, feature graphic and phone screenshots |

## Floors

Regenerate floors 3-50 (about a minute; every candidate is solved before it is kept):

```bash
node scripts/gen-floors.ts
```

Check every floor can be beaten within its kick limit (or name floors, e.g. `node scripts/solve.ts 12 13`):

```bash
node scripts/solve.ts
```

To hand-make a floor, add it to `HANDMADE` in `src/floors.ts`. Map tokens (rows along +z,
columns along +x): `.` empty · a level digit, then optionally a ramp `>` `<` `v` `^` (rises one
level toward +x, -x, +z, -z), a surface `i` ice / `s` sand, a plank `=` (along x) / `|` (along z),
a belt `E` `W` `S` `N`. Objects (fences, trampolines, magnets, boost pads, bumpers, portals) go in
`objects` with world positions. The camera looks from the bottom right: start near the bottom
right of the map and put the circle near the top left.

## Run it in a browser

```bash
npm install
```

```bash
npm run dev
```

## Build the Android app

Needs Node 22+, JDK 21 and the Android SDK (Android Studio installs it).

```bash
npm run build
```

```bash
npx cap sync android
```

```bash
cd android && ./gradlew bundleRelease assembleRelease
```

Outputs: `android/app/build/outputs/bundle/release/app-release.aab` (upload this to Google
Play) and `android/app/build/outputs/apk/release/app-release.apk` (install on a phone).

Release builds are signed with the upload key from `android/keystore.properties` and
`android/keys/` (both git-ignored). Keep them private and backed up: every update must be
signed with the same upload key.

## Before the first Google Play upload

1. Set `TESTER_TOOLS = false` in `src/config.ts`.
2. Pick your final package id (it can never change once uploaded); it is `com.skypitch.game`
   now. Edit `applicationId` in `android/app/build.gradle` and `appId` in
   `capacitor.config.ts`, then rebuild.
3. In Play Console, create the app and upload the `.aab` to an internal testing track first.
4. Store listing: use `store/play-icon-512.png`, `store/feature-graphic-1024x500.png` and the
   `store/screenshot-*.png` files.
5. Data safety: the game collects and shares no data. Best times are stored only on the device.
