> **Repo-local override.** Extends the installed `om-auto-create-pr-loop` run-folder publication and subsequent pushes for this repository.

## Workflow step 7 and references/run-folder-layout.md: Push (replace command)

Before publishing the run folder, verify that `git branch --show-current` equals the prepared `$BRANCH`; stop on a mismatch or detached HEAD. Validate `$BRANCH` with `git check-ref-format --branch` before pushing:

```bash
git push origin "HEAD:refs/heads/$BRANCH"
```

Apply the same explicit destination to executor/checkpoint pushes and the final HANDOFF/NOTIFY push in step 13, including retries. Follow `AGENTS.md` for push-output checks; stop and report any `Bypassed rule violations` message. Preserve all other base workflow gates, tracker operations, and safety rules.
