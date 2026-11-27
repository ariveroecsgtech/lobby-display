# Lobby Display

Informational screen for a building lobby. Pilot: Confluence, 26 Belden Ave, Norwalk, CT.

## What is live and what is sample

| Section | Status | Source |
|---|---|---|
| Clock, date | Live | Browser, America/New_York |
| Weather, hourly forecast, weather alerts | Live | National Weather Service (api.weather.gov), no key |
| Air quality, UV (shown only when notable) | Live | Open-Meteo. Free tier is non-commercial: replace before selling |
| Trains | Live when hosted | `/api/trains`: next train from South Norwalk to Grand Central, Stamford and New Haven, with track, status and the train after it ("then 9:42") |
| Metro-North service notices | Live when hosted | `/api/alerts?routes=3,5`: MTA alerts feed, New Haven Line and Danbury Branch. One line under the trains, shown only while a notice is in effect |
| Drive times | Live when hosted and `AZURE_MAPS_KEY` is set | `/api/drive`: Stamford, New Haven and Danbury with live traffic from Azure Maps. Each destination lists the highways Azure Maps returned (I-95, Merritt, Route 7), fastest first; a highway only appears if Azure Maps offers a route on it |
| Feels like, wind, sunrise/sunset, next two days | Live | Computed in the browser from the National Weather Service forecast; sun times from NOAA's equation |
| Community panel | Live when hosted | Cards published from the manager page (`/manage`), read from `/api/community` every 15 seconds. With nothing published it shows a welcome card. The cards in `CONFIG.community` (including an invented sponsored bakery) only appear in sample mode, labeled "Sample" |
| Emergency alert | Live when hosted | Published from `/manage`; covers the screen except the clock until it ends or is cleared |
| Open today (building hours) | **Sample** | `CONFIG.buildingHours`, labeled "Sample hours" until the real hours are confirmed |
| Markets strip | **Simulated** | Random demo numbers for showing the layout, labeled "Simulated · demo only" on screen. Not real quotes |
| Sports results (demo) | **Simulated** | Invented NBA, NFL, NHL, MLB scores (city names only) and a made-up golf leaderboard, labeled "Simulated · demo only". Not real results |
| Headlines (demo) | **Simulated** | Invented headlines for Norwalk, New York, New Haven and national, labeled "Simulated · demo only". They take turns with the markets strip (`CONFIG.footer = 'demo'`). Not real news |
| Live headlines | Off | `/api/news` (NewsData.io) works; turned off pending a decision on the news source. Set `CONFIG.footer = 'news'` to show it |
| QR code | Live | `qr.svg`, points to https://display.ecsgapps.com. Regenerate it if the address changes |

On a phone in portrait the same page switches to a one-column layout (this is what the QR code opens).

Anything not live is labeled "Sample" on screen. Opened as a local file, or with `?sample` added to the address, every panel shows labeled sample data. `?card=2` opens on that Community card and `#alert` shows a demo weather alert, for previews.

## Structure

- `index.html` — the whole screen. Per-screen settings are in the `CONFIG` block at the top of the script.
- `api/` — Azure Functions (Node 20, v4 model). `GET /api/trains?station=South%20Norwalk&to=Grand%20Central,Stamford,New%20Haven`, `GET /api/alerts?routes=3,5` and `GET /api/drive?screen=confluence`.
- `api/lib/drive.js` — drive-time destinations per screen and the Azure Maps call (cached 15 minutes, paused from 11 PM to 5 AM local time).
- `api/lib/alerts.js` — Metro-North service notices for the given route ids (cached 2 minutes).
- `api/lib/mnr.js` — downloads the Metro-North station list (cached 24 h) and the realtime feed (cached 30 s).
- `staticwebapp.config.json` — Azure Static Web Apps settings.

## Deploy to Azure Static Web Apps (Free plan)

1. Azure portal → Create resource → Static Web App → plan **Free**.
2. Source: GitHub → this repository → branch `main`.
3. Build presets: **Custom**. App location `/`, API location `api`, output location empty.
4. Create. Azure adds a GitHub Actions workflow and deploys on every push.
5. Open the generated URL, then add a custom domain if wanted.

## Test

```
cd api
npm install
npm test
```

The test builds a fake Metro-North feed, so it runs offline. The real MTA feed has not been called from the build environment: check `/api/trains` after the first deploy.

## Optional settings (Static Web App → Environment variables)

- `NEWSDATA_API_KEY` — NewsData.io API key. Without it `/api/news` answers 503 and the screen shows sample headlines. `NEWS_QUERY` overrides the default `country=us&language=en&category=top`.
- `AZURE_MAPS_KEY` — Azure Maps subscription key. Without it `/api/drive` answers 503 and the screen shows labeled sample drive times.
- `DEFAULT_STATION` — station used when the request has none.
- `MNR_STATIC_URL`, `MNR_REALTIME_URL` — override the MTA feed addresses if they change.

## Known gaps

- Track numbers appear only when Metro-North has posted one for that stop; the feed often has none until shortly before departure.
- The NewsData.io and Azure Maps calls are tested with simulated responses only until their keys are configured.
- MTA feeds are subject to MTA's developer terms and conditions.

## Manager page

`/manage` is where the building's community manager publishes to the Community panel: cards, posters from built-in designs, and an emergency alert.

- Sign-in uses Azure Static Web Apps' built-in Microsoft login. Only accounts with the `manager` or `admin` role can open `/manage` or call `/api/manage/*` (rules in `staticwebapp.config.json`, checked again in the API).
- Roles are given by ECSG only: Azure portal → the Static Web App → Role management → Invite, provider Microsoft Entra ID (shown as "aad"), the person's email, role `manager`. Send them the invitation link it generates.
- Limits: 5 cards, 3 posters and 1 emergency alert at a time, counting scheduled ones. Every announcement has an end date and comes down by itself. An emergency alert lasts 24 hours at most.
- Storage: Azure Table `announcements` in the storage account named by the `STORAGE_CONNECTION` app setting. Rows are removed a week after they end.
- Rules and limits live in `api/lib/announcements.js`; `api/lib/store.js` is the only file that talks to Azure Tables.
- Not built yet: per-building manager assignment (today a manager role covers the one screen, `confluence`), uploading custom poster art, sponsor management, editing an announcement after publishing.
