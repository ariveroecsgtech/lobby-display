# ECSG Display (lobby display)

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
| Service notices | Live when hosted | Published from `/manage` (water, elevator, power...). Shown in the strip under the clock, taking turns with the weather alert. Never cover the screen |
| Scheduled test | Live when hosted | Published from `/manage` (fire alarm test). Covers the screen in amber only between its start and end; can be scheduled ahead with an announcement card, and cancelled |
| Real emergency | Live when hosted | Published from `/manage`. Red screen with a slow pulse (one every 1.6 s, well under the 3 per second seizure threshold) and a beep where the kiosk allows sound. Evacuate or shelter wording by type. Shows the building's way out and meeting point only if they are on file in `SCREENS[...].safety` |
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
- `templates.js` — the 16 poster templates (palette and original vector illustration each), used by both the screen and the manager page. Keys must match `DESIGNS` in `api/lib/announcements.js`; a test checks it.
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

## Residents

`/manage` → Residents keeps the list that announcements and alerts will be emailed to: first name, last name and email, nothing else.

- The manager can add one resident, remove one, search by name or email, filter by the first letter of the last name, and import a file.
- Import: download the template (`.csv` or `.xlsx`), fill it, choose the file. The page reads the file in the browser (`manage/files.js`, no library; column names in English or Spanish; commas, semicolons or tabs in CSV), asks the server for a dry run, and shows what would change before anything is saved. "Add" keeps people not in the file; "Replace" makes the file the whole list.
- One row per email address (the id is a hash of the lowercased email). Limit 3,000 residents per screen.
- Stored in the Azure Table `residents`, reachable only through `/api/manage/residents*` with the manager or admin role. Never part of `/api/community`, never shown on the screen. Server logs record who changed the list, not the residents' details.
- Email: once `ACS_CONNECTION` (Azure Communication Services) is set, every alert is emailed to the list when published. Cards and posters, unless the manager unticks them, are gathered into one daily email sent at the building's `digestHour` (6 PM building time); a day with nothing new sends nothing. Mail goes out from the subdomain `notices.ecsgapps.com`, kept separate from ECSG's own mail. Wording is in `api/lib/mail.js`. The sender per building is `SCREENS[...].mail` (address on a verified domain, display name, reply-to).
- Pacing: Azure starts each subscription at 30 emails a minute and 100 an hour on a custom domain. Messages go to the `outbox` table and are sent 6 recipients at a time each time a screen checks in (`/api/community`), at most 90 an hour (`MAIL_PER_HOUR`, `MAIL_PER_TURN`). A 300-resident building takes a bit over 3 hours per message until Microsoft raises the quota (support request). Emergencies jump the queue but are still paced: email is a record, not a warning system.
- Every email ends with a signed link to stop event announcements (`/api/unsubscribe`; opening it shows a button, pressing it does it). Alerts still go to everyone.

## Alerts

Three levels, all from `/manage` → Alerts and notices, all confirmed on a preview step:

1. **Service notice** (`kind: notice`): up to 3; strip under the clock; ends at the chosen date and time.
2. **Scheduled test** (`kind: drill`): covers the screen for its duration (4 hours at most), now or at a future date and time. With "announce" it also creates a card in the Community panel until the test starts; the two share a `group`, so cancelling either removes both.
3. **Real emergency** (`kind: emergency`): must carry a type from `EMERGENCIES` in `api/lib/announcements.js` (fire, gas, bomb, evacuate, threat, earthquake, tornado, hurricane, shelter); there is no default type. Starts immediately, 24 hours at most, one at a time, cleared from the manager page.

The screen is a support for the building's emergency plan, not a life-safety system: it does not replace the fire alarm or a call to 911. Sound needs the kiosk browser started with autoplay allowed (Chrome: `--autoplay-policy=no-user-gesture-required`) and the TV volume on; `CONFIG.emergencySound` turns it off. The way out and meeting point must come from the building's emergency plan and are entered by ECSG in `SCREENS[...].safety`; while empty, the screen shows none.

## Manager page

`/manage` is where the building's community manager publishes to the Community panel: cards, posters from built-in designs, and an emergency alert.

- Sign-in uses Azure Static Web Apps' built-in Microsoft login. Only accounts with the `manager` or `admin` role can open `/manage` or call `/api/manage/*` (rules in `staticwebapp.config.json`, checked again in the API).
- Roles are given by ECSG only: Azure portal → the Static Web App → Role management → Invite, provider Microsoft Entra ID (shown as "aad"), the person's email, role `manager`. Send them the invitation link it generates.
- Before anything is published the manager sees a review step: the real screen page drawn with the draft (`/?sample#preview=...`, nothing saved), then confirms. The same step confirms an emergency alert.
- Own image for a poster: JPG, PNG or WebP, up to 8 MB, any shape from 200 x 200 px, sharpest at 1200 x 1200 or larger. The page fits it automatically onto a 1200 x 1200 poster (whole image kept, enlarged or reduced, leftover space filled with a blurred copy), warns when a small image was enlarged, and re-encodes it as JPEG (which also drops photo metadata) before upload. The API accepts only real JPG/PNG/WebP bytes up to 1.5 MB, keeps them in the private blob container `posters`, and serves them at `/api/image/{id}`. An image is deleted when its announcement ends, or after a day if never published. Rules are in `IMAGE` in `api/lib/announcements.js`.
- Limits: 10 announcements at a time in any mix of cards and posters, counting scheduled ones, plus 1 emergency alert. The total can be set per screen with `maxAnnouncements` in `SCREENS` (ECSG only). Every announcement has an end date and comes down by itself; an emergency alert lasts 24 hours at most. A featured announcement goes first and takes a second turn each lap, so it is on screen twice as often.
- Storage: Azure Table `announcements` in the storage account named by the `STORAGE_CONNECTION` app setting. Rows are removed a week after they end.
- Rules and limits live in `api/lib/announcements.js`; `api/lib/store.js` is the only file that talks to Azure Tables.
- Not built yet: per-building manager assignment (today a manager role covers the one screen, `confluence`), uploading custom poster art, sponsor management, editing an announcement after publishing.

## Building settings, roles, install and seasons

- **Settings (ECSG admin only).** `/manage` → Settings: building name, address, office email and logo. Saved by `POST /api/manage/settings`, which answers 403 to anyone without the `admin` role. The logo is trimmed and fitted in the browser to at most 600 × 144 px; a dark logo or one on a light background gets a white plate. The lobby screen reads these from `building` in `/api/community`, and emails use the name and office email.
- **Roles.** `manager`: announcements, alerts, residents. `admin` (ECSG): the same plus settings and inviting managers from Azure (Role management). The app shows the table and, to admins, the invite command.
- **Install as an app.** `manifest.webmanifest` (residents: the screen only, no options), `manage.webmanifest` (manager app), `sw.js` (no caching), `/install.html` with steps for iPhone, Android and computer.
- **Seasons.** `season.js` → `window.lobbySeason(date)`: the mark beside the building name follows the US calendar (New Year, MLK Day, Valentine's, Presidents' Day, St. Patrick's, Memorial Day, Juneteenth, July 4, Labor Day, Halloween, Veterans Day, Thanksgiving, Holidays).
- **Manager app look.** Drawn as a remote control for the screen: status display, one main key, three round alert keys, and a row of small keys.

## Push notifications

- `push-client.js` (`window.lobbyPush`), `sw.js` (shows the notification), `api/lib/push.js`, `api/src/functions/push.js` (`GET /api/push/key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`), table `push`.
- Every announcement and alert is pushed once, when it is published, to every device of the building that allowed notifications (resident app and manager app). Wording comes from the email composer.
- A device row holds only the push address and keys: no name, no email. Only Google, Apple, Mozilla and Microsoft push hosts are accepted.
- Needs app settings `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (generate with `npx web-push generate-vapid-keys`). Without them push is off and everything else works.
- No browser allows notifications without one tap on "Allow". iPhone: only from the installed app (iOS 16.4+).

## Updates

`update.js` compares the app's own files with what was loaded, every 5 minutes and when the app returns to the front. Lobby screen and resident app: reload by themselves. Manager app: reloads by itself on the home view; inside a form it shows "A new version is ready" with an Update button.

## Name and mascot

The product is called **ECSG Display** (manager app: ECSG Display Manager). The ECSG monogram is the mascot: `window.lobbyMascot(date)` in `season.js` draws it with a hat on the "g" and a seasonal ornament in place of the dot. App icons use the white monogram on navy.
Tapping a notification opens the app and shows the message at the top (`#msg=` hash or a message from `sw.js`). Every manager view has Back and Home keys.

## Sent messages, corrections, sponsored messages, signature

- **Sent** (`/manage` → Sent, `GET/POST /api/manage/sent`, table `sentlog`): one line per announcement, alert or correction with the time, who published it and how many devices and residents it went to (never who). Keeps the last 150.
- **Correction**: "Write a correction" on any line (or a general one). Sent at once by notification and, when email is on, by email; recorded in the same list. A correction to an event skips residents who stopped event emails.
- **Sponsored**: checkbox on a new card or poster, ECSG admin only. Labelled "Sponsored" on the screen, shown after the building's own items, never featured, emailed or pushed; 3 at a time.
- **Signature**: "Powered by ECSG Display · © <year> Enterprise Cloud Solutions Group LLC. All rights reserved. Norwalk, CT. · ecsgtech.com" on the screen, the manager app and the install page.
