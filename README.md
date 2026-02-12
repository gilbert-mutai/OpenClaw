# OpenClaw WhatsApp Support Agent - Implementation Plan

## Goal
Set up OpenClaw on an Ubuntu VM to receive client support requests from WhatsApp, send an immediate acknowledgement to the client, and notify engineers in Mattermost with a concise summary plus an on-call action prompt.

## Decisions Locked
- WhatsApp integration for MVP: Baileys (using a WhatsApp Web session).
- Mattermost environment for MVP: separate development Mattermost deployment.
- Client naming in acknowledgement: use WhatsApp profile/contact display name when available, fallback to phone number.
- Production direction: keep internal interfaces stable so we can later migrate from Baileys to Meta WhatsApp Cloud API or Twilio without large rewrites.

## Target Behavior
- Receive inbound WhatsApp client messages (example: "I have issues with my 3CX, I can't make outbound calls").
- Send a fast acknowledgement to the client on WhatsApp with apology and reassurance.
- Post a summary in Mattermost with the client request details.
- Ask on-call engineers to check WhatsApp and respond to the client quickly.

## End-to-End Flow (MVP)
1) Client sends a WhatsApp message.
2) Baileys receives and normalizes the message into an OpenClaw event.
3) OpenClaw extracts issue summary and customer identity.
4) OpenClaw sends acknowledgement reply on WhatsApp.
5) OpenClaw posts escalation summary to Mattermost dev channel.
6) Engineer replies directly to the client on WhatsApp.

## Message Routing Contracts

### Inbound WhatsApp Event (normalized)
```json
{
	"source": "whatsapp",
	"receivedAt": "2026-02-12T10:15:30Z",
	"conversationId": "wa-2547xxxxxxxx",
	"client": {
		"phone": "+2547xxxxxxxx",
		"displayName": "Jackson"
	},
	"message": {
		"id": "ABCD1234",
		"text": "I have issues with my 3CX, I can't make outbound calls"
	}
}
```

### Internal Incident Summary Object
```json
{
	"ticketId": "OC-2026-0001",
	"channel": "whatsapp",
	"clientName": "Jackson",
	"clientPhone": "+2547xxxxxxxx",
	"issueSummary": "3CX outbound calls failing",
	"rawText": "I have issues with my 3CX, I can't make outbound calls",
	"priority": "high",
	"createdAt": "2026-02-12T10:15:31Z"
}
```

### Mattermost Escalation Payload (concept)
```json
{
	"channel": "dev-support-escalations",
	"title": "New WhatsApp Client Request",
	"body": "Client: Jackson (+2547xxxxxxxx)\\nIssue: 3CX outbound calls failing\\nAction: @oncall please check WhatsApp and respond to the client now.",
	"tags": ["whatsapp", "client-support", "3cx"]
}
```

## WhatsApp Auto-Reply Template
Hello {{client_name}}, I am sorry for what you are facing at the moment. Please note that we have received your request, and one of our engineers will get back to you shortly.

Fallback when no name is available:
Hello, I am sorry for what you are facing at the moment. Please note that we have received your request, and one of our engineers will get back to you shortly.

## Mattermost Escalation Template
Title: New WhatsApp Client Request
Client: {{client_name}} ({{client_phone}})
Issue Summary: {{issue_summary}}
Original Message: "{{raw_text}}"
Action: @oncall please check WhatsApp and respond to the client now.

## Infrastructure Baseline
- VM: Ubuntu 22.04 LTS or 24.04 LTS.
- Starting resources: 2 vCPU, 4 GB RAM, 40 GB disk.
- Runtime: Node.js LTS, process manager (PM2 or systemd), reverse proxy (Nginx or Caddy), TLS certificate.
- Storage: persistent location for Baileys auth/session state and app logs.

## Environments
- Development:
	- OpenClaw on dev VM.
	- Baileys linked to personal/test WhatsApp account.
	- Separate development Mattermost channel/server.
- Production:
	- OpenClaw deployed separately.
	- Team WhatsApp account linked.
	- Production Mattermost channel.
	- Optional migration to official WhatsApp API.

## Testing and Cutover Plan
1) Unit test parsing and template rendering with sample WhatsApp texts.
2) Integration test end-to-end with personal WhatsApp account.
3) Validate Mattermost escalation formatting and @oncall visibility.
4) Pilot with limited real client traffic on team WhatsApp account.
5) Production cutover with rollback plan (disable auto-reply and fallback to manual handling).

## Security and Compliance Controls
- Store secrets in environment variables or secret manager (never in git).
- Restrict inbound webhook/listener access where possible.
- Encrypt VM disk and enable regular backups.
- Mask sensitive client details in logs.
- Add basic audit trail for inbound message, acknowledgement sent, and escalation posted.
- Plan migration from Baileys to official API for stronger production compliance.

## Inputs Needed Before Implementation
1) Mattermost dev details: server URL, bot token, target channel name.
2) On-call routing: static @oncall tag or source of truth (PagerDuty/Opsgenie/schedule file).
3) Name handling fallback preference: "Hello" vs "Hello there" when display name is missing.
4) Final confirmation to use Baileys for MVP with known production risks.

## Planned Steps
1) Install OpenClaw on Ubuntu VM and run onboarding.
2) Set up Baileys session persistence and WhatsApp message listener.
3) Build normalization layer for incoming client messages.
4) Implement acknowledgement template rendering and send reply.
5) Implement Mattermost notifier with escalation template.
6) Add logging, retries, and basic failure handling.
7) Validate end-to-end flow with a real or simulated WhatsApp message.
