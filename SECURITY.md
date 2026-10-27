# Security policy

Flowline is self-hosted software: an instance holds one team's work, and the people who run it are
the people responsible for it. This page is about the code — how to report a hole in it, and what
this project does with a report.

## Reporting a vulnerability

**Open an issue** — [the same tracker](https://github.com/malcolmbastien/flowline/issues/new/choose)
as a bug, because a project this size would rather hear about a hole than have a process standing
between the report and the maintainer. Do not test against somebody else's instance: run your own.

If the detail is the dangerous part — a working exploit, a piece of somebody's data — say so in the
first line without the detail, and the maintainer will carry the rest of the conversation somewhere
private before you post it. Credit is yours unless you would rather not have it.

A report is easiest to act on with:

- **the build** — the commit or tag you tested (`git rev-parse HEAD`), and whether it was the
  Worker or the Node entry;
- **the steps** — the smallest sequence that shows the problem, including the request or the click;
- **what it gets** — what an attacker ends up with: read, write, another workspace's work, an
  account, a session;
- **whether it needs a session**, and what role.

## What happens next

- **Two working days** — acknowledgement, from a person.
- **Ten working days** — an assessment: whether it is a vulnerability, what it affects, and roughly
  when a fix can land. If it is not one, the reasoning, in plain words.
- **A fix, or an explanation.** Anything that lets one workspace read or change another's work, or
  takes an account without its owner, is fixed before it is discussed in public.
- **Credit if you want it** — in the release note that carries the fix. Say so in the first
  message; anonymous is fine too.

There is no bug bounty. This is a small project and it pays in gratitude and fixes.

## In scope

- **Sessions** — the cookie, its lifetime, its revocation, and signing out everywhere.
- **Invitations** — a link works once, for the address it was written for, and expires.
- **The workspace seal** — a request that reaches a board, card or account outside its own workspace.
  The workspace is resolved from the session, never from the request.
- **Sign-in** — the provider callback, the state cookie, PKCE, and an address that was not verified.
- **The error endpoint** — what it stores: a message, a stack, a path, the build, the browser. Never
  a query string, never an address.
- **The live channel** — the guard before the upgrade, and the nudge it sends.
- **Static serving** — a path that climbs out of the directory, or an app route that answers
  something it should not.

## Out of scope

- **Your own instance's configuration**: an exposed database file, no TLS, an open port, a
  development switch left on (`AUTH_DEV=1`), or a provider that should have been removed.
- **A missing header that `public/_headers` already sets** — report the file if a page does not
  carry it, not the header's existence.
- **Dependency advisories with no reachable path** through this code. Say which path you think is
  reachable and it becomes in scope.
- **Rate-limit nuisance traffic**, mail flooding, and anything whose only effect is "this will annoy
  an operator".
- **Social engineering**, and physical access to a machine.

## Supported versions

`main`. There are no backports yet: before 1.0 a fix lands on `main`, and the changelog says what it
was. An instance that needs a fix should upgrade — the alternative is a patch you keep.
