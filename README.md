# Lobby Display

Informational screen for a building lobby. Pilot: Confluence, 26 Belden Ave, Norwalk, CT.

## What is live and what is sample

| Section | Status | Source |
|---|---|---|
| Clock, date | Live | Browser, America/New_York |
| Weather, hourly forecast, weather alerts | Live | National Weather Service (api.weather.gov), no key |
| Air quality, UV (shown only when notable) | Live | Open-Meteo. Free tier is non-commercial: replace before selling |
| Trains | Live when hosted | `/api/trains`, reading MTA Metro-North GTFS + GTFS-realtime |
| Drive times | Sample | Planned: Azure Maps |
| News headline | Sample | Planned: licensed news provider |
| QR code | Placeholder | Needs the public URL |

Anything not live is labeled "Sample data" on screen. Opened as a local file, trains also fall back to sample data.

## Structure

- `index.html` — the whole screen. Per-screen settings are in the `CONFIG` block at the top of the script.
- `api/` — Azure Functions (Node 20, v4 model). `GET /api/trains?station=South%20Norwalk`.
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

- `DEFAULT_STATION` — station used when the request has none.
- `MNR_STATIC_URL`, `MNR_REALTIME_URL` — override the MTA feed addresses if they change.

## Known gaps

- Track numbers are not shown: they come in an MTA extension the standard decoder does not read.
- MTA feeds are subject to MTA's developer terms and conditions.
