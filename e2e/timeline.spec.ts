import { expect, test, type Page } from '@playwright/test'

/**
 * The timeline: who is on a block, and how wide a day is drawn.
 *
 * The chart is read-only, so every assertion here is about what a reader can see and how the
 * reading is addressed — the people are on the block, and the zoom is in the link.
 */

const openTimeline = async (page: Page, query = '') => {
  await page.goto(`/app?board=b-atlas&view=timeline${query}`)
  await expect(page.locator('[data-timeline-body]')).toBeVisible()
}

/** The width of one day column, in whole pixels — the axis's own promise about the zoom. */
const dayWidth = async (page: Page): Promise<number> => {
  const box = await page.locator('[data-timeline-day]').first().boundingBox()
  expect(box, 'the axis has day columns').not.toBeNull()
  return Math.round(box!.width)
}

test('a block names its people, and the frozen column keeps to the name', async ({ page }) => {
  await openTimeline(page)

  // The column is the initiative's name and its share of the work — the people belong on the block
  // itself, where the work is drawn. The names still travel in the row's title.
  const row = page.locator('[data-timeline-label-id="init-signup-redesign"]')
  await expect(row).toHaveAttribute('title', /Maya Blake, Riley Kim/)
  await expect(row.locator('[data-timeline-people]')).toHaveCount(0)

  // A milestone has no interior to put a face in, so they follow its title, and the marker's
  // accessible name says them in words rather than leaving a screen reader with initials.
  const marker = page.locator('[data-timeline-milestone-id="init-signup-redesign"]')
  const faces = marker.locator('[data-timeline-people]')
  await expect(faces).toHaveAttribute('aria-label', 'Maya Blake, Riley Kim')
  await expect(marker).toHaveAccessibleName(/Maya Blake, Riley Kim/)

  // The chart has room for a row of faces, so they sit beside each other: an overlap would read as
  // one muddled face at this size, and the two here are two people.
  const [first, second] = await Promise.all([
    faces.locator('> *').nth(0).boundingBox(),
    faces.locator('> *').nth(1).boundingBox(),
  ])
  expect(first, 'the first face is drawn').not.toBeNull()
  expect(second, 'the second face is drawn').not.toBeNull()
  expect(first!.x + first!.width).toBeLessThanOrEqual(second!.x)
})

test('a long block draws its people inside the bar', async ({ page }) => {
  await page.goto('/app?board=b-strategy&view=timeline')
  await expect(page.locator('[data-timeline-body]')).toBeVisible()

  // Recurring revenue engine runs October to March: a bar with room for a title and a face.
  const bar = page.locator('[data-timeline-bar-id="init-revenue"]')
  await expect(bar).toBeVisible()
  await expect(bar.locator('[data-timeline-people]')).toHaveAttribute('aria-label', 'Maya Blake')
  await expect(bar).toHaveAccessibleName(/Maya Blake/)
})

test('the axis zooms, and the zoom is part of the link', async ({ page }) => {
  await openTimeline(page)
  await expect(page.locator('[data-timeline-zoom]')).toHaveText('Normal')
  expect(await dayWidth(page)).toBe(28)

  // Zooming keeps the day under the axis's left edge where it was: 10 days in at 28px is 280px,
  // and at 56px that same day is 560px in.
  const scroller = page.locator('[data-timeline-scroll]')
  await scroller.evaluate((el) => {
    el.scrollLeft = 280
  })

  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.locator('[data-timeline-zoom]')).toHaveText('Wide')
  expect(await dayWidth(page)).toBe(56)
  await expect.poll(() => scroller.evaluate((el) => Math.round(el.scrollLeft))).toBe(560)

  // The widest step is the end of the control, and the link says which reading it is.
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
  await expect(page).toHaveURL(/board=b-atlas&view=timeline&zoom=wide$/)

  // A reload — or the link somebody was sent — lands on the same width.
  await page.reload()
  await expect(page.locator('[data-timeline-body]')).toBeVisible()
  await expect(page.locator('[data-timeline-zoom]')).toHaveText('Wide')
  expect(await dayWidth(page)).toBe(56)

  // All the way out: the narrowest step still prints its days, and the control stops there.
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await expect(page.locator('[data-timeline-zoom]')).toHaveText('Compact')
  expect(await dayWidth(page)).toBe(20)
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  await expect(page).toHaveURL(/zoom=compact$/)

  // Back to the default, and the parameter leaves the link: the shortest true thing to say.
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.locator('[data-timeline-zoom]')).toHaveText('Normal')
  await expect(page).not.toHaveURL(/zoom=/)
})

test('a shared link opens the reading it names, and a width it does not know is dropped', async ({ page }) => {
  await page.goto('/app?board=b-atlas&view=timeline&zoom=compact')
  await expect(page.locator('[data-timeline-body]')).toBeVisible()
  await expect(page.locator('[data-timeline-zoom]')).toHaveText('Compact')
  expect(await dayWidth(page)).toBe(20)

  // A step from another build is not a reading this one can give: the chart opens at the default
  // and the link is normalised, exactly as an unknown view or window is.
  await page.goto('/app?board=b-atlas&view=timeline&zoom=year')
  await expect(page.locator('[data-timeline-body]')).toBeVisible()
  await expect(page.locator('[data-timeline-zoom]')).toHaveText('Normal')
  await expect(page).not.toHaveURL(/zoom=/)
})
