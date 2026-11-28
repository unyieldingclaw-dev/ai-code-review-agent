---
description: Guided first session — interview the user, then fill memory-bank/projectbrief.md and techContext.md for a new project. Only works on files still in their unfilled template state.
---

# /pmb-first-session

Fill in the two Memory Bank files that describe a new project, by asking the user rather than guessing.

## Step 1: Check the files are unfilled

Read `memory-bank/projectbrief.md` and `memory-bank/techContext.md`.

A file is **eligible** only if its frontmatter still contains the exact line `last-reviewed: YYYY-MM-DD`.

- If neither file is eligible, say they already look filled in and stop. Change nothing.
- If only one is eligible, say which one you will skip and why, and work on the other only.
- Never edit a file that is not eligible, even if the user's answers would improve it.

## Step 2: Interview

Ask one question at a time and wait for each answer. Keep it short. If an answer also settles a later question, skip that question.

For `projectbrief.md`:
1. What is this project, and who is it for?
2. What must it always do or never do? These are the hard constraints.
3. What is the first goal?
4. What is deliberately out of scope?

For `techContext.md`:
5. What language, framework and tools are decided so far?
6. How is it run and tested, if that is known yet?
7. Does it have a database, a frontend, external services, or a deployment target?

"I don't know" and "not decided" are good answers. Do not suggest answers to fill a gap.

## Step 3: Show a draft

Show the full proposed text of each file and ask for approval. Make any changes the user asks for. Write nothing until the user approves.

Rules for the draft:
- Delete every section that does not apply. Do not leave empty sections, bracketed placeholders or example text.
- `projectbrief.md` is immutable and the top authority, so it holds only what the user has firmly decided. Keep undecided ideas out of it.
- Put undecided items under a `## Undecided` heading in `techContext.md`, each stated as undecided. Never guess a decision.
- Do not write TODO, TBD, FIXME or FILL IN. `mb doctor` reports those as unfilled placeholders. Use the word "Undecided" instead.
- Keep the YAML frontmatter, and set `last-reviewed` to today's date.
- Replace `**Last Updated**: [Date]` with today's date.

## Step 4: Write and report

After approval, write only the eligible files among those two, and tell the user which files changed. Do not commit, and do not edit any other file.
