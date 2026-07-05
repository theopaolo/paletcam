---
description: Commit current work and push to pwa/preprod for phone testing
---

Ship the current work to preprod so I can test on my phone:

1. Run `git status` and `git diff` to review what changed. If there is nothing to commit and nothing unpushed, say so and stop.
2. If source files changed (`src/`, `public/`, `scripts/`), run `bun run test`. If tests fail, show the failures and stop — do not commit broken work unless I explicitly said to.
3. Stage the relevant files (not unrelated strays), write a commit message in the repo style: lowercase `feat:`/`fix:`/`chore:`/`docs:` prefix, short imperative subject.
4. Commit and push to `origin pwa/preprod`.
5. Confirm the push and remind me to test on the phone. If extra context applies (e.g. a debug flag to enable), mention it.

$ARGUMENTS
