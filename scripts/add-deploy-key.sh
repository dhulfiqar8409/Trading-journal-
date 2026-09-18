#!/usr/bin/env bash
# Creates a dedicated SSH deploy key for Darkpools on this server.
#  - generates a fresh ed25519 key pair in a temporary directory
#  - installs the PUBLIC half into ~/.ssh/authorized_keys
#    (replacing any older darkpools-deploy key, so re-running is safe)
#  - prints the PRIVATE half once so you can store it as a GitHub Actions secret
#  - deletes the private half from this server when the script exits
set -euo pipefail

COMMENT="darkpools-deploy"
SSH_DIR="$HOME/.ssh"
AUTH="$SSH_DIR/authorized_keys"

if ! command -v ssh-keygen >/dev/null 2>&1; then
  echo "ssh-keygen not found. On Ubuntu/Debian run: sudo apt-get install -y openssh-client" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

umask 077
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
touch "$AUTH"
chmod 600 "$AUTH"

ssh-keygen -q -t ed25519 -N "" -C "$COMMENT" -f "$TMP/key"

# Drop any previous darkpools-deploy key so re-running never stacks keys.
grep -v " ${COMMENT}\$" "$AUTH" > "$TMP/authorized_keys" || true
cat "$TMP/key.pub" >> "$TMP/authorized_keys"
cat "$TMP/authorized_keys" > "$AUTH"
chmod 600 "$AUTH"

FP="$(ssh-keygen -lf "$TMP/key.pub" | awk '{print $2}')"

cat <<EOF

Deploy key installed for user "$(whoami)" on $(hostname).
Fingerprint: $FP
Public key:  $(cat "$TMP/key.pub")

Now copy the PRIVATE key below (every line from BEGIN to END, inclusive)
and save it in GitHub:
  Repo -> Settings -> Secrets and variables -> Actions
  -> New repository secret -> Name: SSH_PRIVATE_KEY -> Secret: paste it

Do NOT paste the private key into the chat. It is deleted from this server
as soon as this script exits. If you lose it, just run the script again.

================= PRIVATE KEY: START COPYING BELOW =================
EOF
cat "$TMP/key"
echo "================= PRIVATE KEY: STOP COPYING HERE =================="
