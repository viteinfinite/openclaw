---
name: x-to-backoffice
description: Auto-convert X/Tweet URLs to backoffice.oltre.dev markdown creation links
homepage: https://backoffice.oltre.dev
metadata:
  {
    "openclaw":
      {
        "emoji": "🐦",
        "requires": { "bins": ["bird"] },
      },
  }
---

# X to Backoffice

Convert X/Tweet URLs to backoffice.oltre.dev markdown creation links.

## Command

```bash
/x-to-backoffice <x-url>
```

## Example

**User sends:**
> /x-to-backoffice https://x.com/elonmusk/status/123456789

**Skill responds:**
> https://backoffice.oltre.dev/create?url=https%3A//x.com/elonmusk/status/123456789&mdcontent=%40elonmusk%3A%20Tweet%20content...

## Behavior

**IMPORTANT**: Return ONLY the backoffice URL. No preamble, no explanation, no additional text. The output should be the raw URL string only.

## How It Works

1. Extracts tweet thread content using `bird thread <url> --json`
2. Parses JSON to extract tweet text and metadata
3. Formats as markdown with quoted replies
4. URL-encodes both the original URL and markdown content
5. Returns: `https://backoffice.oltre.dev/create?url=<encoded_url>&mdcontent=<encoded_markdown>`

## Implementation

```bash
{baseDir}/scripts/tweet-to-backoffice.sh "<url>"
```
