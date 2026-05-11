## Local dev restart

**Terminal 1 — main app:**
```bash
cd /home/gm/Documents/Personal/Projects/OpenClaw-Whatsapp-ERPNext
npm run dev
```

**Terminal 2 — LLM analyzer:**
```bash
cd /home/gm/Documents/Personal/Projects/OpenClaw-Whatsapp-ERPNext/llm-analyzer
npm run dev
```

## Production restart (OC-Agent)

```bash
cd /opt/openclaw/app/
set -a && source .env && set +a
pm2 restart ecosystem.config.js --update-env
pm2 flush openclaw-wa
pm2 logs openclaw-wa --lines 200
```

**Restart individual services:**
```bash
pm2 restart llm-analyzer --update-env
pm2 restart openclaw-wa --update-env
```

**openclaw gateway:**
```bash
systemctl --user restart openclaw-gateway
systemctl --user status openclaw-gateway
```
