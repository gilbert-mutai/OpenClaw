# OpenClaw Alert Agent - Draft Plan

## Goal
Set up OpenClaw on an Ubuntu VM to ingest Uptime Kuma alerts and post concise incident summaries to Mattermost. The bot should tag the owning team, ask who is on call immediately, and post follow-ups with frequency and last-incident context.

## Target Behavior
- Post an incident summary immediately when an alert starts.
- Tag the owning team (example: @infra).
- Ask: "Who is on call?" and "Any mitigation in progress?"
- Post follow-ups at 30/60/120 minutes with updated duration.
- Include frequency (incidents over last N days) and last-incident fix summary.

## Inputs Needed From You
1) Sample Uptime Kuma webhook payload (JSON).
2) Ownership map (monitor name -> team tag).
3) On-call source (PagerDuty, Opsgenie, calendar, or manual list).
4) Mattermost bot details (server URL + bot token).

## Planned Steps
1) Install OpenClaw on Ubuntu VM and run onboarding.
2) Configure Mattermost channel connection.
3) Create a webhook listener skill for Uptime Kuma.
4) Add incident memory tracking (frequency and last-fix summary).
5) Implement follow-up timing logic (30/60/120 min).
6) Validate end-to-end flow with a test alert.

## Example Output (Mattermost)
Title: Uptime Kuma: api-gateway DOWN (1h)
Summary: api-gateway has been down for 60m (last OK at 12:10).
Frequency: 4 incidents in last 7 days; avg downtime 12m.
Last time: Jan 28 - DB pool exhaustion; mitigated by scaling read replicas.
Action: @infra - who is on call? Anything in progress?
Links: runbook, status page, dashboard
