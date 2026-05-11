const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const createTicketStore = async ({ dbPath }) => {
  const resolved = path.resolve(dbPath || "./data/tickets.db");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const db = await open({
    filename: resolved,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_sessions (
      phone TEXT PRIMARY KEY,
      open_ticket_id TEXT,
      last_issue_summary TEXT,
      last_activity_at TEXT,
      session_status TEXT NOT NULL DEFAULT 'active',
      last_ticket_created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      received_at TEXT NOT NULL,
      content_key TEXT
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      text TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
  `);

  // Backward-compatible migrations
  try {
    await db.exec(`ALTER TABLE ticket_sessions ADD COLUMN last_ticket_created_at TEXT`);
  } catch (_) {}
  try {
    await db.exec(`ALTER TABLE processed_messages ADD COLUMN content_key TEXT`);
  } catch (_) {}
  try {
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_content_key ON processed_messages(content_key) WHERE content_key IS NOT NULL`);
  } catch (_) {}

  const hasProcessedMessage = async (messageId) => {
    const row = await db.get(
      `SELECT message_id FROM processed_messages WHERE message_id = ?`,
      [messageId]
    );
    return Boolean(row);
  };

  const markProcessedMessage = async ({ messageId, phone, receivedAt }) => {
    await db.run(
      `INSERT OR IGNORE INTO processed_messages (message_id, phone, received_at) VALUES (?, ?, ?)`,
      [messageId, phone, receivedAt]
    );
  };

  // Atomically claims a message for processing. Returns true if this caller
  // is the first to claim it. Deduplicates by both messageId AND content
  // (phone + text + minute) to catch Baileys replaying with different IDs.
  const tryClaimMessage = async ({ messageId, phone, receivedAt, text }) => {
    const minute = (receivedAt || new Date().toISOString()).slice(0, 16);
    const contentKey = `${phone}|${String(text || "").trim().slice(0, 100)}|${minute}`;
    const result = await db.run(
      `INSERT OR IGNORE INTO processed_messages (message_id, phone, received_at, content_key) VALUES (?, ?, ?, ?)`,
      [messageId, phone, receivedAt, contentKey]
    );
    return result.changes === 1;
  };

  const getSession = async (phone) => {
    return db.get(`SELECT * FROM ticket_sessions WHERE phone = ?`, [phone]);
  };

  const upsertSession = async ({
    phone,
    openTicketId,
    lastIssueSummary,
    lastActivityAt,
    sessionStatus = "active",
    lastTicketCreatedAt = null,
  }) => {
    await db.run(
      `INSERT INTO ticket_sessions (
        phone, open_ticket_id, last_issue_summary, last_activity_at, session_status, last_ticket_created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        open_ticket_id = excluded.open_ticket_id,
        last_issue_summary = excluded.last_issue_summary,
        last_activity_at = excluded.last_activity_at,
        session_status = excluded.session_status,
        last_ticket_created_at = COALESCE(excluded.last_ticket_created_at, ticket_sessions.last_ticket_created_at)`,
      [phone, openTicketId, lastIssueSummary, lastActivityAt, sessionStatus, lastTicketCreatedAt]
    );
  };

  const appendClientMessage = async ({ phone, text, receivedAt }) => {
    await db.run(
      `INSERT INTO ticket_messages (phone, text, received_at) VALUES (?, ?, ?)`,
      [phone, String(text || ""), receivedAt]
    );
  };

  const getRecentMessages = async ({ phone, limit = 3 }) => {
    const rows = await db.all(
      `SELECT text, received_at
       FROM ticket_messages
       WHERE phone = ?
       ORDER BY id DESC
       LIMIT ?`,
      [phone, Number(limit)]
    );
    return rows.reverse();
  };

  return {
    hasProcessedMessage,
    markProcessedMessage,
    tryClaimMessage,
    getSession,
    upsertSession,
    appendClientMessage,
    getRecentMessages,
  };
};

module.exports = { createTicketStore };
