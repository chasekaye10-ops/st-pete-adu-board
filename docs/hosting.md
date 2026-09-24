# Cloudflare hosting

The user approved a public GitHub repository. Cloudflare Pages is connected to
`chasekaye10-ops/st-pete-adu-board` and may read that repository to build the site.
Only the generated `site` directory is published. Never configure the repository
root, `input`, or `data` as the build output directory.

## Build settings

- Production branch: `main`
- Framework: None
- Build command: `npm test && npm run test:schedule && npm run typecheck && npm run build`
- Build output directory: `site`
- Node version: 22 (set `NODE_VERSION` if needed)
- The daily schedule was enabled after the first cloud scan was published.

Cloudflare builds on repository commits. The daily GitHub workflow saves validated
state and reports to the repository; verify that its first automated commit
triggers a Cloudflare deployment before declaring automatic publishing enabled.
The manual validation workflow does not publish a site.

## Daily scan activation gates

The scheduled workflow is gated by the GitHub repository variable
`ADU_SCHEDULE_ENABLED=true`. Do not enable it before a successful manual run,
verification of its published output. The workflow explicitly uses `--no-ai` and
does not receive AI API secrets. Daily interpretation is performed in ChatGPT when
the user shares the board link, not through a separately billed model API.
Source failures and unverified listing status must remain visible.

Run at 06:00 America/New_York using two UTC triggers and the checked-in DST guard.
GitHub schedules may be delayed; this is a target time, not an exact-time guarantee.
The renderer defaults to the accepted enabled schedule when Cloudflare has no
`ADU_SCHEDULE_ENABLED` variable. To pause the service, set GitHub's repository
variable and Cloudflare's build variable to `false`, then rebuild the site.
The public last-scan date indicates actual freshness independently of that label.
