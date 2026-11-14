# Importing a board

**Workspace Home → Import board…** (or **Admin → Workspace data**) reads a Trello board export, a
Jira CSV or a plain CSV and creates **one** new board. It never replaces another board, and Cancel
leaves the workspace exactly as it was.

## Trello

In Trello choose **Menu → Print, export and share → Export as JSON**, and choose that file. The
import reads:

- lists → the four stages, with a mapping you can change;
- cards → titles, descriptions, labels, members, checklists and due dates;
- archived cards only if **Include archived cards** is chosen.

Attachments and comments are not imported. A Trello card's **last activity** is used as its created
date, and as the completion date of a done card; both produce a warning so the inference is visible.

## Jira

Export the issues you want as **CSV** with these columns (names are matched case-insensitively):

`Issue key`, `Summary`, `Description`, `Issue Type`, `Status`, `Assignee`, `Labels`, `Created`,
`Resolved`, `Due date`, `Parent`.

The import reads statuses as the source lists, maps issue types and people, keeps labels as board
tags, and turns a parent key into the decomposition edge when both rows are imported. Comments,
attachments and issue links are not imported.

## Plain CSV

Choose **Plain CSV** and any spreadsheet export with a header row. The import guesses the usual
column names, then lets you correct every one before it reads the rows:

- **Title** is the only required column.
- **Status** or **List** becomes the source lists that map to the four stages. With no status column,
  cards with a completion date are imported as Done and the rest into Backlog.
- **Description**, **Type**, **Assignee**, **Labels/Tags**, **Created**, **Resolved/Done**,
  **Due date**, **Parent** and **Archived** are optional.
- Several assignees or labels can sit in one cell separated by commas or semicolons.
- A parent is matched by the optional **ID/Key** column; a parent that is not in the file is
  imported at the root with a warning.

Comma, semicolon and tab separated files are read, including quoted fields and newlines inside a
field. A file can hold up to 5,000 rows or 5 MB; the file is parsed in the browser and its bytes are
never uploaded. Dates that cannot be read are warnings, not guesses.

## The mapping step

<img src="img/guide/import-mapping.webp" alt="The Import a board dialog after reading a Trello file: source and file, lists mapped to stages, people mapping and a preview of three cards" width="1000">

*The mapping step: what the source calls a list becomes a stage, a person becomes somebody here, and
the preview says what will be created.*

- **Lists → stages.** Every source list maps to Backlog, Not Started, In Progress or Done. Two
  source lists mapped to the same stage become two **cells** in that column, named after the lists.
- **People.** Each source person can be associated with a person already in this workspace. Anyone
  left as **None** is imported without an assignee, and the preview says how many names were
  unmatched.
- **Types.** Each Jira issue type maps to one of the workspace's card types. A missing or unmatched
  type becomes **None**, and the warning says so.

The preview says how many cards will be created, and lists the warnings — including any people it
could not match — before anything is written.

## What is created

One team board with a **Cards** flow (the four typed columns, split where the mapping needs it) and
the standard **Initiatives** flow. Imported cards carry a log entry naming the source and its key,
readable in History. A used tag is added to the board's own tags; the workspace directory is
unchanged — an import never creates a person.

## What is not

There is no automatic re-import or two-way sync. A whole-workspace JSON restore is a different act,
under [Workspace data](using.md#the-workspace).
