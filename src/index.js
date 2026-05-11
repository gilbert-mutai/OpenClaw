const express = require("express");
const dotenv = require("dotenv");
const { startWhatsAppClient } = require("./whatsapp/client");
const { createMattermostNotifier } = require("./mattermost/notifier");
const { buildEscalationMessage, buildAckMessage } = require("./templates/messages");
const { createERPNextClient } = require("./erpnext/client");
const { createTicketStore } = require("./tickets/store");
const { createTicketService } = require("./tickets/service");

dotenv.config({ override: true });

const port = Number(process.env.PORT || 3000);
const app = express();

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Health server listening on :${port}`);
});

const notifier = createMattermostNotifier({
  baseUrl: process.env.MATTERMOST_BASE_URL,
  botToken: process.env.MATTERMOST_BOT_TOKEN,
  channelId: process.env.MATTERMOST_CHANNEL_ID,
  oncallTag: process.env.MATTERMOST_ONCALL_TAG,
});

const erpnext = createERPNextClient({
  enabled: process.env.ERPNEXT_ENABLED,
  baseUrl: process.env.ERPNEXT_BASE_URL,
  apiKey: process.env.ERPNEXT_API_KEY,
  apiSecret: process.env.ERPNEXT_API_SECRET,
  doctype: process.env.ERPNEXT_DOCTYPE || "Issue",
  clientPhoneField: process.env.ERPNEXT_CLIENT_PHONE_FIELD,
});

(async () => {
  const store = await createTicketStore({
    dbPath: process.env.TICKET_DB_PATH || "./data/tickets.db",
  });

  const ticketService = createTicketService({
    store,
    erpnext,
    timeoutHours: Number(process.env.TICKET_SESSION_TIMEOUT_HOURS || 24),
  });

  await startWhatsAppClient({
    sessionDir: process.env.WHATSAPP_SESSION_DIR || ".auth",
    ackFallbackName: process.env.WHATSAPP_ACK_FALLBACK_NAME || "there",
    autoReplyEnabled: process.env.AUTO_REPLY_ENABLED === "true",
    escalationEnabled: process.env.ESCALATION_ENABLED === "true",
    notifier,
    ticketService,
    buildEscalationMessage,
    buildAckMessage,
  });
})().catch((error) => {
  console.error("Failed to start app", error);
  process.exit(1);
});
