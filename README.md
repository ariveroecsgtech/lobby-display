# Lobby Display

Informational screen for a building lobby. Pilot: Confluence, 26 Belden Ave, Norwalk, CT.

## What is live and what is sample

| Section | Status | Source |
|---|---|---|
| Clock, date | Live | Browser, America/New_York |
| Weather, hourly forecast, weather alerts | Live | National Weather Service (api.weather.gov), no key |
| Air quality, UV (shown only when notable) | Live | Open-Meteo. Free tier is non-commercial: replace before selling |
| Trains | Live when hosted | `/api/trains`: next train from South Norwalk to Grand Central, Stamford and New Haven, with arrival time |
| Drive times | Sample until `AZURE_MAPS_KEY` is set | `/api/drive`: Stamford, New Haven and Danbury with live traffic from Azure Maps |
| Markets strip | **Simulated** | Random demo numbers for showing the layout, labeled "Simulated · demo only" on screen. Not real quotes |
| Headlines (demo) | **Simulated** | Invented headlines for Norwalk, New York, New Haven and national, labeled "Simulated · demo only". They take turns with the markets strip (`CONFIG.footer = 'demo'`). Not real news |
| Live headlines | Off | `/api/news` (NewsData.io) works; turned off pending a decision on the news source. Set `CONFIG.footer = 'news'` to show it |
| QR code | Live | `qr.svg`, points to https://display.ecsgapps.com. Regenerate it if the address changes |

On a phone in portrait the same page switches to a one-column layout (this is what the QR code opens).

Anything not live is labeled "Sample data" on screen. Opened as a local file, trains also fall back to sample data.

## Structure

- `index.html` — the whole screen. Per-screen settings are in the `CONFIG` block at the top of the script.
- `api/` — Azure Functions (Node 20, v4 model). `GET /api/trains?station=South%20Norwalk&to=Grand%20Central,Stamford,New%20Haven` and `GET /api/drive?screen=confluence`.
- `api/lib/drive.js` — drive-time destinations per screen and the Azure Maps call (cached 15 minutes).
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
