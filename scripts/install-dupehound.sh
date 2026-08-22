#!/usr/bin/env bash
# Download pinned dupehound v0.1.2 for this host into .tools/dupehound.
# Default `code-invariants check` never runs this script (no surprise network).
set -euo pipefail

VERSION="v0.1.2"
REPO="Rafaelpta/dupehound"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.tools/dupehound"

err() {
  echo "error: $1" >&2
  exit 1
}

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin)
    case "$arch" in
      arm64) target="aarch64-apple-darwin" ;;
      x86_64) target="x86_64-apple-darwin" ;;
      *) err "unsupported architecture: $arch" ;;
    esac
    ;;
  Linux)
    case "$arch" in
      aarch64|arm64) target="aarch64-unknown-linux-gnu" ;;
      x86_64) target="x86_64-unknown-linux-gnu" ;;
      *) err "unsupported architecture: $arch" ;;
    esac
    ;;
  *)
    err "unsupported OS: $os. On Windows, download the zip from https://github.com/$REPO/releases/tag/$VERSION"
    ;;
esac

url="https://github.com/$REPO/releases/download/$VERSION/dupehound-$target.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading dupehound $VERSION ($target)..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$tmp/dupehound.tar.gz"
elif command -v wget >/dev/null 2>&1; then
  wget -q "$url" -O "$tmp/dupehound.tar.gz"
else
  err "need curl or wget to download"
fi

tar xzf "$tmp/dupehound.tar.gz" -C "$tmp"
mkdir -p "$(dirname "$DEST")"
install -m 755 "$tmp/dupehound" "$DEST"

echo "Installed $("$DEST" --version) to $DEST"
echo "Use it with:"
echo "  export PATH=\"$ROOT/.tools:\$PATH\""
echo "  # or: export CODE_INVARIANTS_DUPEHOUND=\"$DEST\""
