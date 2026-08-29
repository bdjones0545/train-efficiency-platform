#!/usr/bin/env bash
set -euo pipefail

# Keep post-merge setup deterministic and non-interactive. Database migrations
# remain an explicit privileged operation rather than an automatic hook.
npm ci --no-audit --no-fund
npm run build