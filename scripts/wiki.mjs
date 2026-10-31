/**
 * The shape of the guide the wiki publishes.
 *
 * The wiki is a *reader's guide* — installing the application, running it, and using the board —
 * not a mirror of everything in `docs/`. The engineering pages (architecture, the API, the data
 * model, the roadmap) stay in the repository, where they are read beside the code and reviewed with
 * it; the guide links to one where a page genuinely needs it.
 *
 * Every entry names a file in `docs/` and the wiki page it becomes. `npm run docs:check` fails when
 * an entry names a file that is gone or when two entries claim one page, so the guide cannot
 * silently point at nothing.
 *
 * `page` is the wiki's page name: one token, because a wiki link is a URL. `note` is the one line
 * the hub and the sidebar cannot say for themselves.
 */

/** @typedef {{ file: string, page: string, note: string, section: 'use' | 'run' }} WikiPage */

/** @type {WikiPage[]} */
export const WIKI_PAGES = [
  {
    file: 'using.md',
    page: 'Using',
    note: 'The board, a card, an initiative, the views, and keeping a copy.',
    section: 'use',
  },
  {
    file: 'board-types.md',
    page: 'Board-types',
    note: 'Team, programme and portfolio boards, and what each one is for.',
    section: 'use',
  },
  {
    file: 'warnings.md',
    page: 'Warnings',
    note: 'Every warning on a card or an initiative, what raised it, and how it clears.',
    section: 'use',
  },
  {
    file: 'install.md',
    page: 'Install',
    note: 'Node 26, three commands, and what the first run writes.',
    section: 'run',
  },
  {
    file: 'configure.md',
    page: 'Configure',
    note: 'Every environment variable, its default, and what an unset one does.',
    section: 'run',
  },
  {
    file: 'identity.md',
    page: 'Identity',
    note: 'Signing in through an issuer, and provisioning people from a directory.',
    section: 'run',
  },
  {
    file: 'tls.md',
    page: 'TLS',
    note: 'The proxy and the headers — the one thing every operator must get right.',
    section: 'run',
  },
  {
    file: 'upgrade.md',
    page: 'Upgrade',
    note: 'What a release does to your database, and how to go back.',
    section: 'run',
  },
  {
    file: 'backup.md',
    page: 'Backup',
    note: 'The copy, the schedule, and the drill that proves it.',
    section: 'run',
  },
  {
    file: 'docker.md',
    page: 'Container',
    note: 'The same path with `docker compose up -d` as the whole install.',
    section: 'run',
  },
]

export const SECTION_TITLES = {
  use: 'Using the application',
  run: 'Install and run it',
}
