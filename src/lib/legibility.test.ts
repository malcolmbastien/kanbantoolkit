import { describe, expect, it } from 'vitest'
import { CONTRAST_FLOOR, chipColors, contrastRatio, softChipColors, TAG_PALETTE, tintOn } from './colors'
import { cn } from './utils'
import { createFixture } from '../domain/fixture'

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

  it('keeps a view header readable: its own ink on its own ground', () => {
    // The Objectives header was a dark strip with grey text on it. Slate-600 on slate-800 is
    // 1.9:1, against this app's own 4.5 floor — which is what "hard to read" meant. The light
    // header it became reads at the pairs below, checked rather than assumed.
    const VIOLET_50 = '#f5f3ff'
    const pairs = [
      ['the title', '#1e293b'],
      ['the eyebrow', '#6d28d9'],
      ['the explanation', '#475569'],
    ] as const
    for (const [what, ink] of pairs) {
      expect(contrastRatio(ink, VIOLET_50), what).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
    }
    // …and the strip it replaced, kept here as the reason it went.
    expect(contrastRatio('#475569', '#1e293b')).toBeLessThan(CONTRAST_FLOOR)
  })

  it('composites a card tint to a colour, not a filter', () => {
    // The card face was the type colour at 10% alpha, so it took the colour of whatever column
    // it sat in — the same card read slate in Backlog, indigo in In Progress and emerald in
    // Done. A tint has to be a colour.
    const tint = tintOn('#0ea5e9', 0.1)
    expect(tint).toBe('#e7f6fd')
    expect(tint).not.toMatch(/rgba?\(/)
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
      'slate-100 — the backlog and not-started columns': '#f1f5f9',
      'slate-200 — the workspace ground, behind the section labels': '#e2e8f0',
      'indigo-50 — the in-progress column': '#eef2ff',
      'emerald-50 — the done column': '#ecfdf5',
    }
    const text = '#475569' // slate-600
    for (const [name, ground] of Object.entries(grounds)) {
      expect(contrastRatio(text, ground), `slate-600 on ${name}`).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
    }
  })

  it('keeps the chips and hints added since readable on their own grounds', () => {
    // Contrast is not a property of a theme, it is a property of each pair — so every pair a
    // later round introduced is listed here: a health badge, a palette row, a metrics figure.
    const pairs: [string, string, string][] = [
      ['at-risk chip', '#be123c', '#ffe4e6'], // rose-700 on rose-100
      ['watch chip', '#92400e', '#fef3c7'], // amber-800 on amber-100
      ['on-track chip', '#047857', '#ecfdf5'], // emerald-700 on emerald-50
      ['risk flag', '#be123c', '#fff1f2'], // rose-700 on rose-50
      ['watch flag', '#92400e', '#fffbeb'], // amber-800 on amber-50
      ['delivered figure', '#047857', '#ffffff'], // emerald-700 on white
      ['palette row, active', '#1e293b', '#eef2ff'], // slate-800 on indigo-50
      ['palette hint', '#475569', '#ffffff'],
      ['palette footer', '#475569', '#f8fafc'],
      ['metrics note', '#475569', '#ffffff'],
    ]
    for (const [name, color, background] of pairs) {
      expect(contrastRatio(color, background), name).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
    }
  })

  it('gives every dialog and region a name', () => {
    // A region with no name is a landmark a screen reader cannot announce; a dialog with no
    // name is a question with no question in it. The check reads the element's own tag, so a
    // label on the element *next* to it cannot stand in for the one that is missing.
    const offenders: string[] = []
    for (const [file, text] of Object.entries(SOURCES)) {
      for (const role of ['dialog', 'region']) {
        const needle = `role="${role}"`
        for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
          const open = text.lastIndexOf('<', i)
          const close = text.indexOf('>', i)
          const element = open === -1 || close === -1 ? '' : text.slice(open, close + 1)
          if (!/aria-label|aria-labelledby/.test(element)) offenders.push(`${file}: role="${role}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps a tag readable on every tag colour, including the ones nobody would choose', () => {
    // A tag's colour comes from the palette, from board settings, or from whatever somebody typed
    // into the field — so the soft chip cannot assume a sensible hue. These are the cases that
    // break a formula which assumed a mid-tone: white and yellow are both far too light to carry
    // their own words, and each has to be taken down until it can.
    for (const hex of [...TAG_PALETTE, '#ffffff', '#ffff00', '#000000']) {
      const { background, color } = softChipColors(hex)
      expect(contrastRatio(color, background), hex).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
    }
    // …and it is the soft one: a wash, not the solid ground `chipColors` gives the same colour.
    expect(softChipColors('#f43f5e').background).not.toBe(chipColors('#f43f5e').background)
  })

  it('keeps a chip readable on any colour at all, and prefers white on a strong one', () => {
    // The walk down to white is a rule about every colour, not about this palette — a board can be
    // given any colour somebody likes — so the guard is the whole space, sampled.
    const offenders: string[] = []
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
          const { background, color } = chipColors(hex)
          if (contrastRatio(color, background) < CONTRAST_FLOOR) offenders.push(`${hex} → ${color} on ${background}`)
        }
      }
    }
    expect(offenders.slice(0, 5)).toEqual([])

    // The case that started this: near-black on sky-500 measured 6:1 and still read badly, because
    // a blue ground and black words cannot be focused at the same distance. A strong colour takes
    // white, and the ground gives way to get it.
    expect(chipColors('#0ea5e9').color).toBe('#ffffff')
    expect(chipColors('#0ea5e9').background).not.toBe('#0ea5e9')
    expect(chipColors('#f59e0b').color).toBe('#ffffff')
    // A pale one keeps its own ground, because the price of white is the colour itself.
    expect(chipColors('#ffff00').color).not.toBe('#ffffff')
    expect(chipColors('#ffff00').background).toBe('#ffff00')
  })

  it('keeps a type chip readable on every type colour', () => {
    // White on sky-500 is 2.8:1 and on amber-500 it is 2.2:1 — the chips were picked by a
    // brightness guess rather than by contrast, and the guess was wrong for both.
    for (const type of createFixture().issueTypes) {
      const { background, color } = chipColors(type.color)
      expect(contrastRatio(color, background), `${type.name} ${type.color}`).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
    }
  })
})
