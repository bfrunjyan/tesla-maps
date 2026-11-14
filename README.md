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
app shows them as Tesla-red pins with a white bolt (fast = 50 kW+) with an All / Fast filter on
the map and in the Charging tab.

- **OpenStreetMap** (always on): about 85 stations in Armenia, few with power listed.
- **Open Charge Map** (optional): set `OCM_API_KEY` (free at openchargemap.org) to add power
  and connector data. Entries within 60 m of each other are merged.
- **Google** (with the Google map only): Google lists many more stations (Team Energy,
  EcoCars, Amperion, EVAN, E-Volt, iCHARGE…) but gives the power for few of them, so the Fast
  filter rarely gains from it (`src/services/googleChargers.ts`). Loaded from the Places API
  for the area on screen once the map comes to rest, at most 20 stations per area, an area
  asked for only once per session; each request is billed (Nearby Search Enterprise +
  Atmosphere: $40 per 1,000 after 1,000 free a month). Google's terms allow its place data
  only on a Google map, so these stations never appear with the standard map. Where Google
  and OpenStreetMap list the same station (within 60 m), it shows once, keeping the entry
  that knows the power.
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

## Trips with several stops

A trip can go through up to 8 places in order: A, B, C… **Add stop** (in the route preview,
or under the stops button on the directions card while driving) opens the search; the place
picked is added after the ones already in the trip. In the stops list, drag a stop by its
handle to another place in the order (or focus the handle and use the up and down arrow
keys), and tap × to take it out. Every change plans the route again: in the preview as new
route choices, on the road from where the car is, with guidance carrying on meanwhile. If a
change can't be planned while driving, the trip goes back to what it was.

A stop is ticked off when the car gets within 30 m of it along the route (driving past
counts), and the trip carries on to the next one; only the last stop is "arrived". Leaving
the route plans a new one through every stop still to make. The routing server returns one
leg per stop; `tripToRoute` in `src/services/routing.ts` joins them into one line and one
list of maneuvers and names each stop in the instructions. Where a stop makes the route go
out along a street and back the same way, the car is matched to the direction it is driving
(`computeProgress` in `src/nav/progress.ts`). Through several stops the server offers no
alternative routes, so the choices are fastest and shortest. Trip logic: `src/nav/stops.ts`
and `src/nav/controller.ts`; the list: `src/components/StopsList.tsx`.

## Leaving the route

When the driver takes another way, Mapic plans a new route to the same destination from
where the car is, in the direction it is moving (`src/nav/offRoute.ts`). It notices when the
car is a little off the route and heading elsewhere (about 2 s after a turn), well off the
route whatever its direction (35 m plus GPS allowance), or driving the route backwards.
Guidance continues on the old route until the new one arrives. A request that takes over
12 s is dropped and tried again; at most one new route every 8 s.

## Picking a trip back up

If the page reloads mid-drive (the car's browser tab crashed, was reloaded, or came back
from sleep as a fresh page), Mapic carries on with the trip (`src/nav/resume.ts`). While
guidance runs, the destination, stops and fastest/shortest choice are kept on the device;
on the next start, a trip that was running in the last 30 minutes, and whose destination
is more than 150 m away, is planned again from the car's first GPS fix (or after 10 s
without one) and guidance continues, with a "Picking up your trip" message. Ending a trip
or arriving forgets it.

## Lanes

From 600 m before a junction, a blue bubble on the map points at it and shows one sign per
lane, left to right, as painted on the road: the lanes to take bright, lanes that also work
(but may need a change later) a little softer, the rest dimmed (`src/nav/lanes.ts`,
`src/map/laneCallout.ts`). It disappears after the turn or when the car leaves the route.

The lanes come from the open routing server, which reads OpenStreetMap's `turn:lanes`: they
show only at junctions where mappers have added lanes (about a quarter of the turns on test
routes in central Yerevan). Google's route data has no lanes, so with the Google map Mapic
asks the open server for the same trip at the same time (up to 4 s) and copies its lanes onto
Google's turns at the same junction (within 40 m, turning the same way).

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
   - optional: `RESEND_API_KEY`, `EMAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `VITE_MAPBOX_TOKEN`, `VITE_GOOGLE_MAPS_KEY`
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

### Traffic on the route

With a route on screen (the highlighted choice in the preview, or the one being driven), the
route line is drawn in traffic colours: green where traffic flows, then orange, red and dark
red. Mapic reads the traffic tiles the route passes through (`src/services/traffic.ts`) and
matches them to the route by position and direction of travel (`src/nav/routeTraffic.ts`),
so a jam on the opposite carriageway doesn't colour the driver's side. Stretches with no
traffic data keep the route's blue. It refreshes every 3 minutes. While a route is shown,
traffic on other roads is hidden; the traffic button brings it back for that trip. The
colours are only as good as the traffic provider's data.

### Google map (test)

With `VITE_GOOGLE_MAPS_KEY` set (Maps JavaScript API and Routes API enabled on it),
Settings → Map offers **Google (test)**. It swaps the map for Google's
(`src/map/GoogleMapView.tsx`) and plans routes with Google's Routes API
(`src/services/googleRoutes.ts`): routes that take live traffic into account, with
Google's traffic level for each stretch (normal, slow, jam) drawn on the route, and Google's
traffic layer for other roads. Google's terms allow its routes and traffic only on a Google
map, so the two are switched together. Search stays on Photon. Charger pins work as on the
standard map. With places on, tapping one of Google's place icons opens it in Mapic, with
its name and address from Google's Places API (New); without that API the place opens
unnamed with Mapic's own address. The lite map (set by hand, or automatically on a slow
GPU or a low frame rate) is a flat view. Google bills each map load, each route request
(traffic along the route is a higher-priced request; a reroute is a new request) and each
place lookup. If the map can't load or Google refuses the key, Mapic goes back to the
standard map and says so.

The Google map's look comes from Map IDs in the Google Cloud console (listed in
`src/services/googleMaps.ts`): JavaScript vector maps with Google's **Monochrome** style
for light mode and Google's **Dark** style for dark mode. Mapic picks light or dark from
its theme. Google can't hide its place icons from code, so there are two Map IDs, one with
place icons and one with them hidden; the places button switches between them. The look
is changed in the console (Map Styles), with no code change. The 3D button tilts the map
(Google shows buildings in 3D only when tilted); 3D off is a flat view.

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
| Search, reverse geocoding, Hungry / Lucky lists | Photon (komoot) | Fair-use server |
| Charging stations | Mapic's server (OpenStreetMap via Overpass, Open Charge Map) | Cached; fair-use |

All of these are public servers meant for light use. Before real users, move to self-hosted
instances or a licensed provider. Each provider sits behind one module in `src/services/`.

## Code map

- `src/map/style.ts`: graphite map style
- `src/map/MapView.tsx`: map, car arrow, follow camera, route line, long-press pin
- `src/map/camera.ts`: follow-camera zoom, including zooming in for turns
- `src/nav/controller.ts`: GPS, route progress, voice prompts, off-route rerouting, drive simulator
- `src/nav/progress.ts`: snapping the car to the route, next turn, remaining time and distance
- `src/components/`: search pill and panel, place card, guidance card, map tools
