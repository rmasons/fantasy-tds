# Branching, review & deployment

## Environments

```
feature/*  ──PR──▶  dev  ──PR──▶  test  ──PR──▶  main (prod)
            advisory        BLOCKING        BLOCKING
            review          review          review
```

| Branch | Purpose | Vercel environment |
|--------|---------|--------------------|
| `dev`  | Integration — features land here first | dev branch deploy (`…-git-dev-…`) |
| `test` | QA / staging — promote here to review & test | **dedicated `test` environment** (see below) |
| `main` | Production | Production |

## Review gates

- **feature → dev** — [`claude-code-review.yml`](../.github/workflows/claude-code-review.yml).
  Advisory only: posts comments, never blocks. Keeps iteration fast.
- **dev → test** and **test → main** — [`promotion-review.yml`](../.github/workflows/promotion-review.yml).
  **Blocking.** A fresh-context Claude review of the promotion diff. If it raises
  **any** substantive finding (correctness, security, data integrity, error
  handling, real edge cases) the `promotion-review` check **fails**, and branch
  protection prevents the merge. Style/nitpick/opinion items are explicitly out
  of scope and do not block.

Both promotions also still run **`verify`** (typecheck + tests + build) from
[`ci.yml`](../.github/workflows/ci.yml).

### There is no in-flow override
By design, a blocked promotion can only proceed by **fixing the issue and
pushing** (which re-runs the review) or refining until the review returns `pass`.
Branch protection is admin-enforced, so even admins cannot click "merge anyway".

**If the review wedges on a genuine false positive**, the escape hatch is to
*temporarily* relax protection, merge, then restore it:

```sh
# Temporarily drop the required check on `test` (or `main`)…
gh api -X DELETE repos/rmasons/fantasy-tds/branches/test/protection/required_status_checks/contexts \
  -f 'contexts[]=promotion-review'
# …merge the PR, then re-add it:
gh api -X POST repos/rmasons/fantasy-tds/branches/test/protection/required_status_checks/contexts \
  -f 'contexts[]=promotion-review'
```

## How to promote

1. **dev → test:** open a PR `dev → test`. Wait for `promotion-review` + `verify`
   to pass. QA the change on the **test** environment.
2. **test → main:** open a PR `test → main`. Same blocking gate runs again as the
   final pre-prod check. Merge to ship.

## Vercel: set up the `test` environment

The `test` branch deploys automatically, but for a real staging tier configure a
dedicated environment in the Vercel dashboard:

1. **Project → Settings → Environments** → add a custom environment named `test`.
2. Map it to the **`test`** git branch.
3. Add its **environment variables** (copy from Production, point at any staging
   Firebase project / Upstash instance you want isolated).
4. (Optional) attach a stable domain, e.g. `test.<your-domain>`.

Production continues to deploy from `main`; `dev` keeps its standard branch
preview.

## Secrets

The reviews use the `CLAUDE_CODE_OAUTH_TOKEN` repo secret (Mason's Claude
Pro/Max plan) — the same one the original review workflow uses. No new secret is
required.
