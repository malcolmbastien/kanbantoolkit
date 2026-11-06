# Roadmap

The order of the work, and the reason for it. The backlog holds the detail and the requirements; the
task numbers are its own. Each phase below ends with something a person can check, not a percentage.

## Where the project is

Most of the plan is built. An instance is a Node process (or a Cloudflare Worker) with one SQLite file or
a D1 database, and a browser holds a cache of the workspace. The pieces that make that work are:

- **The board.** Boards with several cards flows, the initiatives flow, rollups, the archive, templates,
  filters, the timeline, flow metrics and the strategy map (177 and earlier).
- **The server.** One Hono app shared by both runtimes, with a `Database` interface over D1 and a SQLite
  file (129, 118).
- **Sign-in.** An operator's OIDC issuer, a password, or a magic link, with invitations and roles (154).
- **Collaboration.** The workspace has members and roles (122). A card's editing lease and the revision
  check are in place (120, 121, 115).
- **Operations.** Backups, with a restore that has been run (119). Docker, Compose and the published image
  (128). The site, the privacy and security pages, and the support address (150, 151, 157, 159, 160).
- **Quality.** The end-to-end suite (124), the accessibility work (125), and the deploy and error reporting
  (106, 107).

## What was cancelled

Planned, then dropped.

- **Paid plans, billing and the merchant of record** (153, 155, 156, 161). The project is free software that
  you run yourself. There is no plan to buy.
- **Read-only board sharing** (123). Cancelled before it was built.
- **Board-level history** (127). A card can sit on several boards, so its history belongs to the card. The
  card's History tab is that record.
- **The home-page rewrite and the help pages** (152, 158). The current site covers the same ground.

## Deferred

- **One permanent origin** (104). Deferred. Testers still use a temporary address, and the move to a
  permanent one waits for the real domain.
- **Usage analytics** (108). Not built. The project does not track people, and self-hosted instances must
  never report anything.

## What is left

The open work is in the backlog. The main items are:

- **The sign-in task title** (117 names Google and Microsoft, but the built form is the operator's own OIDC
  issuer, with a password and a magic link).
- **Field-level presence and takeover notices**, from the collaboration design (`docs/collaboration.md`).

## The order that was followed

The critical path ran from the server shape (129) through identity (117), the workspace move (118),
collaboration (120, 121, 122) and operations (119, 128). Each phase ended with something a person
could test:

1. **A server with one shape.** A Hono app with no bindings, a `Database` interface, a Worker entry and a
   Node entry, and a health check on both. A CI job boots the Node entry.
2. **Identity.** A session, an invitation, and a development identity for local trials.
3. **The workspace on the server.** The browser keeps a cache. Changes go to the server with the revision
   they were based on, queue offline and go in order, and reach other devices through the live channel
   or a poll.
4. **Collaboration.** One person holds a card's content at a time. A refused write keeps the words and says
   what happened. Members have roles.
5. **Operations.** A backup that has been restored, and a container that runs with one volume.

The reason for the order: the first route the app ever had had to be written where a self-hoster could run
it, so the seam came first. Collaboration needs real identity, so identity came before the lease.

## The decision that was made early

The licence is **AGPL-3.0-or-later**, chosen before the repository was opened. Anyone who runs a
modified version for other people over a network must offer them its source.
