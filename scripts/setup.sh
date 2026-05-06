#!/bin/bash
# Setup local : active les git hooks versionnés.
# À lancer 1 fois après un clone.

set -e
cd "$(dirname "$0")/.."

git config core.hooksPath scripts/hooks
chmod +x scripts/hooks/pre-commit scripts/normalize-page.js

echo "✅ Git hooks activés (scripts/hooks)"
echo "   → pre-commit normalisera auto les index.html staged"
