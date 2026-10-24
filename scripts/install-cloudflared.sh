#!/usr/bin/env bash
# Installs Cloudflare's cloudflared into ~/.local/bin without sudo, from the
# official GitHub release, after checking it against the published SHA-256.
set -euo pipefail
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
cd "$dir"
rel=$(curl -fsSL https://api.github.com/repos/cloudflare/cloudflared/releases/latest)
tag=$(printf '%s' "$rel" | grep -m1 '"tag_name"' | cut -d'"' -f4)
echo "Latest release: $tag"
curl -fsSL -o cloudflared "https://github.com/cloudflare/cloudflared/releases/download/$tag/cloudflared-linux-amd64"
want=$(printf '%s' "$rel" | grep -o 'cloudflared-linux-amd64: [0-9a-f]\{64\}' | head -1 | cut -d' ' -f2)
got=$(sha256sum cloudflared | cut -d' ' -f1)
echo "Published SHA-256: ${want:-<not found>}"
echo "Download SHA-256:  $got"
if [ -z "$want" ] || [ "$want" != "$got" ]; then echo "Checksum mismatch or missing; not installing."; exit 1; fi
mkdir -p "$HOME/.local/bin"
install -m 755 cloudflared "$HOME/.local/bin/cloudflared"
"$HOME/.local/bin/cloudflared" --version
