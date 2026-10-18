# Amy API usage ticker

## Codex allowance

The separate CODEX · ALLOWANCE panel reads the locally installed Codex CLI using its stdio app-server protocol (`initialize`, `initialized`, `account/rateLimits/read`). It shows remaining allowance for the reported windows and their reset times, refreshing every five minutes. It does not report API dollar spending, change account budgets, run agent turns, consume resets, or send messages. No authentication tokens or account identifiers are returned to the viewer. Reporting happens in a background thread with bounded waits; failures show a warning and retain the last successful values.

On Windows Amy discovers the desktop app's current `codex.exe` under `%LOCALAPPDATA%\OpenAI\Codex\bin`, or finds the CLI on PATH. Optional private config `codex_cli_path` can point to another installation. Launch Amy normally from the desktop shortcut so Codex can resolve your Windows profile and existing sign-in. If the CLI reports that no ChatGPT sign-in exists, sign in through the Codex CLI (`codex login`) and let the panel retry. An API-only CLI login cannot provide the ChatGPT plan allowance. Restart Amy after installing this backend change.

## API spending

The ticker refreshes every five minutes and uses OpenAI Costs for USD spend and Usage for model request counts (chat/completions, speech, transcription, images, embeddings and moderation). It does not count storage or administrative HTTP requests. Figures are estimates because OpenAI reporting may be delayed. Failed refreshes retain prior figures for the same month and display a warning; a new month clears the old totals.

Set `OPENAI_ADMIN_KEY` in Amy's server environment, or add `"openai_admin_key": "YOUR_ADMIN_KEY"` to her private server config. Windows uses `%APPDATA%\Amy\config.json`; the Pi uses `amy/config.json`. Obtain an Admin API key from OpenAI organization settings, with access to usage and costs. A normal chat/project API key is not sufficient. Do not put it in viewer files, commit it, or paste it in chat. Restart Amy after changing server credentials.

`monthly_api_budget_usd` defaults to 20 and can be changed using the ticker's Budget & history button. It is a reporting budget, not a billing limit or an automatic spending cutoff. Warnings appear at 50%, 80%, and 100%. Dollar amounts are USD.

Budget & history shows six completed UTC calendar months from the Costs API, refreshed hourly. The average uses only completed months with positive reported spending; zero-spend months are excluded. Amy suggests that average plus 25% headroom, rounded up to the next whole dollar (minimum $1). No suggestion is available until a completed month has reported spending. Suggestions cannot be applied when the history refresh failed. Only clicking Apply suggested budget or saving a manually entered amount changes the tracking budget; no automatic budget adjustment runs.

After the first day of the current month, the panel also shows a monthly projection from reported spending divided by elapsed time and multiplied by the month's duration. This is an estimate of the current daily rate, not a prediction of future activity. All history and projections can be delayed by OpenAI reporting.

Reporting uses the current UTC calendar month and displays its final date. It does not query an account-specific invoice or credit expiry date. By default figures cover the whole OpenAI organization; to limit both spend and requests to Amy's project, set `usage_project_ids` to an array of OpenAI project IDs in the private server config. The scope is shown in the ticker.
