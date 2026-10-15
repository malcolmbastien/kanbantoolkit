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
 * A chip's ground and the colour of the words on it.
 *
 * Picking between white and near-black by a brightness threshold is what put white text on
 * sky-500 at 2.8:1: a mid colour is bright enough to be guessed light and still far too light
 * for white. So the choice is made by contrast ratio, and the ground only gives way when
 * neither extreme reaches the floor — the one case a mid-tone brand colour cannot solve by
 * itself.
 */
export function chipColors(hex: string): { background: string; color: string } {
  const best = contrastRatio('#ffffff', hex) >= contrastRatio(INK, hex) ? '#ffffff' : INK
  if (contrastRatio(best, hex) >= CONTRAST_FLOOR) return { background: hex, color: best }
  for (let amount = 0.05; amount < 0.65; amount += 0.05) {
    const background = mix(hex, '#000000', amount)
    if (contrastRatio('#ffffff', background) >= CONTRAST_FLOOR) return { background, color: '#ffffff' }
  }
  return { background: mix(hex, '#000000', 0.65), color: '#ffffff' }
}

/** Solid-ish chip styling for a stage (used on lane headers). */
export function stageChip(stage: Stage): string {
  switch (stage) {
    case 'done':
      return 'bg-emerald-400/80 text-emerald-950'
    case 'inProgress':
      return 'bg-indigo-400/80 text-indigo-950'
    case 'notStarted':
      return 'bg-slate-400/80 text-slate-900'
    case 'backlog':
      return 'bg-amber-300/90 text-amber-950'
  }
}

/** Small card-symbol dot colour by rollup bucket. */
export const BUCKET_DOT: Record<Stage, string> = {
  backlog: 'bg-amber-400',
  notStarted: 'bg-slate-300',
  inProgress: 'bg-indigo-400',
  done: 'bg-emerald-500',
}

/** Top accent colour for a top-level column, by workflow stage. */
export const STAGE_ACCENT: Record<Stage, string> = {
  backlog: '#fbbf24',
  notStarted: '#94a3b8',
  inProgress: '#818cf8',
  done: '#34d399',
}

/**
 * A lane body, tinted by the stage it belongs to. The stage is then legible from the
 * column itself rather than from a label — and it is the *column's* stage, so a team
 * splitting a column into cells does not lose it.
 */
export const STAGE_SURFACE: Record<Stage, string> = {
  backlog: 'bg-slate-100',
  notStarted: 'bg-slate-100',
  inProgress: 'bg-indigo-50',
  done: 'bg-emerald-50',
}

/** The lane's count, as a pill at the header's right edge. */
export const STAGE_PILL: Record<Stage, string> = {
  backlog: 'bg-slate-700 text-white',
  notStarted: 'bg-slate-700 text-white',
  inProgress: 'bg-indigo-600 text-white',
  done: 'bg-emerald-600 text-white',
}

/** The dot that marks a lane's stage in its header. */
export const STAGE_DOT: Record<Stage, string> = {
  backlog: 'bg-amber-500',
  notStarted: 'bg-slate-400',
  inProgress: 'bg-indigo-600',
  done: 'bg-emerald-600',
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
