---
name: Minitasks
description: File‑system based task management for VSCode projects.
---

# Minitasks

Minitasks is a file‑system based task manager. Tasks are organized into categories (folders) inside the `.minitasks` directory at the project root.

## Directory Structure

```
.minitasks/
├── _config.json          # Global configuration (category order, colors, etc.)
├── _archive/             # Archived tasks
├── Backlog/              # Default category
│   └── YYMMDD-nametask/  # Task folder
│       └── task.md       # Task definition file
├── In progress/
├── Review/
└── Done/
```

## `task.md` File Format

Each task has a `task.md` file with a YAML front‑matter:

```markdown
------
original-category: Backlog
title: Task Name
created-at: 28/01/2026, 18:20:20
author: AuthorName
tags: bug, improvement
------

# Task Name

Detailed description of the task...
```

### Front‑matter Fields

| Field                | Description                                    | Required |
|----------------------|------------------------------------------------|----------|
| `title`              | Task title                                     | Yes      |
| `created-at`         | Creation date (pt‑BR format)                  | Yes      |
| `author`             | Task author (taken from git config)           | Yes      |
| `tags`               | Comma‑separated tags                           | No       |
| `original-category`  | Original category (used when archiving)       | No       |

## Task Operations

### List Tasks

To list all tasks, read the contents of the `.minitasks` directory. Each sub‑directory (except `_archive` and files starting with `_`) is a category.

```bash
ls .minitasks/
```

To list tasks of a specific category:

```bash
ls .minitasks/Backlog/
```

### Read a Task

Read the `task.md` file inside the task's folder:

```bash
cat .minitasks/Backlog/260128-nametask/task.md
```

### Create a Task

1. Create a folder using the format `YYMMDD-normalizedname` inside the desired category.
2. The normalized name must contain only lowercase letters, numbers, hyphens, and underscores.
3. Create the `task.md` file with the appropriate front‑matter.

Creation example:

```bash
mkdir -p .minitasks/Backlog/260128-mynewtask
cat > .minitasks/Backlog/260128-mynewtask/task.md << 'EOF'
------
title: My New Task
created-at: 28/01/2026, 14:30:00
author: CypherPotato
tags: feature
------

# My New Task

Task description here...
EOF
```

### Update Status (Move to Another Category)

To move a task between categories, move the entire task folder:

```bash
mv .minitasks/Backlog/260128-mynewtask .minitasks/"In progress"/
```

### Archive a Task

1. Before moving, add `original-category` to the front‑matter.
2. Move the folder to `_archive`.

```bash
mv .minitasks/Done/260128-mynewtask .minitasks/_archive/
```

### Restore an Archived Task

1. Read the `original-category` field from the front‑matter.
2. Move the folder back to the original category.

```bash
mv .minitasks/_archive/260128-mynewtask .minitasks/Backlog/
```

## Best Practices

1. **Always use the correct date format** in the folder name: `YYMMDD`.
2. **Normalize names** by removing special characters and accents.
3. **Keep tags consistent** to simplify filtering.
4. **Add `original-category`** before archiving to allow proper restoration.
5. **Use the content after the front‑matter** to detail the task with markdown.
