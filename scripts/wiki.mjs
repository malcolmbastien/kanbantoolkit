/**
 * The shape of the documentation wiki.
 *
 * The wiki is a *build output* of `docs/`, not a second home for it: every page here names a file
 * in `docs/`, and `scripts/publish-wiki.mjs` renders that file into the wiki's own Markdown. This
 * list is what makes the hub complete — `npm run docs:check` fails when a document has no page, so
 * a page cannot be added to the repository and silently left out of the wiki.
 *
 * `page` is the wiki's page name: one token, because a wiki link is a URL. `note` is the one line
 * the hub and the sidebar cannot say for themselves.
 */

/** @typedef {{ file: string, page: string, note: string, section: 'run' | 'code' | 'project' }} WikiPage */

/** @type {WikiPage[]} */
export const WIKI_PAGES = [
  {
    file: 'README.md',
    page: 'Home',
    note: 'The index, the reading order, and how these pages are kept honest.',
    section: 'run',
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
  {
    file: 'architecture.md',
    page: 'Architecture',
    note: 'The layers, the workspace boundary, and how a request becomes work.',
    section: 'code',
  },
  {
    file: 'server-runtime.md',
    page: 'Runtimes',
    note: 'Worker and Node from one codebase, and the rule that keeps it honest.',
    section: 'code',
  },
  {
    file: 'api.md',
    page: 'API',
    note: 'Every route, what it answers, and how a session is carried.',
    section: 'code',
  },
  {
    file: 'rest-api.md',
    page: 'REST-API',
    note: '`/api/v1`: the supported surface, and the promise that it does not move.',
    section: 'code',
  },
  {
    file: 'mcp.md',
    page: 'MCP',
    note: 'The agent’s door: the tool list, both transports, and the rule it writes by.',
    section: 'code',
  },
  {
    file: 'data-model-v2.md',
    page: 'Data-model',
    note: 'What a workspace is made of.',
    section: 'code',
  },
  {
    file: 'admin.md',
    page: 'Admin',
    note: 'Instance and workspace, the two axes, and the roles each answers.',
    section: 'code',
  },
  {
    file: 'collaboration.md',
    page: 'Collaboration',
    note: 'How two people edit at once without losing a change.',
    section: 'code',
  },
  {
    file: 'public-site.md',
    page: 'Public-site',
    note: 'What the project’s site says, and why each page exists.',
    section: 'code',
  },
  {
    file: 'roadmap.md',
    page: 'Roadmap',
    note: 'What is built, what is next, and what is deliberately not planned.',
    section: 'project',
  },
]

export const SECTION_TITLES = {
  run: 'Install and run it',
  code: 'Read the code',
  project: 'The project',
}
