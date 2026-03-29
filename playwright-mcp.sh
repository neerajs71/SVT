#!/bin/bash
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
exec npx @playwright/mcp@latest --headless --no-sandbox --proxy-server "direct://" "$@"
