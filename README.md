# 🐯 PERSIB FIXTURES 2026/2027 — ALL COMPETITIONS

**One Club. One Calendar. Every Match Matters.**

A fan-made match center for **Persib Bandung**, bringing schedules, scores, match statistics, and video highlights together in one place.

🌐 **Website:** https://persibfixtures-eight.vercel.app/

---

## ⚽ About

Persib Fixtures is a TypeScript-powered web application for following Persib Bandung throughout the 2026/2027 season. It brings domestic and international competitions into one calendar, with match information and supporting features for Bobotoh.

## ✨ Features

- 📅 **Match Calendar** — Browse the season's fixtures by month and competition.
- 🏆 **Competition Filters** — Explore Persib matches across all supported competitions.
- 🔎 **Match Search** — Find fixtures and opponents quickly.
- 🔄 **Schedule Refresh** — Retrieve schedule updates from supported competition sources.
- 🥅 **Score Refresh** — Check and synchronize completed match scores.
- 👁️ **Preview Before Commit** — Review proposed schedule and score changes before confirming them.
- 🔐 **Admin-only Refresh** — Password-protected admin access keeps refresh and write operations away from public visitors.
- 📊 **Match Statistics** — View match statistics when data is available.
- 🎬 **Match Highlights** — Browse YouTube highlight candidates, approve suggestions, or add a manual YouTube video URL.
- ▶️ **Embedded Video** — Watch available highlights in the site, with an option to open the video on YouTube when embedding is unavailable.
- 📝 **Match Details** — Open individual match information, results, venue, and related content.
- 📤 **Export Options** — Export fixtures to CSV and calendar (ICS) formats.
- 🕒 **WIB Timezone** — Kickoff times are displayed in Western Indonesian Time (Asia/Jakarta).

## 🔐 Admin Refresh & Environment Variables

The calendar and published match information are public. Only the refresh workflow requires admin authentication.

Configure the following server-side environment variables in Vercel (or in a local `.env.local` file for development):

| Variable | Required | Purpose |
| --- | --- | --- |
| `SYNC_ADMIN_PASSWORD` | Yes, for admin refresh | Password used to sign in to the admin refresh controls. |
| `SYNC_ADMIN_SESSION_SECRET` | Yes, for admin refresh | Long, randomly generated secret used by the server to sign admin session cookies. Keep it private and stable; do not generate a new value for each login. |
| `GITHUB_TOKEN` | Yes, to write changes | GitHub token with repository Contents read/write permission, used by the confirmation step to save fixture and highlight updates. |
| `YOUTUBE_API_KEY` | Optional | Enables automatic YouTube highlight search and video metadata lookup. Manual YouTube URLs can still be used when automatic search is unavailable. |

Optional configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SYNC_LOGIN_RATE_LIMIT` | `10` | Maximum login attempts per IP in the 10-minute window. |
| `YOUTUBE_HIGHLIGHTS_ENABLED` | Enabled when an API key is configured | Set to `false` to disable automatic YouTube highlight search. |
| `GITHUB_OWNER` | `dioprasetiyo21` | GitHub repository owner. |
| `GITHUB_REPO` | `persibfixtures` | GitHub repository name. |
| `GITHUB_BRANCH` | `main` | Branch used by the refresh writeback flow. |
| `HIGHLIGHTS_FILE_PATH` | `data/highlights.json` | Repository path for published match highlights. |

**Security notes**
- Never commit `.env.local` or expose environment variable values in client-side code.
- Do not use the `NEXT_PUBLIC_` prefix for secrets.
- Keep `SYNC_ADMIN_SESSION_SECRET` unchanged between deployments unless you intend to invalidate existing admin sessions.
- Admin access is enforced by the server API, not only by hiding refresh controls in the interface.
- Public visitors can continue to browse the calendar without signing in.

## 🛠️ Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- shadcn/ui-style components
- SWR
- YouTube Data API v3 (server-side, optional)
- GitHub Contents API for admin-confirmed data writeback

## 📁 Project Structure

```text
persibfixtures/
├── app/              # Next.js App Router and API routes
├── components/       # Calendar, match details, sync, and highlight UI
├── hooks/            # Client-side data and admin sync hooks
├── lib/              # Shared logic, data sources, admin auth, and sync
├── data/             # Fixture, result, and highlight datasets
├── public/           # Static assets
├── tests/            # Runtime and feature tests
└── package.json      # Dependencies and scripts
```

## 🚀 Getting Started

### Requirements

- Node.js
- pnpm 12.3.4

### Installation

```bash
git clone https://github.com/dioprasetiyo21/persibfixtures.git
cd persibfixtures
npx pnpm@12.3.4 install
```

### Environment setup

Create a `.env.local` file in the project root. Add the server-side variables needed for the features you want to test. For admin refresh and GitHub writeback, configure `SYNC_ADMIN_PASSWORD`, `SYNC_ADMIN_SESSION_SECRET`, and `GITHUB_TOKEN`. Add `YOUTUBE_API_KEY` to enable automatic highlight search.

Do not commit this file.

### Development

```bash
npx pnpm@12.3.4 dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Tests

```bash
pnpm test
```

### Production Build

```bash
pnpm build
```

## 💙 Made for Bobotoh

Built with passion for Persib Bandung and everyone who follows the journey.

**PERSIB SALAWASNA!** 🐯

---

*An independent fan-made project. Not officially affiliated with Persib Bandung or its management.*
