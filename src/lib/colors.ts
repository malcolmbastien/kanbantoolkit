import type { PortfolioRisk } from '@/domain/portfolio'
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

/** Objective status chip. */
export const OBJECTIVE_STATUS_STYLES: Record<Objective['status'], string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-200',
  active: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
  archived: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  cancelled: 'bg-rose-100 text-rose-700 ring-rose-200',
}

/** The dot a status wears in a picker or a chip, so the four states read apart at a glance. */
export const OBJECTIVE_STATUS_DOT: Record<Objective['status'], string> = {
  draft: 'bg-slate-400',
  active: 'bg-indigo-500',
  archived: 'bg-emerald-500',
  cancelled: 'bg-rose-500',
}

/**
 * The portfolio heatmap's five readings, as a tint on the objective's row. The words live in the
 * row's own cells — Coverage says "No initiative", Health names its level, Target says how many are
 * overdue — so the tint is the glance and the cells are the answer, never the colour alone.
 */
export const PORTFOLIO_RISK_STYLES: Record<PortfolioRisk, { row: string }> = {
  unserved: { row: 'bg-amber-50/50' },
  atRisk: { row: 'bg-rose-50/50' },
  watch: { row: 'bg-yellow-50/40' },
  onTrack: { row: 'bg-white' },
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
 * The palette a new type or kind starts from, in order. Two vocabulary entries with the same
 * colour stop being tellable apart at a glance, so the next free colour is chosen rather than a
 * fixed default. Past the named palette a fresh hue is generated rather than repeating one.
 */
export const VOCABULARY_PALETTE = [
  '#0ea5e9',
  '#8b5cf6',
  '#f43f5e',
  '#f59e0b',
  '#10b981',
  '#64748b',
  '#6366f1',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#06b6d4',
]

/** HSL to a hex colour, for the colours past the named palette. */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness)
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/**
 * The first colour in `palette` the workspace is not already using, or a fresh hue beyond it.
 *
 * The comparison is case-insensitive because a colour is a value, not a spelling. A workspace with
 * more colours than the palette still gets one of its own rather than an echo.
 */
export function nextUnusedColor(
  used: Iterable<string>,
  palette: readonly string[] = VOCABULARY_PALETTE,
): string {
  const taken = new Set([...used].map((color) => color.toLowerCase()))
  const free = palette.find((color) => !taken.has(color.toLowerCase()))
  if (free) return free
  for (let hue = 0; hue < 360; hue += 12) {
    const candidate = hslToHex(hue, 0.65, 0.45)
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return palette[0] ?? '#64748b'
}

/**
 * The shape of a warning badge, and the colour it wears by tone.
 *
 * One shape for every warning, wherever it is drawn — a card's badge row and the drawer's warnings
 * section read as the same set. Both tones are pale and ringed, because a warning is a sentence
 * beside the work rather than a block over it: the difference is the hue the domain gives it, not
 * the weight of the paint. Risk wears the same rose as a card's own blocked callout; watch wears
 * amber. The palette is `HEALTH_META`'s, so a card, a drawer and the dashboard say the same thing
 * in the same colour.
 */
export const FLAG_BADGE_SHAPE = 'shrink-0 rounded px-1.5 py-0.5 text-micro'

export const FLAG_BADGE: Record<'risk' | 'watch', string> = {
  risk: 'bg-rose-50 font-semibold text-rose-700 ring-1 ring-rose-200',
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

/** Solid-ish chip styling for a stage (used on rows and stage chips). */
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
 * A cards column's own reading: a light ground, a thin stage-coloured edge and a dark header in
 * the stage's colour. The accent is the header now, not a bar above the column, and the count sits
 * on the dark header as a small translucent pill.
 */
export const STAGE_COLUMN: Record<Stage, { surface: string; header: string; count: string }> = {
  backlog: {
    surface: 'border-slate-200 bg-slate-100/60',
    header: 'bg-slate-600 text-white',
    count: 'bg-white/20 text-white ring-1 ring-white/30',
  },
  notStarted: {
    surface: 'border-blue-200 bg-blue-50/50',
    header: 'bg-blue-600 text-white',
    count: 'bg-white/20 text-white ring-1 ring-white/30',
  },
  inProgress: {
    surface: 'border-violet-200 bg-violet-50/40',
    header: 'bg-violet-600 text-white',
    count: 'bg-white/20 text-white ring-1 ring-white/30',
  },
  done: {
    surface: 'border-emerald-200 bg-emerald-50/40',
    header: 'bg-emerald-700 text-white',
    count: 'bg-white/20 text-white ring-1 ring-white/30',
  },
}

/**
 * The stage colours for a *stacked* chart, where four bands sit against one another rather than
 * beside a label. The board's own accents are chosen for a column header and a dot; in a stack the
 * blue and violet are too close and the thin bands disappear. These use the Okabe-Ito qualitative
 * hues — grey, sky, amber and bluish green — which stay apart for the common colour-vision types.
 * This palette is chart-only: a stage's column, pill and dot keep `STAGE_COLOR`.
 */
export const STAGE_STACK: Record<Stage, string> = {
  backlog: '#64748b',
  notStarted: '#56b4e9',
  inProgress: '#e69f00',
  done: '#009e73',
}

/**
 * A lane body, tinted by the stage it belongs to. The stage is then legible from the
 * column itself rather than from a label — and it is the *column's* stage, so a team
 * splitting a column into cells does not lose it.
 *
 * The three levels of the board, and they are deliberate:
 *
 *   page     `bg-board-ground` — the ground, a touch lighter than slate-300, still a clear
 *                                step below white;
 *   column   these tints     — an object on the ground, still light;
 *   card     `bg-white`      — the brightest plane, lifted by its shadow.
 *
 * The card is what a person reads, so it is the only pure white on the board. A tint
 * that drifts back towards white takes that away: the columns stop being objects and
 * the cards stop standing out, which is what the board looked like before.
 *
 * Supporting chrome sits on its column rather than becoming a fourth plane. A column
 * header is a translucent shelf over the tint — lighter than a card, never shadowed —
 * and the Add card footer is a label on the tint with no ground of its own. That is the
 * middle weight the board needs: a header repeated per column must not wear the card's
 * treatment (an opaque bar with an edge and a shadow competed with the work), but a bare
 * name on the tint vanished into it. The work is still what the eye catches first.
 */
export const STAGE_SURFACE: Record<Stage, string> = {
  backlog: 'bg-slate-200/80',
  notStarted: 'bg-blue-100/70',
  inProgress: 'bg-violet-100/70',
  done: 'bg-emerald-100/70',
}

/**
 * The lane's count, as a pill at the header's right edge.
 *
 * A count is a label, not an alarm — so it is a soft wash of the stage colour with the stage's own
 * deep text, rather than a solid block of it. The column's accent bar and tint already say which
 * stage it is; the pill only says how many are in it.
 */
export const STAGE_PILL: Record<Stage, string> = {
  backlog: 'bg-slate-200/80 text-slate-700 ring-1 ring-slate-300/70',
  notStarted: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200',
  inProgress: 'bg-violet-100 text-violet-700 ring-1 ring-violet-200',
  done: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
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

/**
 * A WIP breach, stated on the column and in the count.
 *
 * The pill alone was not enough: a reader scanning the board saw a small badge and a tinted
 * header, and the column — the thing the eye is drawn to — still wore its stage colour. A lane
 * at or over its limit now wears a wash of the alarm colour too, on the tint, the edge, the accent
 * line and the header, so a full column is legible from across the board.
 *
 * It is a wash, not a flood: the ground is a 100-level tint and the cards stay white, so a busy
 * column still reads as a column rather than as a fault, and the stage is still named in the
 * header. Left, not blocked: colour changes nothing about what a move may do.
 */
export const WIP_PILL = {
  over: 'bg-white text-rose-700 ring-1 ring-rose-200',
  at: 'bg-white text-amber-900 ring-1 ring-amber-300',
} as const

/**
 * The column's own share of the breach, by state.
 *
 * A tinted wash was not enough: the board already uses colour to say which stage a column is, and
 * a soft amber or rose read as another pleasant column colour rather than as a problem. So a
 * breach is drawn in things this board uses nowhere else — a hazard-striped header, a solid title
 * bar, a darker sentence beneath it, and a glow around the whole column. `lane` is the top-level
 * column (ground and edge), `cell` the body of a nested cell, `header` the title bar and its edge,
 * `rule` the sentence strip beneath it, `hazard` the tape's gradient, and `label` the sentence.
 */
export const WIP_SURFACE = {
  over: {
    lane:
      'border-2 border-rose-400 bg-rose-50/40 shadow-[0_0_0_1px_rgba(225,29,72,0.2),0_4px_12px_rgba(225,29,72,0.06)]',
    cell: 'border-2 border-rose-400 bg-rose-50/40',
    header: 'border border-rose-300 bg-rose-600 text-white shadow-sm',
    stripe: 'bg-rose-600 text-white',
    hazard:
      'repeating-linear-gradient(-45deg, rgba(255,255,255,0.22) 0 8px, rgba(0,0,0,0.12) 8px 16px)',
    rule: 'border-rose-500/50 bg-rose-700 text-rose-100',
    label: 'Over WIP limit',
  },
  at: {
    lane:
      'border-2 border-amber-400 bg-amber-50/40 shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_4px_12px_rgba(245,158,11,0.06)]',
    cell: 'border-2 border-amber-400 bg-amber-50/40',
    header: 'border border-amber-300 bg-amber-500 text-amber-950 shadow-sm',
    stripe: 'bg-amber-500 text-amber-950',
    hazard:
      'repeating-linear-gradient(-45deg, rgba(255,255,255,0.22) 0 8px, rgba(0,0,0,0.12) 8px 16px)',
    rule: 'border-amber-600/50 bg-amber-600 text-amber-50',
    label: 'At WIP limit',
  },
} as const

/**
 * The accent a board's initiative surfaces wear. It follows the band badge so the
 * board type reads from the work itself: Team = green, Program = blue,
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
