import type { BoardBand, Objective, Stage } from '@/domain/types'

/*
 * Colour primitives. `mix` and `tintOn` turn a colour into another colour; nothing here leaves
 * an alpha channel behind, because a translucent surface is a filter over whatever is behind it
 * rather than a colour of its own.
 */

const channels = (hex: string) => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

const mix = (hex: string, onto: string, amount: number) =>
  toHex(channels(hex).map((c, i) => c * (1 - amount) + channels(onto)[i] * amount))

/**
 * A colour as a solid tint over white.
 *
 * The card face used to be the type colour at 10% alpha, which is not a colour at all — it is
 * a filter over whatever happens to be behind it. The same card therefore came out slate-tinted
 * in Backlog, indigo-tinted in In Progress and emerald-tinted in Done: a team reading its own
 * board was reading the column, not the card. Compositing it here means a card is the colour it
 * says it is, wherever it sits.
 */
export function tintOn(hex: string, alpha: number, base = '#ffffff'): string {
  return mix(hex, base, 1 - alpha)
}

export const DEP_STATE_STYLES: Record<string, { label: string; className: string }> = {
  Closed: { label: 'Closed', className: 'bg-slate-200 text-slate-600 ring-slate-300' },
  Satisfied: { label: 'Satisfied', className: 'bg-emerald-100 text-emerald-800 ring-emerald-300' },
  OpenPlanningRisk: {
    label: 'Open · planning risk',
    className: 'bg-amber-100 text-amber-800 ring-amber-300',
  },
  OpenLiveBlockage: {
    label: 'Open · live blockage',
    className: 'bg-rose-100 text-rose-800 ring-rose-300',
  },
}

/** Objective status chip. */
export const OBJECTIVE_STATUS_STYLES: Record<Objective['status'], string> = {
  active: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
  scored: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
}

/** WCAG relative luminance. */
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The contrast a person can read comfortably: WCAG AA for normal text. */
export const CONTRAST_FLOOR = 4.5

/** Near-black, for text on a light ground. */
export const INK = '#0f172a'

/**
 * How much of its lightness a colour may lose to carry a white label.
 *
 * A mid-tone needs a little — sky-500 takes 25%, amber-500 takes 35% — and a pale one would need
 * most of it: white and lemon both take 55%. That gap is what tells a colour that can be a chip
 * from a colour that has to keep its ground.
 */
const PALE = 0.4

/**
 * A chip's ground and the colour of the words on it.
 *
 * White first, and the ground gives way to get it. A chip is a label, and white on a saturated
 * colour is what a label looks like — but on a strong hue it is also the more legible of the two:
 * near-black on sky-500 measures 6:1 and still reads badly, because the eye cannot focus a blue
 * ground and black words at the same distance, so the letters fizz at the edges. Contrast ratio
 * alone chose black there, which is what "hard to read" was.
 *
 * A colour that would have to lose more than `PALE` of its lightness to carry white is a *pale*
 * colour, and a pale colour is a dark-text one: taking a cream or a lemon down to a mid brown to
 * keep a white label would throw the colour away to keep the convention. Where neither works at
 * that price, the ground keeps giving way until the words are readable — a chip nobody can read is
 * not a chip.
 */
export function chipColors(hex: string): { background: string; color: string } {
  for (let amount = 0; amount <= PALE; amount += 0.05) {
    const background = amount === 0 ? hex : mix(hex, '#000000', amount)
    if (contrastRatio('#ffffff', background) >= CONTRAST_FLOOR) return { background, color: '#ffffff' }
  }
  if (contrastRatio(INK, hex) >= CONTRAST_FLOOR) return { background: hex, color: INK }
  for (let amount = PALE; amount < 0.95; amount += 0.05) {
    const background = mix(hex, '#000000', amount)
    if (contrastRatio('#ffffff', background) >= CONTRAST_FLOOR) return { background, color: '#ffffff' }
  }
  return { background: mix(hex, '#000000', 0.95), color: '#ffffff' }
}

/**
 * The same colour as a *soft* chip: a wash of it, with the hue taken down until its own words are
 * readable on the wash.
 *
 * `chipColors` is the loud version — a solid ground, for a chip that is the subject (a type, a
 * status, the thing a control is about). This is the quiet one, for a chip that is only a mention
 * of something: it keeps the colour, so the vocabulary is still recognisable at a glance, and
 * gives up the weight, so it cannot compete with what the surface is actually saying. The walk is
 * `chipColors`' own — the first shade that reaches the floor — because a colour nobody chose for a
 * background must not decide whether a word can be read.
 */
export function softChipColors(hex: string): { background: string; color: string } {
  const background = tintOn(hex, 0.16)
  for (let alpha = 0.5; alpha >= 0.05; alpha -= 0.05) {
    const color = tintOn(hex, alpha, INK)
    if (contrastRatio(background, color) >= CONTRAST_FLOOR) return { background, color }
  }
  return { background, color: INK }
}

/**
 * The colours a tag is given when it is created from an item rather than from board settings.
 *
 * Somebody who types a new tag is mid-thought and should not have to choose a colour; but every
 * new tag the same grey would make the board's vocabulary unreadable, which is the one thing a
 * tag is for. So they cycle — a default, not a decision: board settings recolours any of them.
 */
export const TAG_PALETTE = ['#0ea5e9', '#8b5cf6', '#f43f5e', '#f59e0b', '#10b981', '#64748b']

/**
 * The shape of a warning badge, and the colour it wears by tone.
 *
 * One shape for every warning, wherever it is drawn — a card's badge row and the drawer's warnings
 * section read as the same set — and the *weight* carries the domain's own distinction: a hard stop
 * is solid, something to watch is pale and ringed. The palette is `HEALTH_META`'s, so a card, a
 * drawer and the dashboard say the same thing in the same colour.
 */
export const FLAG_BADGE_SHAPE = 'shrink-0 rounded px-1.5 py-0.5 text-micro'

export const FLAG_BADGE: Record<'risk' | 'watch', string> = {
  risk: 'bg-rose-600 font-semibold text-white',
  watch: 'bg-amber-100 font-medium text-amber-800 ring-1 ring-amber-300',
}

/**
 * The four stages, as colours.
 *
 * One source, because a stage is a colour everywhere it appears — the column's accent, its tint,
 * its count, its dot, a card's pips, a chip on a row — and four maps each picking their own shade
 * is four chances for the board to disagree with itself about what "in progress" looks like.
 *
 * The meaning is the ramp's: an unstarted pair that are greys and blues (nothing has happened
 * yet), a violet for work under way, and a green for work delivered. Backlog and Not Started are
 * deliberately *not* two shades of one grey: a lane's tint is how the app says which stage the
 * lane is, so two lanes a shade apart would stop being tellable apart at a glance.
 */
export const STAGE_COLOR: Record<Stage, string> = {
  backlog: '#64748b',
  notStarted: '#3b82f6',
  inProgress: '#7c3aed',
  done: '#059669',
}

/** Solid-ish chip styling for a stage (used on rows and in the legend). */
export function stageChip(stage: Stage): string {
  switch (stage) {
    case 'done':
      return 'bg-emerald-400/80 text-emerald-950'
    case 'inProgress':
      return 'bg-violet-400/80 text-violet-950'
    case 'notStarted':
      return 'bg-blue-400/80 text-blue-950'
    case 'backlog':
      return 'bg-slate-400/80 text-slate-900'
  }
}

/** Small card-symbol dot colour by rollup bucket. */
export const BUCKET_DOT: Record<Stage, string> = {
  backlog: 'bg-slate-400',
  notStarted: 'bg-blue-400',
  inProgress: 'bg-violet-500',
  done: 'bg-emerald-500',
}

/** Top accent colour for a top-level column, by workflow stage. */
export const STAGE_ACCENT: Record<Stage, string> = STAGE_COLOR

/**
 * A lane body, tinted by the stage it belongs to. The stage is then legible from the
 * column itself rather than from a label — and it is the *column's* stage, so a team
 * splitting a column into cells does not lose it.
 */
export const STAGE_SURFACE: Record<Stage, string> = {
  backlog: 'bg-slate-100',
  notStarted: 'bg-blue-50',
  inProgress: 'bg-violet-50',
  done: 'bg-emerald-50',
}

/**
 * The lane's count, as a pill at the header's right edge — the stage colour, taken a shade deeper
 * where white on it would fall under the floor (blue-500 carries white at 3.7:1; blue-600 at 5.2).
 */
export const STAGE_PILL: Record<Stage, string> = {
  backlog: 'bg-slate-500 text-white',
  notStarted: 'bg-blue-600 text-white',
  inProgress: 'bg-violet-600 text-white',
  done: 'bg-emerald-600 text-white',
}

/** The dot that marks a lane's stage in its header. */
export const STAGE_DOT: Record<Stage, string> = {
  backlog: 'bg-slate-500',
  notStarted: 'bg-blue-500',
  inProgress: 'bg-violet-600',
  done: 'bg-emerald-600',
}

/**
 * The dot a row wears for an item's standing — done, under way, or not yet. `statusOf`'s three
 * answers, in the two colours the ramp gives them and the grey it starts from.
 */
export function statusDot(status: { resolved: boolean; started: boolean }): string {
  return status.resolved ? 'bg-emerald-600' : status.started ? 'bg-violet-600' : 'bg-slate-400'
}

/** A lane header when the column is at or over its WIP limit — the tint always wins. */
export const WIP_HEADER = {
  over: 'border-rose-300 bg-rose-600 text-white',
  at: 'border-amber-300 bg-amber-500 text-white',
} as const

/**
 * The accent a board's initiative surfaces wear. It follows the band badge so the
 * flight level reads from the work itself: Team = green, Program = blue,
 * Portfolio = violet.
 */
export const BAND_ACCENT: Record<
  BoardBand,
  {
    section: string
    header: string
    subtitle: string
    column: string
    columnHeader: string
    columnCount: string
    /** The dot that opens a workflow's section bar. */
    dot: string
    /** The rule under a workflow's section bar. */
    rule: string
  }
> = {
  team: {
    section: 'border-emerald-300 bg-emerald-50/60',
    header: 'border-emerald-300 bg-emerald-800',
    subtitle: 'text-emerald-200',
    column: 'border-emerald-200 bg-emerald-50/70',
    columnHeader: 'bg-emerald-700 text-white',
    columnCount: 'text-emerald-200',
    dot: 'bg-emerald-600',
    rule: 'border-emerald-200',
  },
  program: {
    section: 'border-sky-300 bg-sky-50/60',
    header: 'border-sky-300 bg-sky-800',
    subtitle: 'text-sky-200',
    column: 'border-sky-200 bg-sky-50/70',
    columnHeader: 'bg-sky-700 text-white',
    columnCount: 'text-sky-200',
    dot: 'bg-sky-600',
    rule: 'border-sky-200',
  },
  portfolio: {
    section: 'border-violet-300 bg-violet-50/60',
    header: 'border-violet-300 bg-violet-800',
    subtitle: 'text-violet-200',
    column: 'border-violet-200 bg-violet-50/70',
    columnHeader: 'bg-violet-700 text-white',
    columnCount: 'text-violet-200',
    dot: 'bg-violet-600',
    rule: 'border-violet-200',
  },
}
