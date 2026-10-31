> **Repo-local override.** Extends the installed `om-auto-create-pr` plan publication and phase pushes for this repository.

## Workflow steps 6 and 7: Push (replace commands)

Before publishing the execution plan or any phase, verify that `git branch --show-current` equals the prepared `$BRANCH`; stop on a mismatch or detached HEAD. Validate `$BRANCH` with `git check-ref-format --branch` before pushing:

```bash
git push origin "HEAD:refs/heads/$BRANCH"
```

Use this explicit destination for every push in this workflow, including retries. Follow `AGENTS.md` for push-output checks; stop and report any `Bypassed rule violations` message. Preserve all other base workflow gates, tracker operations, and safety rules.
