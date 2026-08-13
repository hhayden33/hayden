# Personal Dashboard

A set of small, self-contained HTML apps that share a top bar.

## Deploy your own copy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRowanThistlebrooke%2FYTdashh1)

One click → Vercel signs you in, copies the repo to your GitHub, and deploys it. ~30 seconds to a live URL.

## How to use

Open any `.html` file directly in your browser — no build step, no install.

| File | What it is |
|---|---|
| [index.html](index.html) | Bento grid hub — the home page, gated by a passcode ([lock.js](lock.js)) |
| [main.html](main.html) | Goals tracker (Day Ring, Goal Ticker, To Do list) |
| [health.html](health.html) | Supplement / daily stack tracker |
| [po-water.html](po-water.html) | Water intake tracker |
| [finance.html](finance.html) | Finances |
| [gym.html](gym.html) | Progressive overload gym tracker |
| [running.html](running.html) | Running command centre — training plan, PBs, race goal, analytics (manual data entry for now; built for a future Garmin import) |
| [topbar.js](topbar.js) | Shared top bar — auto-injected into pages that `<script src="topbar.js">` |
| [lock.js](lock.js) | Passcode gate for the hub — light deterrent, not real security |
| [template.html](template.html) | Starter template for a new page/section — copy it to match the dashboard's design + cloud sync |

Each app stores its own state in browser `localStorage`. No accounts, no server.

## Building from scratch

[BUILD_DASHBOARD.md](BUILD_DASHBOARD.md) is the prompt I gave Claude to generate `main.html` (originally `index.html`) — paste it into Claude if you want to rebuild that page yourself.
