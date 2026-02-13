flowchart LR
  WA[WhatsApp Client] -->|Inbound message| B[Baileys Listener\nNode.js app]
  B -->|Auto-reply| WA
  B -->|POST /hooks/agent| OC[OpenClaw Gateway\nHooks + Copilot]
  OC -->|Summary + @here| MM[Mattermost Channel\nOpenClaw Bot]
  MM -->|Engineer sees alert| ENG[Support Engineer]
  ENG -->|Reply| WA

  subgraph VM[Ubuntu VM]
    B
    OC
  end