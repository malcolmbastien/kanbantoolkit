import { expect, test } from '@playwright/test'
import { cardsIn, dragCardTo, laneRegion } from './support'

/**
 * The first run, on a deployment with no accounts at all (task 154.4).
 *
 * This spec runs against the instance on port 4177, whose database is deleted on every start: there
 * is no other way to be in the one state the first-run surface exists for. It deliberately has no
 * development switch — the first administrator is made with a password, which is the point.
 */

const ORIGIN = 'http://localhost:4177'

// Serial, and never retried: every test here builds on the state the one before it made — one
// administrator, one invitation, one spent link — so a retry would run against a database that has
// already moved. A failure is reported once, against the state it actually met.
test.describe.configure({ mode: 'serial', retries: 0 })
const PASSWORD = 'correct horse battery staple'

test('a fresh instance offers the first administrator, and closes behind them', async ({ page, request }) => {
  // Nothing has signed in, so the only door is the installation.
  expect(await (await request.get(`${ORIGIN}/api/auth/providers`)).json()).toMatchObject({ setup: true })

  await page.goto(`${ORIGIN}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  // The surface says what it is, and there are no default credentials to fall back on.
  await expect(page.getByText('This instance has no accounts yet')).toBeVisible()

  await page.getByLabel('Your name').fill('Ada Lovelace')
  await page.getByLabel('Email address').fill('ada@example.com')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create the administrator' }).click()

  // Signed in, and looking at a workspace that is empty — a fresh deployment has no boards, which is
  // the honest state after an install rather than a demo board seeded behind the administrator's back.
  await expect(page.getByRole('button', { name: /Ada Lovelace/ })).toBeVisible()
  await expect(page.locator('[data-workflow="cards"]')).toHaveCount(0)
  const workspace = await (await page.request.get(`${ORIGIN}/api/workspace`)).json()
  expect(workspace.boards).toEqual([])

  // `page.request` carries this browser's cookie; the `request` fixture is a context of its own.
  const session = await (await page.request.get(`${ORIGIN}/api/auth/session`)).json()
  expect(session.instanceRole).toBe('admin')
  expect(session.workspaces[0].role).toBe('admin')

  // The installation is closed: there is an account now, so there is nothing to set up.
  expect(await (await request.get(`${ORIGIN}/api/auth/providers`)).json()).toMatchObject({ setup: false })

  // And the password it took is the password that signs in, from a browser with no cookie.
  const fresh = await request.post(`${ORIGIN}/api/auth/password`, {
    data: { email: 'ada@example.com', password: PASSWORD },
  })
  expect(fresh.status()).toBe(200)
})

test('the first administrator is offered once, and the instance refuses a second', async ({ request }) => {
  // The previous test created it on this database, and the server outlives the test.
  const again = await request.post(`${ORIGIN}/api/auth/setup`, {
    data: { name: 'Somebody Else', email: 'other@example.com', password: PASSWORD },
  })
  expect(again.status()).toBe(409)
})

test('an invitation is where the second person chooses a password', async ({ page, browser, request }) => {
  // The administrator the first test made, signing in the way the deployment now offers.
  await page.goto(`${ORIGIN}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByLabel('Email address').fill('ada@example.com')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await expect(page.getByRole('button', { name: /Ada Lovelace/ })).toBeVisible()

  // She invites a colleague as a Viewer — the role that reads and comments.
  await page.goto(`${ORIGIN}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  const workspace = page.locator('section').filter({ has: page.getByRole('heading', { name: 'This workspace' }) })
  await workspace.getByPlaceholder('grace@example.com').fill('grace@example.com')
  // The role the invitation grants, chosen before the link is made: the select shows the description
  // with the name, so the match is on the label.
  await workspace.getByRole('combobox', { name: 'As' }).selectOption('viewer')
  await workspace.getByRole('button', { name: 'Make a link' }).click()
  const link = await workspace.getByLabel('Invitation link').inputValue()
  expect(link).toContain('invite=')

  // A browser that has never seen this instance opens it, and is asked for a name and a password
  // rather than sent to an identity provider it does not have.
  const other = await browser.newContext()
  try {
    const guest = await other.newPage()
    await guest.goto(link)
    await expect(guest.getByText('You have been invited to join as')).toBeVisible()
    await guest.getByLabel('Your name').fill('Grace Hopper')
    await guest.getByLabel('Password').fill(PASSWORD)
    await guest.getByRole('button', { name: 'Join' }).click()

    await expect(guest.getByRole('button', { name: /Grace Hopper/ })).toBeVisible()
    const session = await (await guest.request.get(`${ORIGIN}/api/auth/session`)).json()
    expect(session.workspaces[0].role).toBe('viewer')
  } finally {
    await other.close()
  }

  // The link is spent: opening it again says so rather than offering a second account.
  const spent = await request.get(`${ORIGIN}/api/invite/${new URL(link).searchParams.get('invite')}`)
  expect(spent.status()).toBe(410)
})

test('an administrator hands over a reset link, and it sets the password', async ({ page, browser, request }) => {
  // The same administrator, signing in with the password she chose.
  await page.goto(`${ORIGIN}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByLabel('Email address').fill('ada@example.com')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await expect(page.getByRole('button', { name: /Ada Lovelace/ })).toBeVisible()

  await page.goto(`${ORIGIN}/app?view=boards`)
  await page.getByRole('button', { name: /^Admin/ }).click()
  const roster = page.locator('section').filter({ has: page.getByRole('heading', { name: 'This workspace' }) })
  const row = roster.locator('tr', { hasText: 'grace@example.com' })
  await row.getByRole('button', { name: 'Reset' }).click()
  const link = await roster.getByLabel('Invitation link').inputValue()
  expect(link).toContain('link=')

  // The person who forgot their password opens it and chooses a new one — no mail involved, which is
  // the point for a deployment with no relay.
  const other = await browser.newContext()
  try {
    const grace = await other.newPage()
    await grace.goto(link)
    await expect(grace.getByText('Choose the password this account will use')).toBeVisible()
    await grace.getByLabel('New password').fill('another good passphrase')
    await grace.getByRole('button', { name: 'Save the password' }).click()
    await expect(grace.getByRole('button', { name: /Grace Hopper/ })).toBeVisible()
  } finally {
    await other.close()
  }

  // The new password is the one that works, and the link is spent.
  const signedIn = await request.post(`${ORIGIN}/api/auth/password`, {
    data: { email: 'grace@example.com', password: 'another good passphrase' },
  })
  expect(signedIn.status()).toBe(200)
  const spent = await request.post(`${ORIGIN}/api/auth/link/${new URL(link).searchParams.get('link')}`)
  expect(spent.status()).toBe(410)
})

test('a Viewer reads the board, and is offered nothing that would refuse', async ({ page, browser, request }) => {
  // The administrator puts a workspace on the server: the copy the app offers when the account has
  // nothing and the browser has boards. (Board structure travels by import; cards travel one by one.)
  await page.goto(`${ORIGIN}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByLabel('Email address').fill('ada@example.com')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await expect(page.getByRole('button', { name: /Ada Lovelace/ })).toBeVisible()

  await page.getByRole('button', { name: 'Copy to account' }).click()
  await page.getByRole('button', { name: 'Copy workspace' }).click()
  await expect(page.getByRole('button', { name: 'Copy to account' })).toHaveCount(0)
  const stored = await (await page.request.get(`${ORIGIN}/api/workspace`)).json()
  expect(stored.boards.length).toBeGreaterThan(0)

  const other = await browser.newContext()
  let note = ''
  try {
    const grace = await other.newPage()
    await grace.goto(`${ORIGIN}/app`)
    await grace.getByRole('button', { name: 'Sign in', exact: true }).click()
    await grace.getByLabel('Email address').fill('grace@example.com')
    await grace.getByLabel('Password').fill('another good passphrase')
    await grace.getByRole('button', { name: 'Sign in', exact: true }).last().click()
    await expect(grace.getByRole('button', { name: /Grace Hopper/ })).toBeVisible()

    // The workspace home: every board, and no way to make, copy, archive, template or import one.
    await grace.goto(`${ORIGIN}/app?view=boards`)
    await expect(grace.getByRole('button', { name: 'Team Atlas', exact: true })).toBeVisible()
    await expect(grace.getByRole('button', { name: 'New board' })).toHaveCount(0)
    await expect(grace.getByRole('button', { name: /^New template/ })).toHaveCount(0)
    await expect(grace.getByRole('button', { name: /Import/ })).toHaveCount(0)

    // The board itself draws, and the lane's footer — the one way to add work — is not there.
    await grace.getByRole('button', { name: 'Team Atlas', exact: true }).click()
    await expect(grace.locator('[data-workflow="cards"]')).toBeVisible()
    await expect(grace.getByRole('button', { name: 'Add card to Backlog' })).toHaveCount(0)
    await expect(grace.locator('[data-workflow="cards"] [data-card-id]').first()).toBeVisible()

    // A drag lifts nothing: the card the pointer started on is still in the column it was in.
    const backlog = await cardsIn(grace, 'Backlog')
    const done = await laneRegion(grace, 'Done').boundingBox()
    if (!done) throw new Error('The Done column has no box to aim at.')
    await dragCardTo(grace, backlog[0], { x: done.x + done.width / 2, y: done.y + 40 })
    expect(await cardsIn(grace, 'Backlog')).toEqual(backlog)

    // The card opens. Everything that writes is closed, and the panel says why.
    await grace.locator('[data-workflow="cards"] [data-card-id]').first().click()
    const panel = grace.locator('[data-item-panel]')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('You are a Viewer here')).toBeVisible()
    await expect(panel.getByLabel('Title')).toBeDisabled()
    await expect(panel.getByRole('button', { name: /More — duplicate/ })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Mark blocked' })).toHaveCount(0)

    // The one control that is a Viewer's. It reaches the server, which is the half a screenshot
    // cannot show.
    note = 'Read it — looks right to me.'
    await panel.getByLabel('Leave a note').fill(note)
    await panel.getByLabel('Leave a note').press('Enter')
    await panel.getByRole('button', { name: 'Activity' }).click()
    await expect(panel.getByText(note)).toBeVisible()

    // The palette offers the reading verbs and none of the writing ones.
    await grace.keyboard.press('Control+k')
    const palette = grace.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('button', { name: /All boards/ })).toBeVisible()
    await expect(palette.getByRole('button', { name: /New card/ })).toHaveCount(0)
    await expect(palette.getByRole('button', { name: /New initiative/ })).toHaveCount(0)
    await expect(palette.getByRole('button', { name: /Edit board design/ })).toHaveCount(0)
    await expect(palette.getByRole('button', { name: /Board settings/ })).toHaveCount(0)
    await grace.keyboard.press('Escape')
  } finally {
    await other.close()
  }

  // The note is in the card's history on the server, signed by Grace — not merely on her screen.
  const cookie = await cookieFor('grace@example.com', 'another good passphrase')
  const detail = await (await request.get(`${ORIGIN}/api/workspace`, { headers: { cookie } })).json()
  type Entry = { kind: string; note?: string }
  const card = detail.items.find((i: { log?: Entry[] }) =>
    (i.log ?? []).some((e) => e.kind === 'noted' && e.note === note),
  ) as { id: string; rev?: number; title: string } | undefined
  expect(card, 'the note the Viewer left is in the item’s log').toBeTruthy()

  // And the interface and the server agree: a direct write is refused, in the matrix's own words.
  // The comment composer above is the exception the matrix makes, not a hole in it.
  const refused = await request.patch(`${ORIGIN}/api/workspace/items/${card!.id}`, {
    headers: { cookie },
    data: { baseRev: card!.rev ?? 0, item: { ...card, title: 'Changed by a Viewer' } },
  })
  expect(refused.status()).toBe(403)
  expect((await refused.json()).error).toBe('a viewer may not item.write')
})

/** A session cookie for a person, from a context that has none — the API's own door. */
async function cookieFor(email: string, password: string): Promise<string> {
  const response = await fetch(`${ORIGIN}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return (response.headers.get('set-cookie') ?? '').split(';')[0]
}

test('an agent connects itself, and the person approves it in the browser', async ({ page, request }) => {
  // A tool asks for a code: no session, which is exactly what a CLI started from a shell has.
  const asked = (await (
    await request.post(`${ORIGIN}/api/tokens/device`, { data: { name: 'nightly export', scopes: ['boards:read'] } })
  ).json()) as { device_code: string; user_code: string; verification_uri: string }
  expect(asked.verification_uri).toContain(`/app?approve=`)

  // The administrator signs in, and opens the address the tool printed.
  await page.goto(`${ORIGIN}/app`)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByLabel('Email address').fill('ada@example.com')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await expect(page.getByRole('button', { name: /Ada Lovelace/ })).toBeVisible()

  await page.goto(asked.verification_uri)
  const consent = page.getByRole('dialog', { name: 'Approve a tool' })
  await expect(consent).toBeVisible()
  // R10: the screen names the tool, what it will be able to do, and for how long.
  await expect(consent.getByText('nightly export')).toBeVisible()
  await expect(consent.getByText('read boards').first()).toBeVisible()
  await expect(consent.getByText(/90 days/)).toBeVisible()

  await consent.getByRole('button', { name: 'Approve' }).click()
  await expect(consent.getByText(/Approved/)).toBeVisible()

  // The tool's half: the code buys the secret once, and the secret reads.
  const first = await request.post(`${ORIGIN}/api/tokens/device/token`, { data: { device_code: asked.device_code } })
  expect(first.status()).toBe(200)
  const { secret, token } = (await first.json()) as { secret: string; token: { name: string; scopes: string[] } }
  expect(token.scopes).toEqual(['boards:read'])
  expect((await request.get(`${ORIGIN}/api/workspace`, { headers: { authorization: `Bearer ${secret}` } })).status()).toBe(200)
  // …and the code is spent.
  expect(
    (await request.post(`${ORIGIN}/api/tokens/device/token`, { data: { device_code: asked.device_code } })).status(),
  ).toBe(410)

  // It is on her account, listed, and the list carries no secret.
  const listed = await page.request.get(`${ORIGIN}/api/tokens`)
  expect(listed.status()).toBe(200)
  const text = await listed.text()
  expect(text).toContain('nightly export')
  expect(text).not.toContain(secret)
})
