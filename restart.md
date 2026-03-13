cd /opt/openclaw/app/
set -a && source .env && set +a
pm2 restart llm-analyzer --update-env
pm2 restart openclaw-wa --update-env
pm2 flush openclaw-wa
pm2 logs openclaw-wa --lines 200
