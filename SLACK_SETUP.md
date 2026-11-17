# Connecting Jarvis to Slack

Jarvis connects to Slack over **Socket Mode** — no public URL or server needed.
It works even while your PC is on but you're away from it.

## 1. Create a Slack app

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name it `Jarvis`, pick your workspace.

## 2. Add Bot Token Scopes

**OAuth & Permissions → Scopes → Bot Token Scopes**, add:

- `app_mentions:read` — see @jarvis mentions
- `chat:write` — reply in channels
- `im:history`, `im:read`, `im:write` — DM support
- `channels:history`, `groups:history` — read channel messages (optional, for context)

Then **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-…`).

## 3. Enable Socket Mode

**Settings → Socket Mode → Enable**. Slack will ask you to create an
app-level token — name it `socket`, add scope `connections:write`,
generate it, and copy the **App-Level Token** (`xapp-…`).

## 4. Subscribe to events

**Event Subscriptions → Enable Events**, subscribe to bot events:

- `app_mention`
- `message.im`

Reinstall the app if Slack asks.

## 5. Configure Jarvis

Either paste the tokens in the app: **Settings → Slack bridge**, or create
`.env` in this folder:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

Then enable **Slack** in Settings and Save — the status pill should show
**Connected to Slack**.

## Usage in Slack

- `@jarvis /help` — list commands
- `@jarvis what's the weather in Delhi?` — `/weather Delhi` or just ask (needs LLM key)
- DM the Jarvis bot directly — every message goes to the assistant
- Commands like `/open` only work when you're at your PC.
