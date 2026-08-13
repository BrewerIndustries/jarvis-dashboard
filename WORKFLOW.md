# How ideas, backlog, and projects flow

The everyday system for the whole constellation. **Most work here is ad-hoc / seat-of-the-pants,
and this is the lightweight default** — no ceremony required. There are three stages, and each one
lives in exactly one place, so nothing is tracked twice.

> **Idea** (no repo yet) → **Project** (has a repo/deploy) → and *within* a project, **Tasks**.

## 1. Ideas → the **Idea Log**  (idea-log.dabrewer.dev)

Anything that isn't a project yet: sparks, game concepts, app ideas, cross-cutting notes. Stages:

- **seed** → **exploring** → **graduated** (or **shelved**)

When an idea becomes a real project, mark it **graduated** and set its **repo** — the card then links
to that repo and the Idea Log stops tracking its status (the Dashboard takes over). Idea Log only
covers the *pre-project* life; it deliberately doesn't have "building/shipped" stages anymore.

## 2. Projects → the **Dashboard**  (this app, auto from each repo's `.jarvis.json`)

Once something has a repo/deploy, the **Dashboard is the single source of its status** —
`live` / `in_progress` / `mothballed`, from `status` in `.jarvis.json`. Don't track project status
anywhere else (not in the Idea Log, not in a doc).

## 3. Tasks → the repo's **`BACKLOG.md`**

Concrete to-dos for an existing project are `- [ ]` checkboxes in a **`BACKLOG.md` at the repo root**.
The Dashboard surfaces the open count on the project's card. **One convention** — use `BACKLOG.md`,
not a `## Backlog`/`## TODO` section in the README.

### "Add to the backlog"
Edit the repo's `BACKLOG.md` (or `.jarvis.json`); the Dashboard's cron picks it up within ~15 min.
There is no push inbox.

---

## The optional formal layer: Baseliner

This lifecycle is the **default for everything**. A small number of projects that need **complete
requirements traceability** (e.g. Mosaic) *additionally* use the **Baselining Tool** — attributed
requirement approval (Review), UAT walkthroughs (Validate), and the GOV-\* method (Manual). That is a
heavier discipline layered **on top** of the above, not a replacement for it. **Most projects don't
need Baseliner and shouldn't feel obliged to use it** — `BACKLOG.md` + the Idea Log + the Dashboard is
the normal way we work.
