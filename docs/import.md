# Importing a board

A team arriving with work somewhere else should not rebuild its board by hand. **Workspace Home →
Import board…** (or **Admin → Workspace data**) reads a Trello board export or a Jira CSV and creates
**one** new board. It never replaces another board, and Cancel leaves the workspace exactly as it was.

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

## The mapping step

The source cannot know what its list names mean here, so the dialog asks:

- **Lists → stages.** Every source list maps to Backlog, Not Started, In Progress or Done. Two
  source lists mapped to the same stage become two **cells** in that column, named after the lists,
  so the distinction is kept rather than flattened.
- **People.** Each source person is either an existing person (matched by exact name by default) or
  a new person created by the import.
- **Types.** Each Jira issue type maps to one of the workspace's card types. A missing type falls
  back to the board's default and says so.

The preview says how many cards and people will be created, and lists the warnings before anything
is written.

## What is created

One team board with a **Cards** flow (the four typed columns, split where the mapping needs it) and
the standard **Initiatives** flow. Imported cards carry a log entry naming the source and its key, so
the origin stays readable in Activity. A used tag is added to the board's own tags; a new person is
added to the workspace directory.

## What is not

There is no automatic re-import or two-way sync. An import is a starting point; after it, the board
is the team's own. A whole-workspace JSON restore is a different act, under
[Workspace data](using.md#the-workspace).
