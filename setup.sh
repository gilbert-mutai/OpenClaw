#!/usr/bin/env bash
set -e

APP_DIR="/opt/openclaw/app"
REPO_URL="https://github.com/gilbert-mutai/Whatsapp-ERPNext-Mattermost-Integration-with-OpenClaw.git"

echo "==> Installing Node.js 22 LTS"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "==> Installing pm2 and openclaw globally"
sudo npm install -g pm2 github:openclaw/openclaw

echo "==> Creating app directory"
sudo mkdir -p "$APP_DIR"
sudo chown "$USER:$USER" "$APP_DIR"

echo "==> Cloning repository"
git clone "$REPO_URL" "$APP_DIR"
cd "$APP_DIR"

echo "==> Installing dependencies"
npm install --omit=dev
cd llm-analyzer && npm install --omit=dev && cd ..

echo "==> Creating .env"
cat > "$APP_DIR/.env" << 'ENVEOF'
PORT=3000
NODE_ENV=production

# WhatsApp
WHATSAPP_SESSION_DIR=.auth
WHATSAPP_ACK_FALLBACK_NAME=there

GATEWAY_AUTH_TOKEN=
GATEWAY_TRUSTED_PROXIES=127.0.0.1,::1
AUTO_REPLY_ENABLED=true
ESCALATION_ENABLED=true
OPENCLAW_HOOK_URL=http://127.0.0.1:18789/hooks/agent
OPENCLAW_HOOK_TOKEN=
OPENCLAW_MATTERMOST_CHANNEL_ID=

# ERPNext
ERPNEXT_ENABLED=true
ERPNEXT_BASE_URL=
ERPNEXT_API_KEY=
ERPNEXT_API_SECRET=
ERPNEXT_DOCTYPE=HD Ticket
TICKET_SESSION_TIMEOUT_HOURS=24
TICKET_DB_PATH=./data/tickets.db
NEW_TICKET_COOLDOWN_MINUTES=1440
ERPNEXT_REOPEN_STATUS=Open
ERPNEXT_CLOSED_STATUSES=Closed,Resolved

# LLM
LLM_ANALYZER_URL=http://127.0.0.1:4001/analyze
ISSUE_COMPARE_URL=http://127.0.0.1:4001/compare-issue
ISSUE_COMPARE_MIN_CONFIDENCE=0.75
ISSUE_COMPARE_TIMEOUT_MS=2500
LLM_ANALYZER_TIMEOUT_MS=3000
LLM_MIN_CONFIDENCE=0.65
ERPNEXT_RAISED_BY_EMAIL=
ERPNEXT_SOURCE_MESSAGE_FIELD=

# GitHub Copilot (llm-analyzer)
GITHUB_TOKEN=
LLM_MODEL=gpt-4o-mini
LLM_PORT=4001
ENVEOF

echo ""
echo "==> .env created at $APP_DIR/.env — fill in the blank values before starting:"
echo "    nano $APP_DIR/.env"
echo ""
echo "==> Configuring openclaw gateway"
openclaw config set gateway.mode local
openclaw gateway install
systemctl --user enable openclaw-gateway
systemctl --user start openclaw-gateway

echo ""
echo "==> Setup complete. Next steps:"
echo "    1. Fill in $APP_DIR/.env"
echo "    2. cd $APP_DIR && pm2 start ecosystem.config.js"
echo "    3. pm2 save && pm2 startup  (follow the printed command to enable autostart)"
echo "    4. pm2 logs openclaw-wa     (scan the QR code to link WhatsApp)"
