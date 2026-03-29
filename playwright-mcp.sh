#!/bin/bash
export PLAYWRIGHT_CHROMIUM_ARGS="--no-sandbox --disable-setuid-sandbox"
exec npx @playwright/mcp@latest --headless --no-sandbox "$@"
