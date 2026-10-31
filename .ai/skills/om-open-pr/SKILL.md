> **Repo-local override.** Extends the installed `om-open-pr` push step for this repository.

## Workflow step 4: Push (replace command)

Set `BRANCH` to the prepared branch returned by `git branch --show-current`; stop if HEAD is detached. Validate it with `git check-ref-format --branch` before pushing:

```bash
git push origin "HEAD:refs/heads/$BRANCH"
```

Use this explicit destination for every push in this workflow, including retries. Follow `AGENTS.md` for push-output checks; stop and report any `Bypassed rule violations` message. Preserve all other base workflow gates, tracker operations, and safety rules.
