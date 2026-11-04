import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMELINE_ZOOM,
  isTimelineZoom,
  TIMELINE_DAY_PX,
  TIMELINE_ZOOM_LABELS,
  TIMELINE_ZOOMS,
  timelineZoomParam,
  zoomIn,
  zoomOut,
  type TimelineZoom,
} from './timelineZoom'

describe('the timeline’s zoom', () => {
  it('offers three steps, narrowest first', () => {
    expect(TIMELINE_ZOOMS).toEqual(['compact', 'normal', 'wide'])
    // The control reads them in order and calls each by a word a person chooses.
    expect(TIMELINE_ZOOMS.map((zoom) => TIMELINE_ZOOM_LABELS[zoom])).toEqual(['Compact', 'Normal', 'Wide'])
  })

  it('draws a day wider at every step', () => {
    const widths = TIMELINE_ZOOMS.map((zoom) => TIMELINE_DAY_PX[zoom])
    expect(widths).toEqual([...widths].sort((a, b) => a - b))
    expect(new Set(widths).size).toBe(widths.length)
  })

  it('leaves a fresh visit and every existing link at the width they already had', () => {
    expect(DEFAULT_TIMELINE_ZOOM).toBe('normal')
    expect(TIMELINE_DAY_PX[DEFAULT_TIMELINE_ZOOM]).toBe(28)
  })

  it('keeps the narrowest step legible: two digits at the tick row’s size fit a day, with air', () => {
    // `text-micro` sets the tick row's numbers; two digits are about twelve pixels, and the scale
    // has nothing smaller. The column has to hold them *with room* — at sixteen they touched their
    // neighbours — so twenty is the floor. This is also why a "whole year" step does not exist:
    // the chart would have to drop numbers to draw one.
    const narrowest = Math.min(...TIMELINE_ZOOMS.map((zoom) => TIMELINE_DAY_PX[zoom]))
    expect(narrowest).toBeGreaterThanOrEqual(20)
    // …and it is still narrower than the default, or it is not a zoom-out at all.
    expect(narrowest).toBeLessThan(TIMELINE_DAY_PX[DEFAULT_TIMELINE_ZOOM])
  })

  it('steps in and out, and stops at the ends', () => {
    expect(zoomIn('compact')).toBe('normal')
    expect(zoomIn('normal')).toBe('wide')
    // The widest step is the last: asking for more returns the same step, so a disabled control and
    // a held key cannot invent a fourth.
    expect(zoomIn('wide')).toBe('wide')
    expect(zoomOut('wide')).toBe('normal')
    expect(zoomOut('normal')).toBe('compact')
    expect(zoomOut('compact')).toBe('compact')
  })

  it('accepts only the steps this build understands, from a URL or a control', () => {
    for (const zoom of TIMELINE_ZOOMS) expect(isTimelineZoom(zoom)).toBe(true)
    expect(isTimelineZoom('year')).toBe(false)
    expect(isTimelineZoom('')).toBe(false)
    expect(isTimelineZoom(28)).toBe(false)
    expect(isTimelineZoom(undefined)).toBe(false)
    expect(isTimelineZoom(null)).toBe(false)
  })

  it('writes a step as the word the URL uses', () => {
    for (const zoom of TIMELINE_ZOOMS) expect(timelineZoomParam(zoom)).toBe(zoom)
  })

  it('round-trips every step through a URL parameter', () => {
    for (const zoom of TIMELINE_ZOOMS as readonly TimelineZoom[]) {
      const param = timelineZoomParam(zoom)
      expect(isTimelineZoom(param)).toBe(true)
      expect(param).toBe(zoom)
    }
  })
})
