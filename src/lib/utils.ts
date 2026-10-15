import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge sorts classes into groups and keeps the last of each. It does not read the
 * theme, so a size it has never heard of — `text-meta` — is taken for a text *colour* and
 * dropped the moment a colour follows it in the same `cn(...)`. That is a silent 12px → 16px,
 * and it is why the cards workflow's WIP counter came out larger than the initiatives
 * workflow's: one is built with `cn` and a stage colour, the other is a plain className.
 *
 * So the scale is declared here. `src/lib/legibility.test.ts` fails if it stops being.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'meta', 'body', 'title', 'heading'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** A fresh id. Lives here so the store and the UI mint ids the same way. */
export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}
