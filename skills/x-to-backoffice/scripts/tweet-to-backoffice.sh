#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  echo "Usage: $0 <x.com-url>" >&2
  exit 1
fi

TWEET_URL="$1"

# Use Python to handle the entire flow
python3 - "$TWEET_URL" <<'PYTHON_SCRIPT'
import os
import sys
import json
import urllib.parse
import subprocess

tweet_url = sys.argv[1]

# Extract tweet thread content using bird (JSON format)
# Use npx to run bird if not installed globally
bird_cmd = 'bird'
try:
    subprocess.run(['bird', '--version'], capture_output=True, check=False)
except FileNotFoundError:
    bird_cmd = 'npx @steipete/bird'

# Build bird command with auth credentials from environment
bird_args = [bird_cmd, 'thread', tweet_url, '--json']

# Add auth token if available
if os.getenv('BIRD_AUTH_TOKEN'):
    bird_args.extend(['--auth-token', os.getenv('BIRD_AUTH_TOKEN')])
if os.getenv('BIRD_CT0'):
    bird_args.extend(['--ct0', os.getenv('BIRD_CT0')])

result = subprocess.run(
    bird_args,
    capture_output=True,
    text=True
)

if result.returncode != 0:
    sys.stderr.write(f"Error: Failed to fetch tweet. {result.stderr}\n")
    sys.exit(1)

# Parse JSON
try:
    tweets = json.loads(result.stdout)
except json.JSONDecodeError as e:
    sys.stderr.write(f"Error parsing bird JSON output: {e}\n")
    sys.stderr.write(f"Output was: {result.stdout[:500]}...\n")
    sys.exit(1)

if not tweets:
    sys.stderr.write("No tweets found in response\n")
    sys.exit(1)

# Build markdown from tweet thread
markdown_lines = []
for i, tweet in enumerate(tweets):
    text = tweet.get('text', '')
    username = tweet.get('author', {}).get('username', 'unknown')
    name = tweet.get('author', {}).get('name', 'Unknown')
    created_at = tweet.get('createdAt', '')
    tweet_id = tweet.get('id', '')

    # Header
    header = f"@{username} ({name})"
    if created_at:
        header += f" • {created_at}"

    # Quote level for replies
    quote_prefix = "> " * i

    markdown_lines.append(f"{quote_prefix}**{header}**")
    markdown_lines.append(f"{quote_prefix}")

    if text:
        formatted_text = text.replace('\n', f"  \n{quote_prefix}")
        markdown_lines.append(f"{quote_prefix}{formatted_text}")
    else:
        markdown_lines.append(f"{quote_prefix}*[Media or other content]*")

    markdown_lines.append(f"{quote_prefix}")
    markdown_lines.append(f"{quote_prefix}Link: https://x.com/{username}/status/{tweet_id}")

markdown = "\n".join(markdown_lines)

# URL encode both parameters
encoded_url = urllib.parse.quote(tweet_url)
encoded_content = urllib.parse.quote(markdown)

# Output the backoffice URL with both url= and mdcontent= parameters
print(f"https://backoffice.oltre.dev/create?url={encoded_url}&mdcontent={encoded_content}")

PYTHON_SCRIPT
