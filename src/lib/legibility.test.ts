import { describe, expect, it } from 'vitest'
import { CONTRAST_FLOOR, chipColors, contrastRatio } from './colors'
import { cn } from './utils'
import { createSeed } from '../domain/seed'

/**
 * Every `.tsx` under `src` as source text — globbed rather than walked, so a file added later
 * cannot sidestep the guard and the browser build keeps its own set of types.
 */
const SOURCES = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('legibility', () => {
  it('takes every font size from the scale', () => {
    // The scale is in `@theme` in index.css. A `text-[Npx]` is a size nobody chose, which is
    // how the interface drifted down to 8px in the first place. Five steps and nothing below
    // `micro` is a rule only if something enforces it.
    const offenders = Object.entries(SOURCES).flatMap(([file, text]) =>
      text
        .split('\n')
        .map((line, n) => ({ line, n: n + 1 }))
        .filter(({ line }) => /text-\[\d+px\]/.test(line))
        .map(({ n }) => `${file}:${n}`),
    )
    expect(offenders).toEqual([])
  })

  it('keeps a scale size when a colour is merged alongside it', () => {
    // `cn` is tailwind-merge, which keeps the last class of each group. A size it does not
    // know is taken for a text colour and dropped as soon as a colour follows — a silent
    // 12px to 16px, and the reason two counters of the same thing came out different sizes.
    for (const size of ['text-micro', 'text-meta', 'text-body', 'text-title', 'text-heading']) {
      expect(cn(size, 'text-slate-600'), size).toBe(`${size} text-slate-600`)
    }
  })

  it('keeps secondary text above the floor on every ground it sits on', () => {
    // slate-600 is the lightest grey allowed for text. slate-500 and lighter are for icons,
    // dividers and disabled states — which is the whole point of having a floor, because
    // slate-500 on a tinted column is 3.9:1 and on slate-100 it is 4.3:1, both below it.
    const grounds = {
      white: '#ffffff',
      'slate-50 — the item panel': '#f8fafc',
      'slate-100': '#f1f5f9',
      'slate-200 — the backlog and not-started columns': '#e2e8f0',
      'indigo-50 — the in-progress column': '#eef2ff',
      'emerald-50 — the done column': '#ecfdf5',
    }
    const text = '#475569' // slate-600
    for (const [name, ground] of Object.entries(grounds)) {
      expect(contrastRatio(text, ground), `slate-600 on ${name}`).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
    }
  })

  it('keeps a type chip readable on every type colour', () => {
    // White on sky-500 is 2.8:1 and on amber-500 it is 2.2:1 — the chips were picked by a
    // brightness guess rather than by contrast, and the guess was wrong for both.
    for (const type of createSeed().issueTypes) {
      const { background, color } = chipColors(type.color)
      expect(contrastRatio(color, background), `${type.name} ${type.color}`).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
    }
  })
})
