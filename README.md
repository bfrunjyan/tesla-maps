# Mapic (prototype)

In-car web navigation for Tesla owners in Armenia, where the built-in map can't route.
Runs in the car's browser. The UI follows the car's own navigation map layout
(Navigate pill, Home/Work, Recents/Favorites/Charging/Hungry/Lucky, right-side map tools,
heading-up 3D map, turn card).

## Run locally

Needs Node 22.18+ and Postgres (any; Docker is easiest).

```bash
npm install
docker run -d --rm --name teslamaps-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=teslamaps -p 54340:5432 postgres:16
cp .env.example .env.local     # defaults point at the container above
npm run dev:api                # API on :8787 (applies database migrations on start)
npm run dev                    # web app on :5174, proxies /api to the API
```

Add `?dev` to the URL for the test bar (simulated drive, voice language).
Without an email provider, sign-in codes are printed in the `dev:api` terminal.

## Tests

```bash
npm test            # everything (unit + API)
npm run test:unit   # app logic: heading smoothing, lite-mode detection, route progress, geo maths, sunrise/sunset
npm run test:api    # server: all sign-in methods, takeover protection, QR pairing, saved places, CSRF, rate limits
```

API tests need the local Postgres container from above and use a separate `teslamaps_test`
database (created once with `docker exec teslamaps-db psql -U postgres -c "CREATE DATABASE teslamaps_test"`).
They wipe it on every run and refuse to touch any database whose name doesn't end in `_test`.

### Checks before every push

- **On your machine:** `npm install` points git at `.githooks/`, whose `pre-push` hook runs
  the typecheck and all tests. A failure blocks the push. (Needs the local test database.)
- **On GitHub:** `.github/workflows/ci.yml` runs typecheck, tests (with its own Postgres) and
  the build on every push to `development` and `main`, and on pull requests.
- **On Railway:** turn on *Wait for CI* for the service (Settings), so a commit whose GitHub
  checks fail is never deployed.

## Performance

```bash
npm run build && PORT=8899 APP_URL=http://localhost:8899 node server/index.ts &
npm run perf                    # frame rate during a simulated drive: full/lite × CPU 1x/4x
npm run perf -- --gpu=software  # same, with WebGL on the CPU (harsh stand-in for a weak car GPU)
npm run perf -- --memory        # memory over one complete simulated drive
```

Measured 2026-11-13 (M3 Pro; software rendering for the worst case):

| | Full map | Lite map |
|---|---|---|
| Real GPU, CPU 1x / 4x | 60 / 60 fps | 60 / 60 fps |
| Software GPU, CPU 1x / 4x | 20 / 20 fps, 31 % janky frames at 4x | 30 / 30 fps, 12 % at 4x |

Memory over a 3-minute drive: 14.3 → 14.4 MB heap, steady DOM nodes and listeners.
First load: ~464 KB (Brotli; was 2.1 MB uncompressed). After a deploy only the app chunk
(~35 KB) is new; MapLibre and React stay cached.

## Chargers

The server keeps a feed of every charging station in `CHARGER_COUNTRIES` (default `AM`),
refreshed every 12 hours and saved in Postgres, and serves it at `GET /api/chargers`. The
app shows them as pins (red = fast, 50 kW+; white = standard) with an All / Fast filter on
the map and in the Charging tab.

- **OpenStreetMap** (always on): about 85 stations in Armenia, few with power listed.
- **Open Charge Map** (optional): set `OCM_API_KEY` (free at openchargemap.org) to add power
  and connector data. Entries within 60 m of each other are merged.
- **Live status** (free / busy / offline): no Armenian network publishes it. Each charger has
  a `status` field that stays empty until a network shares data (e.g. via OCPI).

## Car and battery

Drivers pick their Tesla (model, year, version; `src/vehicle/catalog.ts`) from the battery
chip on the map. The choice is saved on the device and in the account (`/api/vehicle`).
They set the battery level by hand (or connect their Tesla, below); Mapic lowers it as the car moves and shows the charge
at arrival on each route option and during guidance (amber under 20 %, red under 10 %).
Battery sizes and consumption are estimates. Photo credits: `public/cars/CREDITS.md`.

### Connect Tesla

With a Tesla developer app set up, signed-in drivers can connect their Tesla account from the
car sheet. Mapic then reads charge level, range and charging state from the car itself
(Tesla Fleet API, read-only scope `vehicle_device_data`), and the manual battery controls step
aside. The link belongs to the Mapic account, so a driver can connect on a phone and the car
picks it up. Hidden until `TESLA_CLIENT_ID` and `TESLA_CLIENT_SECRET` are set.

Tesla bills every reading (about $0.002, less a $10 monthly discount) and asks apps not to
poll, so Mapic reads the car when the app opens, when a route is planned, and every 10 minutes
while driving or charging; in between it lowers the level itself. The server answers repeat
requests within a minute from the last reading and stops at `TESLA_DAILY_READS` per driver
per day (default 60). A sleeping car is never woken: Mapic shows its last report.
Tokens are stored encrypted (`server/lib/secretBox.ts`, key derived from the client secret);
Disconnect, or deleting the account, removes them.

Setup, once:

1. At [developer.tesla.com](https://developer.tesla.com) create an app (the account needs a
   payment method and a billing limit above 0). Scope: Vehicle Information. Allowed origin:
   `https://mapic.site`. Redirect URI: `https://mapic.site/api/tesla/callback`.
2. Make a key pair and keep `private-key.pem` to yourself (Mapic doesn't need it):
   `openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem` then
   `openssl ec -in private-key.pem -pubout -out public-key.pem`.
3. In Railway set `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET` and `TESLA_PUBLIC_KEY` (the contents
   of `public-key.pem`). After the deploy the key is live at
   `/.well-known/appspecific/com.tesla.3p.public-key.pem`.
4. Register the domain with Tesla in both regions:
   `TESLA_CLIENT_ID=… TESLA_CLIENT_SECRET=… APP_URL=https://mapic.site npm run tesla:register`.

Try it without keys: `npm run dev:api:tesla` uses a stand-in for Tesla
(`server/dev/fakeTesla.ts`, never mounted in production); change what its car reports at
`/api/dev/tesla/set?pct=41&charging=Charging&minutes=35`. Not yet verified against Tesla
itself: that needs the keys above and a real car. China-region Tesla accounts use a separate
Tesla service and are not covered.

## Route choices

Picking a destination shows up to 3 routes before guidance starts: the fastest, up to two
alternatives (Valhalla `alternates`) and the shortest. Each shows time, distance and an
estimated battery use (distance and speed plus climbs from the routing server's elevation
data, `src/nav/energy.ts`), tagged Fastest / Shortest / Economy. Fastest is pre-selected and
starts after 10 s unless the driver touches the screen. Rerouting keeps the chosen
preference (fastest or shortest). Travel times don't include live traffic.

## Zoom while navigating

During guidance the map zooms itself (`src/map/camera.ts`): a wider view between turns that
eases out with speed, zooming in on the junction from about 14 seconds before a turn, fully
in about 5 seconds before it, held through the turn and eased back out by 130 m after it.
U-turns come in closest; exits, forks and merges a little less than turns; the destination
like a turn. Braking on the approach never zooms back out.

## Accounts

Drivers can sign in four ways; Home, Work, favorites and recent destinations then sync
to their account. Places saved before signing in are merged into the account; signing out
removes them from the car (it may be shared).

- **QR code via phone** (main option in the car): the car shows a QR code and short code.
  The phone opens `/link?c=CODE`, signs in, and taps "Sign in the car"; the car is polling
  and receives its own session. Codes expire after 5 minutes and work once; the car polls
  with a separate secret, so the link alone can't claim the session.
- **Email one-time code**: needs `RESEND_API_KEY` and `EMAIL_FROM` in production.
- **Email + password**: scrypt-hashed. If someone registers an email they don't own,
  the real owner's first code or Google sign-in removes that password and its sessions.
- **Google**: needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; hidden until set.

Sessions are httpOnly cookies (90 days, sliding). Tesla's browser may wipe cookies when the car
powers down, so after any sign-in the app also keeps a **remember token** in local storage
(single use, rotated on every use, 90 days, cancelled by Sign out). On launch with no session
cookie, the app trades it for a new session silently. If the car wipes all site data, the QR
sign-in is one tap on a phone that's still signed in. API code lives in `server/`
(Hono + Postgres); schema in `server/migrations/`.

## Deploy (Railway)

1. Add a **Postgres** service to the project.
2. On the app service, set Variables:
   - `DATABASE_URL` → reference the Postgres service's `DATABASE_URL`
   - `APP_URL` → the app's public `https://…` domain (Settings → Networking → Generate domain)
   - optional: `RESEND_API_KEY`, `EMAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `VITE_MAPBOX_TOKEN`
3. Railway runs `npm install`, `npm run build`, `npm start`. `npm start` runs the API and
   serves the built app from one process; migrations apply automatically on start.

Node 22.18+ is required (`engines` in package.json); it runs the server's TypeScript directly. `VITE_` variables are baked in at build
time, so redeploy after changing them. Rate limits are in memory: run a single instance
(or move them to Postgres/Redis before scaling out).

### Live traffic

Traffic uses Mapbox's traffic tiles (the only source found with live traffic for Armenia).
Create `.env.local` with a Mapbox public token:

```bash
VITE_MAPBOX_TOKEN=pk.your_token_here
```

Without a token the traffic button says so. Mapbox's terms require a paid vehicle license
for in-car apps, including during development, so check with Mapbox before relying on it.

### Appearance

Map settings (gear at the bottom of the map tools) offer Auto / Light / Dark, like the car.
Auto uses the browser's dark-mode signal when it reports dark, otherwise sunrise and sunset
at the car's location. Whether the car's browser passes its own display mode through is
one of the things to check in the car.

## Testing in the car

The car's browser can't reach your laptop's localhost, and browsers only give GPS to
HTTPS pages. Deploy `dist/` to any static HTTPS host (Vercel, Netlify, Cloudflare Pages)
and open that URL in the car. First things to check there:

- Does the car share its location with the page, how often does it update, and how accurate is it?
- Does voice guidance play through the car speakers?
- How large is the browser window, and are the touch targets comfortable?

## Data providers (prototype only)

| Need | Provider | Notes |
|---|---|---|
| Map tiles + 3D buildings | OpenFreeMap (OpenStreetMap) | Free, no key |
| Satellite imagery | Esri World Imagery | Production use needs an ArcGIS account |
| Live traffic | Mapbox Traffic v1 tiles | Needs token; vehicle license per Mapbox terms |
| Routing + turn instructions | Valhalla public server (FOSSGIS) | No live traffic; fair-use server |
| Search / reverse geocoding | Photon (komoot) | Fair-use server |
| Charging / Hungry / Lucky lists | Overpass API (3 mirrors) | Often busy; fair-use |

All of these are public servers meant for light use. Before real users, move to self-hosted
instances or a licensed provider. Each provider sits behind one module in `src/services/`.

## Code map

- `src/map/style.ts`: graphite map style
- `src/map/MapView.tsx`: map, car arrow, follow camera, route line, long-press pin
- `src/map/camera.ts`: follow-camera zoom, including zooming in for turns
- `src/nav/controller.ts`: GPS, route progress, voice prompts, off-route rerouting, drive simulator
- `src/nav/progress.ts`: snapping the car to the route, next turn, remaining time and distance
- `src/components/`: search pill and panel, place card, guidance card, map tools
