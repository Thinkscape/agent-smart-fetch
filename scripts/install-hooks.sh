#!/bin/bash
# Install git pre-commit hook for defuddle-fetch
set -e

HOOK_DIR="$(git -C "$(dirname "$0")/.." rev-parse --git-dir)/hooks"
HOOK_FILE="$HOOK_DIR/pre-commit"

mkdir -p "$HOOK_DIR"

cat > "$HOOK_FILE" << 'EOF'
#!/bin/bash
# Pre-commit hook: run tests before allowing commit
set -e

echo "🧪 Running pre-commit tests..."
cd "$(git rev-parse --show-toplevel)"
bun run test

echo "✅ All tests passed."
EOF

chmod +x "$HOOK_FILE"
echo "✅ Pre-commit hook installed at $HOOK_FILE"
