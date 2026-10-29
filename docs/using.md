# Using Kanban Toolkit

This page is the application from the outside — the workspace, a board, a card, an initiative, and
the views that read the same work at another altitude. [Installing it](install.md) is the other half;
nothing here needs a server.

## The workspace

The **Kanban Toolkit** button at the top left returns to **Workspace Home**: every board in the organisation,
grouped by flight level (team, programme, portfolio), with a band filter and a search. **New board**
makes one.

On a browser-only build the browser is the whole workspace — nothing is sent anywhere. On an instance
the boards are shared, and signing in makes the account one of the workspace's people.

The **command palette** (<kbd>Ctrl</kbd>+<kbd>K</kbd>, or <kbd>⌘</kbd>+<kbd>K</kbd>) reaches every
board, card and view, and the verbs that make them. The search field beside it searches every board
by title.

## A board

Every board has four fixed stages: **Backlog**, **Not Started**, **In Progress** and **Done**. The
stage belongs to the column, so a card's status is never a word somebody chose; the shape inside a
stage is the team's. **Edit board** splits a column into cells, renames them, adds a lane, or removes
one — a split cell is still in its stage, the work simply reads more precisely.

A team board carries two workflows. The **cards** workflow is the team's own flow; the
**initiatives** workflow is where the same work is read as outcomes. A programme or portfolio board
aggregates other boards and shows the wider view instead of a cards workflow of its own.

A card is made in a lane's footer (**Add card to …**) or from **Card** in the toolbar. Drag it to
another cell to move it. A column can carry a **WIP limit**; **Settings** decides what a limit does —
tint the column (**visualize**), hold the move until a reason is given (**justify**), or refuse it
(**block**).

The keyboard is a full way in, not a fallback: focus a card and press
<kbd>Shift</kbd>+<kbd>F10</kbd> for its menu — **Move to lane**, **Move earlier**, **Move later**,
**Set parent…** — and <kbd>Enter</kbd> to choose. <kbd>Escape</kbd> closes a panel and gives the focus
back.

## A card

Choose a card to open its panel. **Overview** holds the title, the description (Markdown), status,
priority, type, people, tags and target dates; the creator is recorded and is not editable.
**Hierarchy** shows the parent and the work below. **Activity** is the card's own history — every
move, edit, note and dependency, with who and when.

The checklist holds the card's sub-tasks. A card can wait on another: the waiting state is read from
the two ends, so it clears when the blocker reaches Done — there is nothing to update by hand.
**Mark blocked** records a reason when the work is stopped for something that is not another card.

## Initiatives

An initiative is the unit the wider organisation reads. It has no estimate and no status field: its
status is the rollup of the cards below it, and its percentage is the share of those cards that are
done. Add a card and the number moves, because the work moved.

Its **section** — Backlog, Not Started, In Progress, Done — is derived from that rollup; the **cell**
inside the section is where a person arranged it. Dragging an initiative moves it within its section.
Its parent is set from **Change parent** in the panel or **Set parent…** in the card menu, which is how
a programme's outcome is decomposed into a team's initiative.

## The views

- **Dashboard** — the board's initiatives at a glance.
- **Timeline** — the same initiatives over their target dates.
- **Flow** — lead time, cycle time and throughput for the board.
- **Archive** — work that is done and filed away.

None of these is a second copy: they read the same items, placements and edges.

**My work** is not one of the board's tabs: it is under your name in the top right and opens as a
right-hand drawer beside the board, because it is about the person rather than the board that
happens to be open. The board stays in front; clicking a card replaces the drawer with that card's
item panel on the same side.

Objectives and key results are **not** a global view. They are created and managed from a
**Portfolio** board, whose Strategy map carries them and the initiatives that serve them.

## Keeping a copy

**Admin → Workspace data → Export** downloads the whole workspace as JSON; **Import…** replaces it with a file, after
a confirmation. **Export CSV** on a board writes its cards as a table. On an instance the server holds
the same workspace, and [backup](backup.md) is the operator's copy of it.

Accounts, invitations and roles belong to the instance: they are managed on its **Admin** screen.
[Install](install.md) and [configure](configure.md) are how the application is run in the first place.
