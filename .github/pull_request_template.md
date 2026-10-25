<!--
What changed, and why. One thing per pull request: a branch that fixes a bug and restyles a panel is
two pull requests wearing one hat. CONTRIBUTING.md has the long version.
-->

**What this does**

**Why**

<!-- The reason the obvious alternative was wrong, in a sentence or two. This is the part a reader a
year from now will need. -->

**The test that fails without it**

<!-- A unit test for a rule in src/domain, an e2e for a flow a person performs. -->

**Checks run**

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e` — if it touches a flow a person performs
- [ ] `npm run lint` and `npm run scan`
- [ ] `npm run site:check` — if it touches the site

**Anything an operator needs to know**

<!-- A migration (so: back up first), a new environment variable, a behaviour that moved. If none,
say none. -->
