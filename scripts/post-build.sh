#!/usr/bin/env bash
set -euo pipefail

# Ensure 404.html exists for GitHub Pages single-page app fallback
cp dist/index.html dist/404.html