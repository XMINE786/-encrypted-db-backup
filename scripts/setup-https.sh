#!/usr/bin/env bash
# Set up HTTPS for DevGems on the LAN via mkcert + Caddy.
# Run with: sudo bash scripts/setup-https.sh
set -euo pipefail

IP="172.16.242.238"
CERT_DIR="/etc/caddy/certs"

# The invoking (non-root) user, so mkcert installs the CA into *their* trust store too.
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"

echo "==> Installing dependencies"
apt-get update
apt-get install -y libnss3-tools wget curl debian-keyring debian-archive-keyring apt-transport-https

echo "==> Installing mkcert (if missing)"
if ! command -v mkcert >/dev/null 2>&1; then
  wget -qO /usr/local/bin/mkcert \
    "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
  chmod +x /usr/local/bin/mkcert
fi
mkcert -version

echo "==> Installing Caddy (if missing)"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
caddy version

echo "==> Installing mkcert root CA into the system + $REAL_USER trust stores"
# Install into root's store...
mkcert -install
# ...and into the invoking user's NSS store (Firefox/Chrome per-user).
sudo -u "$REAL_USER" HOME="$REAL_HOME" mkcert -install || true

echo "==> Generating cert for $IP (+ localhost)"
mkdir -p "$CERT_DIR"
mkcert -cert-file "$CERT_DIR/devgems.pem" \
       -key-file  "$CERT_DIR/devgems-key.pem" \
       "$IP" localhost 127.0.0.1
chown -R caddy:caddy "$CERT_DIR"
chmod 640 "$CERT_DIR"/devgems*.pem

echo "==> Writing /etc/caddy/Caddyfile"
cat > /etc/caddy/Caddyfile <<EOF
https://$IP {
	tls $CERT_DIR/devgems.pem $CERT_DIR/devgems-key.pem
	reverse_proxy 127.0.0.1:3000
}
EOF

echo "==> Restarting Caddy"
systemctl enable --now caddy
systemctl restart caddy
sleep 1
systemctl --no-pager status caddy | head -n 8

echo
echo "Done. Make sure DevGems is running (next start / next dev on :3000), then open:"
echo "  https://$IP"
echo
echo "On OTHER devices (phones, other laptops) you must also trust the mkcert root CA."
echo "Copy this file to them and import it as a trusted root:"
echo "  $(sudo -u "$REAL_USER" HOME="$REAL_HOME" mkcert -CAROOT)/rootCA.pem"
