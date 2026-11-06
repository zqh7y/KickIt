// Kick-It! theme: the single place for shared visual values.
// The 3D scene and hud.ts import these directly; the UI styles read them as CSS custom
// properties, which vite.config.ts injects into index.html at build time.

export const color = {
  // ink + paper: outlines, text, UI surfaces
  ink: '#1e2619',
  inkSoft: '#4b5842',
  paper: '#fffdf5',
  // accents
  accent: '#ff5c47', // corner-flag coral
  accentDeep: '#d23c29', // coral for paper text on it, or on paper (4.7:1)
  gold: '#ffc83a',
  danger: '#ef3b33',
  // pitch
  paint: '#f6f8ee', // white line paint
  grassA: '#93c45c',
  grassB: '#87b851',
  grassSeam: '#79a949',
  grassMark: '#6c9b42', // ramp arrows
  sideLeft: '#6e9d41',
  sideRight: '#557f33',
  // ball + footballer
  ballWhite: '#fbfbf6',
  skin: '#f1b184',
  hair: '#4a2b1f',
  cheek: '#f49c88',
  shorts: '#fffdf5',
  // floor surfaces
  ice: '#cdeef7',
  iceLine: '#f4fcff',
  iceSide: '#9fcfdd',
  sand: '#ead29b',
  sandDot: '#d1b479',
  wood: '#cf9558',
  woodDark: '#9c6b3d',
  // map props
  fence: '#fffdf5',
  trampolineMat: '#2f3d68',
  trampolineRim: '#ff5c47',
  magnetBody: '#e8473a',
  magnetTip: '#d9dee6',
  boostPad: '#2c3554',
  boostArrow: '#ffc83a',
  bumperTop: '#ff5c47',
  bumperBase: '#fffdf5',
  portalA: '#4fc3f7',
  portalB: '#ff9f43',
  beltBase: '#3a4060',
  beltArrow: '#ffc83a',
  // the giant stadium far below the floors (src/sky.ts)
  stadiumStripeA: '#6cbb52',
  stadiumStripeB: '#4f9a3d',
  stadiumRunoff: '#4e9640',
  stadiumNet: '#e9eef2',
  stadiumTrack: '#c96b4b',
  stadiumSeats: '#5a7fae',
  groundHaze: '#cfe6ef', // the haze over it, far below
  groundMist: '#9fcc96', // what the floors' pillars dissolve into above it
} as const;

// One pastel sky per tier of five floors (it changes when a new mechanic arrives).
export const skies = [
  '#dcf3e6',
  '#f7f1d6',
  '#e2ebfa',
  '#fbe6de',
  '#ece4f8',
  '#d6f0f2',
  '#f5efc6',
  '#f8dfe8',
  '#e2efd3',
  '#e4e1f5',
] as const;

export const font = {
  display: "'Fredoka', 'Baloo 2', 'Trebuchet MS', system-ui, sans-serif",
} as const;

// Spacing stands on a 4px base.
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 } as const;

// Type roles: [size (px, or any CSS length), weight, letter-spacing em,
// line height, case]
export const type = {
  label: [11, 600, 0.14, 1, 'uppercase'], // chip labels, eyebrow
  value: [22, 700, 0.01, 1, 'none'], // HUD numbers, power readout
  timer: [33, 700, 0, 1, 'none'], // the countdown (1.5x the other HUD numbers)
  valueTotal: [15, 700, 0.01, 1, 'none'], // the "/50" after the floor number
  small: [13, 500, 0.02, 1.3, 'none'], // mode descriptions
  smallStrong: [13, 600, 0.02, 1.3, 'none'], // pills, run clock, best time, text button
  tiny: [11, 600, 0, 1.25, 'none'], // what unlocks a shop ball
  hint: [15, 600, 0, 1.2, 'none'], // start hint
  button: [19, 700, 0.04, 1.1, 'uppercase'], // button labels
  mode: ['clamp(15px, 4.8vw, 19px)', 700, 0.04, 1, 'uppercase'], // lobby mode buttons (two side by side fit 320px)
  ribbon: [14, 700, 0.08, 1, 'uppercase'], // the fail callout's ribbon
  callout: ['clamp(24px, 11.25vw, 36px)', 700, 0.03, 1, 'uppercase'], // "OUT OF KICKS" fits 320px
  heading: [28, 700, 0.01, 1.05, 'uppercase'], // run-complete heading
  time: [52, 700, 0, 1, 'none'], // run-complete time
  title: ['clamp(56px, 19vw, 96px)', 700, 0.01, 0.88, 'uppercase'], // the logo
} as const;

export const ui = {
  stroke: 2, // px, UI borders (echoes the block outlines)
  lift: 3, // px, hard drop shadow under raised UI (hint pills, best-time badge) and under the floor arrows' chevrons
  liftButton: 5, // px, under the big buttons
  liftCard: 6, // px, under the run-complete card
  liftPressed: 1, // px, what is left of a lift while pressed
  liftText: 4, // px, under the power readout
  liftCallout: 5, // px, under the fail callout
  liftLogo: 8, // px, under the logo
  outlineText: 2, // px, ink outline around outlined labels
  outlineLabel: 1.5, // px, the thinner ink outline around small outlined labels (FLOOR, RUN)
  outlineLogo: 3, // px, ink outline around the logo
  radiusPill: 999,
  radiusCard: 24,
  radiusControl: 20, // HUD chips and buttons
  focus: 3, // px, focus ring width (its gap to the control is space 1)
  gutter: space[4], // px, side gutter; never less than the safe area
  hit: 44, // px, smallest tap target
  kickBall: 44, // px, the HUD slot the 3D kick ball is drawn in (the HUD row's tallest item)
  kickBallFill: 0.64, // the ball's diameter as a share of its slot (room left for hops)
  kickOutline: 1.6, // px, ink outline of the HUD ball
  glint: 12, // px, a sparkle star
  nav: 48, // px, floor arrow tap area
  icon: 34, // px, a bare icon button's icon (floor arrows)
  zoomIcon: 26, // px, the zoom button's focus frame (and the restart arrow, the tester button's bug)
  starBig: 52, // px, a star landing on a clear
  starHud: 15, // px, a star target under the timer
  starMini: 12, // px, a floor's best stars by its label, and the lobby total
  starGap: 230, // ms between the stars landing (the chimes follow it)
  shopBall: 'min(54px, 6.4vh)', // a ball's box in the shop grid (smaller on short screens)
  shopBallFill: 0.8, // the 3D ball's diameter as a share of its box (room for the bob and its shadow)
  shopIcon: 20, // px, the ball on the lobby's Shop button
  stripe: 12, // px, a mowing stripe on the Play button
  lineStroke: 3.6, // paper or gold stroke of an outlined line drawing (chevrons, burst rays, ribbon icon), in viewBox units
  lineOutline: 7.2, // the ink stroke under it, in the same units
  fineLine: 1.4, // ink line of a small drawn icon (sparkles, lobby icons), in its viewBox units
  notch: 10, // px, the cut-in at each end of the fail ribbon
  modeIcon: 22, // px, the icon on a lobby mode button
  modesMax: 360, // px, mode buttons max width
  cardMax: 340, // px, run-complete card max width
  tilt: 2, // deg, the slant of a sticker (fail ribbon, best-time badge)
  dim: 0.32, // opacity: disabled button, a painted inner line
  track: 10, // % of ink in an empty ring or track
  scrim: 45, // % of sky over the scene behind the run-complete card
  digit: 0.58, // em, one steady digit cell
  digitSep: 0.28, // em, a separator cell (: or .)
  fast: 140, // ms
  base: 260,
  slow: 520,
  stagger: 80, // ms between staggered entrances
  demo: 1600, // ms, one loop of the drag demo
  callout: 1500, // ms, fail callout from pop to fade-out
  flash: 420, // ms, screen flash
  easePop: 'cubic-bezier(.2,.9,.25,1.25)',
  ease: 'cubic-bezier(.2,.7,.2,1)',
} as const;

// 3D outline width in CSS pixels (blocks, ball, footballer).
export const outlinePx = 1.35;

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

/** A number is px; a string is any CSS length (a clamp, say). */
const length = (n: number | string) => (typeof n === 'number' ? `${n}px` : n);

/** A text outline `w` px wide: eight ink offsets around the glyphs. */
function inkOutline(w: number): string {
  const d = +(w * 0.75).toFixed(2);
  const at: [number, number][] = [[w, 0], [-w, 0], [0, w], [0, -w], [d, d], [-d, d], [d, -d], [-d, -d]];
  return at.map(([x, y]) => `${x}px ${y}px 0 var(--ink)`).join(',');
}

/** All UI tokens as one `:root{}` block. */
export function themeCss(): string {
  const v: string[] = [];
  for (const [k, val] of Object.entries(color)) v.push(`--${kebab(k)}:${val}`);
  v.push(`--sky:${skies[0]}`);
  v.push(`--font-display:${font.display}`);
  for (const [k, val] of Object.entries(space)) v.push(`--space-${k}:${val}px`);
  for (const [k, [size, weight, track, line, textCase]] of Object.entries(type)) {
    const r = kebab(k);
    v.push(
      `--${r}-size:${length(size)}`,
      `--${r}-weight:${weight}`,
      `--${r}-track:${track}em`,
      `--${r}-line:${line}`,
      `--${r}-case:${textCase}`,
    );
  }
  for (const side of ['top', 'right', 'bottom', 'left']) v.push(`--safe-${side}:env(safe-area-inset-${side},0px)`);
  v.push(
    `--gutter-left:max(${ui.gutter}px,var(--safe-left))`,
    `--gutter-right:max(${ui.gutter}px,var(--safe-right))`,
    `--stroke:${ui.stroke}px`,
    `--lift:${ui.lift}px`,
    `--lift-button:${ui.liftButton}px`,
    `--lift-card:${ui.liftCard}px`,
    `--lift-pressed:${ui.liftPressed}px`,
    `--lift-text:${ui.liftText}px`,
    `--lift-callout:${ui.liftCallout}px`,
    `--lift-logo:${ui.liftLogo}px`,
    `--outline-ink:${inkOutline(ui.outlineText)}`,
    `--outline-ink-logo:${inkOutline(ui.outlineLogo)}`,
    `--outline-ink-label:${inkOutline(ui.outlineLabel)}`,
    `--radius-pill:${ui.radiusPill}px`,
    `--radius-card:${ui.radiusCard}px`,
    `--radius-control:${ui.radiusControl}px`,
    `--focus:${ui.focus}px`,
    `--hit:${ui.hit}px`,
    `--kick-ball:${ui.kickBall}px`,
    `--glint:${ui.glint}px`,
    `--nav-size:${ui.nav}px`,
    `--icon-size:${ui.icon}px`,
    `--zoom-icon:${ui.zoomIcon}px`,
    `--star-big:${ui.starBig}px`,
    `--star-hud:${ui.starHud}px`,
    `--star-mini:${ui.starMini}px`,
    `--star-gap:${ui.starGap}ms`,
    `--shop-ball:${ui.shopBall}`,
    `--shop-icon:${ui.shopIcon}px`,
    `--stripe:${ui.stripe}px`,
    `--line-stroke:${ui.lineStroke}`,
    `--line-outline:${ui.lineOutline}`,
    `--fine-line:${ui.fineLine}`,
    `--notch:${ui.notch}px`,
    `--mode-icon:${ui.modeIcon}px`,
    `--modes-max:${ui.modesMax}px`,
    `--card-max:${ui.cardMax}px`,
    `--tilt:${ui.tilt}deg`,
    `--dim:${ui.dim}`,
    `--track:color-mix(in srgb,var(--ink) ${ui.track}%,transparent)`,
    `--scrim:color-mix(in srgb,var(--sky) ${ui.scrim}%,transparent)`,
    `--digit:${ui.digit}em`,
    `--digit-sep:${ui.digitSep}em`,
    `--fast:${ui.fast}ms`,
    `--base:${ui.base}ms`,
    `--slow:${ui.slow}ms`,
    `--stagger:${ui.stagger}ms`,
    `--demo-time:${ui.demo}ms`,
    `--callout-time:${ui.callout}ms`,
    `--flash-time:${ui.flash}ms`,
    `--ease-pop:${ui.easePop}`,
    `--ease:${ui.ease}`,
  );
  return `:root{${v.join(';')}}`;
}
