#!/usr/bin/env bash
# Installs forex-signals as a systemd service on a Linux server (Ubuntu/Debian):
# it starts whenever the server boots and restarts if it ever stops.
# Run from anywhere:  bash deploy/install-linux.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE=forex-signals
RUN_USER="${SUDO_USER:-$(whoami)}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.9+ is required. On Ubuntu/Debian:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=9)?0:1)'; then
  echo "Node.js 22.9+ is required; found $(node -v)."
  exit 1
fi

cd "$APP_DIR"
npm ci --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo
  echo "Created $APP_DIR/.env"
  echo "Fill in ANTHROPIC_API_KEY, APP_PASSWORD (and WEBHOOK_SECRET / TELEGRAM_* if you want them),"
  echo "then run this script again:  nano .env && bash deploy/install-linux.sh"
  exit 0
fi

NODE_BIN="$(command -v node)"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<UNIT
[Unit]
Description=forex-signals price-action signals
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN --env-file-if-exists=.env server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now $SERVICE
sleep 3
sudo systemctl --no-pager --lines=0 status $SERVICE || true
echo
sudo journalctl -u $SERVICE -n 8 --no-pager || true
echo
echo "Installed. It now starts with the server. Useful commands:"
echo "  sudo journalctl -u $SERVICE -f      # live log (shows the login if the password was generated)"
echo "  sudo systemctl restart $SERVICE     # after editing .env"
echo "  sudo systemctl disable --now $SERVICE"
