# How we work: Julio + Claude + DeepSeek

```
Claude writes a task ──► Claude starts a worker ─────────► the worker does it and writes its Report
        ▲                                                                     │
        └──── Claude reviews and writes its Review ◄──────────────────────────┘
                          │
                          ├─ approved ──► Claude merges
                          └─ changes requested ──► Claude sends the worker a new round
```

## Files

| File | Written by | Purpose |
|---|---|---|
| `../AGENTS.md` | Claude | Rules every worker follows. OpenCode loads it automatically. |
| `BOARD.md` | Claude | Every task and its status |
| `TEMPLATE.md` | Claude | Template for new tasks |
| `T-XXXX-name.md` | Spec: Claude · Report: worker · Review: Claude | One task, start to finish |

## Task statuses

`planned` → `todo` → `in-progress` → `review` → `approved` → `merged`

A task can also be:
- `blocked`: the worker needs a decision, written in its Report.
- `changes-requested`: Claude's review found problems.

## Starting a worker (Julio)

Each task gets its own git worktree, so several workers can run in parallel without touching each other's files:

```bash
# from the repo root: create the task's branch in a separate folder
git worktree add ../zilar-T-0001 -b task/T-0001-monorepo

cd ../zilar-T-0001

# Option 1 (safer): the interactive OpenCode app. It asks you before risky commands.
opencode -m deepseek/deepseek-v4-pro
#   then type: Do the task in work/T-0001-monorepo.md. Follow AGENTS.md.

# Option 2 (hands-off): headless run. --auto approves every command, so only use it inside a container.
opencode run -m deepseek/deepseek-v4-pro --auto "Do the task in work/T-0001-monorepo.md. Follow AGENTS.md."
```

**Which model:**
- `deepseek/deepseek-v4-pro` for normal tasks.
- `deepseek/deepseek-v4-flash` for small, simple ones.

Each task file says which one to use.

## Asking Claude to review

When a task shows `status: review`, open Claude Code in the repo and say `review T-0001`. Claude will:
1. read the Spec, the Report and the diff on the task branch
2. run the checks itself
3. write the Review section with a verdict: approved or changes requested
4. update `BOARD.md`

## Rules of thumb

- **One task per worker.** Two workers never edit the same files. Claude plans the tasks so they don't overlap.
- **If a worker is stuck,** it marks the task `blocked` and writes a question. Bring it to Claude.
- **Merges happen only after an approved review.** Claude merges when its review finds no problems, bugs or open questions.
