---
name: virb
description: Read, search, and manage X/Twitter timelines, threads, lists, and bookmarks using the maintained local Virb client.
metadata: { "openclaw": { "emoji": "🐦", "requires": { "bins": ["node"] } } }
---

# Virb

Use the local client bundled with this skill. Invoke it with `node {baseDir}/run.mjs`.
The globally installed Bird client uses an older GraphQL implementation.
Cookie credentials are supplied through `AUTH_TOKEN` and `CT0` in the sandbox environment.
Keep credential values out of replies and command arguments.

```bash
node {baseDir}/run.mjs --help
node {baseDir}/run.mjs whoami
node {baseDir}/run.mjs read <tweet-url-or-id> --json
node {baseDir}/run.mjs thread <tweet-url-or-id> --json
node {baseDir}/run.mjs search "query" -n 20 --json
node {baseDir}/run.mjs list-timeline <list-id> -n 50 --json
node {baseDir}/run.mjs bookmarks -n 20 --json
```

For the scheduled list scanner, fetch the configured list directly once, then follow its
scoring, daily deduplication, and final-response delivery instructions. Report a failed
list fetch; listing all lists is not a fallback for this workflow.

Use `--help` on the relevant command for pagination, media, or engagement options.
For a stale query-ID error, use `node {baseDir}/run.mjs query-ids --fresh`.
