# AGENTS.md — Flowline

## Hard rule: no Google, no Firebase

This project must contain **no Google or Firebase services or dependencies** — runtime,
build, or tooling. Do not add Firebase, Firestore, Google Auth, Google Fonts, gstatic
assets, Gemini, Vertex, or `gemini-cli`. The app is a static Vite + React SPA deployed
to Vercel; all state lives in `localStorage`.

Before finishing any task, run:

```bash
grep -rinE 'google|firebase|gemini|gcloud|gstatic|firestore' . \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude=README.md --exclude=AGENTS.md
```

It must return nothing. (`README.md`/`AGENTS.md` mention the rule itself; the PRD/docs
should stay free of service names too.)

## Taskmaster

Task generation is powered by the **OpenCode Go** subscription via a local header-injecting
proxy (see `scripts/opencode-go-proxy.mjs`). Start it before any `task-master` command:

```bash
npm run taskmaster:proxy    # terminal 1
task-master list            # terminal 2
```

- Models: `.taskmaster/config.json` → provider `openai-compatible`, baseURL
  `http://127.0.0.1:8788/v1`.
- Key: `OPENAI_COMPATIBLE_API_KEY` in `.env` (gitignored). Never commit it.
- Scoped PRD: `.taskmaster/docs/prd.md`.

## Conventions

- TypeScript strict; path alias `@/*` → `src/*`.
- Domain logic lives in `src/domain/` and must stay pure and framework-free; it is unit
  tested in `*.test.ts` (`npm test`).
- Levels and dependency state are **derived** — never add a `level` or `depStatus` field.
- Limits default to soft-block with a required, recorded reason.
- Keep the board a projection: `scope ∩ { items where level(item) == resolution }`.

## Commands

```bash
npm run dev      # dev server
npm run build    # typecheck + production build
npm test         # vitest
npm run lint     # oxlint
```
