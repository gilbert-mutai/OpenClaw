# OpenClaw WhatsApp Agent - Setup Runbook

This runbook tracks the exact step-by-step setup on Ubuntu VM for OpenClaw (Baileys + Mattermost).

## Current Status

- [x] Step 1: Provision VM and verify OS/resources
- [x] Step 2: Update OS + install base tools + configure firewall
- [x] Step 3: Install Node.js 20 LTS + PM2
- [x] Step 4: Clone repository to `/opt/openclaw/app`
- [x] Step 5: Initialize Node project + install dependencies
- [x] Step 6: Create application files and environment config
- [x] Step 7: Start app and pair WhatsApp (QR)
- [ ] Step 8: Configure OpenClaw hooks and Mattermost channel (IN PROGRESS)
- [ ] Step 9: Configure PM2 startup and persistence
- [ ] Step 10: Validation tests and production readiness checks

---

## Step 1 - VM Provision and Access

### Commands used
```bash
ssh root@41.242.3.3
lsb_release -a
uname -a
df -h
free -h
```

### Expected
- Ubuntu 22.04 or 24.04
- At least 2 vCPU / 4GB RAM / ~40GB disk

---

## Step 2 - OS Update and Firewall

### Commands used
```bash
apt update
apt upgrade -y
apt install -y curl git ufw ca-certificates gnupg
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

### Expected
- Firewall active with `OpenSSH`, `80/tcp`, `443/tcp` allowed

---

## Step 3 - Node.js and PM2

### Commands used
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2
node -v
npm -v
pm2 -v
```

### Expected
- `node -v` returns `v20.x`
- PM2 installed and running

---

## Step 4 - Clone OpenClaw Repo

### Commands used
```bash
mkdir -p /opt/openclaw && cd /opt/openclaw
git clone https://github.com/gilbert-mutai/OpenClaw.git app
cd app
ls -la
```

### Expected
- Repo available at `/opt/openclaw/app`
- `README.md` visible

---

## Step 5 - Initialize Node App + Dependencies

### Commands used
```bash
cd /opt/openclaw/app
npm init -y
npm install @whiskeysockets/baileys axios dotenv express pino qrcode-terminal
npm install -D nodemon
cat package.json
```

### Expected
Dependencies include:
- `@whiskeysockets/baileys`
- `express`
- `axios`
- `dotenv`

---

## Step 6 - Create App Files

We will create these files next:

- `src/index.js` - app bootstrap + health server
- `src/whatsapp/client.js` - Baileys connection + message listener
- `src/mattermost/notifier.js` - send escalation message
- `src/templates/messages.js` - WhatsApp ack + Mattermost text templates
- `.env.example` - all environment variables
- `.gitignore` - protect auth/session/secrets

---

## Required Environment Variables (for `.env`)

```env
PORT=3000
NODE_ENV=development

# WhatsApp
WHATSAPP_SESSION_DIR=.auth
WHATSAPP_ACK_FALLBACK_NAME=there

# OpenClaw hook
OPENCLAW_HOOK_URL=http://127.0.0.1:18789/hooks/agent
OPENCLAW_HOOK_TOKEN=

# OpenClaw Mattermost channel
OPENCLAW_MATTERMOST_CHANNEL_ID=
MATTERMOST_ONCALL_TAG=@here

# App behavior
AUTO_REPLY_ENABLED=true
ESCALATION_ENABLED=true
```

---

## Notes and Decisions

- MVP integration: Baileys -> OpenClaw hook -> Mattermost channel plugin
- Dev target: separate development Mattermost channel
- Client greeting name source: WhatsApp profile/contact display name
- Fallback greeting: generic greeting when name is unavailable

---

## Change Log

- 2026-02-12: Runbook created and Steps 1-5 documented.
- 2026-02-13: Step 6 completed (app files and env set on VM).
- 2026-02-13: Step 7 completed (WhatsApp paired, auto-reply and Mattermost escalation verified).
