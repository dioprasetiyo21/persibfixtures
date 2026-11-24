# Persib Fixtures

**One Club. One Calendar. Every Match Matters.**

A fan-made match center for **Persib Bandung**, bringing fixtures, results, match information, statistics, and video highlights together in one place.

**Live website:** https://persibfixtures.vercel.app/

---

## Overview

Persib Fixtures follows Persib Bandung throughout the 2026/2027 season, across domestic and international competitions. The calendar is designed to make the season easy to follow, while keeping match details and supporting information close at hand.

The project is independently developed for Bobotoh and is not officially affiliated with Persib Bandung.

## Features

### Follow the season
- **Season calendar** — Browse fixtures by date, month, and competition.
- **Competition filters** — Focus on a specific competition.
- **Match search** — Find opponents and fixtures quickly.
- **Match details** — View available match information, results, and venue details.
- **WIB kickoff times** — Match times use Western Indonesian Time (Asia/Jakarta).

### Match information
- **Score refresh** — Retrieve and synchronize completed match scores.
- **Schedule refresh** — Check for fixture updates from supported sources.
- **Review before publishing** — Preview proposed changes before confirming them.
- **Match statistics** — View statistics when data is available.
- **Match highlights** — Review YouTube highlight suggestions or provide a manual video URL.
- **Video playback** — Watch supported highlights on the site, with a YouTube fallback when embedding is unavailable.

### Take the data with you
- **CSV export** — Export fixture data for spreadsheets and analysis.
- **ICS export** — Add fixtures to compatible calendar applications.

## Admin refresh workflow

The calendar and published match information are public. Administrative refresh and publishing actions require an authenticated admin session.

The workflow is:

1. Sign in using the admin password.
2. Run a schedule or score refresh.
3. Review the proposed changes.
4. Confirm the changes to publish them to the repository.

The server enforces authentication for protected refresh and confirmation endpoints. Hiding controls in the interface is not the security boundary.

## Configuration

Set environment variables in the deployment environment (for example, Vercel) or in a local `.env.local` file when developing.

### Required for administrative publishing

| Variable | Purpose |
| --- | --- |
| `SYNC_ADMIN_PASSWORD` | Password used to access admin refresh controls. |
| `SYNC_ADMIN_SESSION_SECRET` | Long, randomly generated secret used to sign admin session cookies. Keep it private and stable; it is not a per-login value. |
| `GITHUB_TOKEN` | GitHub token with repository Contents read/write permission for confirmed data updates. |

### Optional

| Variable | Default / condition | Purpose |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | Not set | Enables automatic YouTube highlight search and video metadata lookup. |
| `SYNC_LOGIN_RATE_LIMIT` | `10` | Maximum login attempts per IP in the 10-minute window. |
| `YOUTUBE_HIGHLIGHTS_ENABLED` | Enabled when an API key is configured | Set to `false` to disable automatic YouTube highlight search. |
| `GITHUB_OWNER` | `dioprasetiyo21` | GitHub repository owner. |
| `GITHUB_REPO` | `persibfixtures` | GitHub repository name. |
| `GITHUB_BRANCH` | `main` | Branch used by the refresh writeback flow. |
| `HIGHLIGHTS_FILE_PATH` | `data/highlights.json` | Repository path for published match highlights. |

### Security

- Never commit `.env.local` or expose secret values in client-side code.
- Do not use the `NEXT_PUBLIC_` prefix for secrets.
- Keep `SYNC_ADMIN_SESSION_SECRET` private and unchanged between deployments unless you intend to invalidate existing admin sessions.
- Public visitors can browse the calendar without signing in.

## Technology

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- SWR
- YouTube Data API v3 (optional, server-side)
- GitHub Contents API for admin-confirmed data publishing

## Project structure

```text
persibfixtures/
├── app/          # Application pages and API routes
├── components/   # Calendar, match details, sync, and highlight UI
├── hooks/        # Client-side data and admin sync hooks
├── lib/          # Shared logic, data sources, authentication, and sync
├── data/         # Fixture, result, and highlight datasets
├── public/       # Static assets
├── tests/        # Runtime and feature tests
└── package.json  # Dependencies and scripts
```

## Run locally

### Requirements

- Node.js
- pnpm 12.3.4

### Install dependencies

```bash
git clone https://github.com/dioprasetiyo21/persibfixtures.git
cd persibfixtures
npx pnpm@12.3.4 install
```

### Configure environment

Create a `.env.local` file in the project root and add the variables required for the features you want to run. Administrative publishing requires `SYNC_ADMIN_PASSWORD`, `SYNC_ADMIN_SESSION_SECRET`, and `GITHUB_TOKEN`. Add `YOUTUBE_API_KEY` to enable automatic highlight search.

Do not commit `.env.local`.

### Start the development server

```bash
npx pnpm@12.3.4 dev
```

Open [http://localhost:3000](http://localhost:3000).

### Run tests

```bash
pnpm test
```

### Create a production build

```bash
pnpm build
```

---

## For Bobotoh

Made independently for everyone following the journey of Persib Bandung.

**PERSIB SALAWASNA!**

---

*Persib Fixtures is an independent fan-made project and is not officially affiliated with Persib Bandung or its management.*
