const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const { analyzeInboundMessage, generateLLMAutoReply, generateEscalationNarrative } = require("../triage/analyzer");

const getMessageText = (message) => {
  if (!message) return "";
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  return "";
};

const extractPhone = (jid = "") => jid.split("@")[0] || jid;

const startWhatsAppClient = async ({
  sessionDir,
  ackFallbackName,
  autoReplyEnabled,
  escalationEnabled,
  notifier,
  ticketService,
  buildEscalationMessage,
  buildAckMessage,
}) => {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: "silent" }),
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) qrcode.generate(qr, { small: true });

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        startWhatsAppClient({
          sessionDir,
          ackFallbackName,
          autoReplyEnabled,
          escalationEnabled,
          notifier,
          ticketService,
          buildEscalationMessage,
          buildAckMessage,
        });
      }
    }
  });

  const processingIds = new Set();

  socket.ev.on("messages.upsert", async (payload) => {
    if (payload.type !== "notify") return;

    for (const message of payload.messages) {
      if (!message.message || message.key.fromMe) continue;
      if (message.key.remoteJid === "status@broadcast") continue;

      const text = getMessageText(message.message).trim();
      if (!text) continue;

      const senderName = message.pushName || ackFallbackName;
      const remoteJid = message.key.remoteJid;
      const phone = extractPhone(remoteJid);
      const messageId = message.key.id || `${remoteJid}-${Date.now()}`;

      if (processingIds.has(messageId)) continue;
      processingIds.add(messageId);
      setTimeout(() => processingIds.delete(messageId), 60000);

      const triage = await analyzeInboundMessage({ text, senderName });

      let ticketResult = null;
      if (ticketService) {
        try {
          ticketResult = await ticketService.handleInbound({
            messageId,
            phone,
            senderName,
            text,
            receivedAt: new Date().toISOString(),
            llmSummary: triage.summary,
            llmSubject: triage.subject || triage.ticketSubject || triage.title || null,
            llmPriority: triage.priority,
          });
        } catch (error) {
          console.error("Ticket handling failed", error?.response?.data || error.message);
        }
      }

      const shouldAck = ticketService ? ticketResult?.shouldAck === true : true;

      if (autoReplyEnabled && shouldAck) {
        const ticketId = ticketResult?.ticketId || null;
        let ackText = await generateLLMAutoReply({ text, senderName, ticketId });
        if (!ackText) {
          ackText = buildAckMessage({ senderName, triage, ticketResult, text });
        }
        await socket.sendMessage(remoteJid, { text: ackText });
      }

      if (escalationEnabled && notifier) {
        const ticketId = ticketResult?.ticketId || null;
        let escalationText = await generateEscalationNarrative({
          text,
          senderName,
          ticketId,
          priority: triage?.priority,
        });
        if (!escalationText) {
          escalationText = buildEscalationMessage({ senderName, text, remoteJid, ticketResult, triage });
        }
        await notifier.send(escalationText);
      }
    }
  });

  return socket;
};

module.exports = { startWhatsAppClient };
