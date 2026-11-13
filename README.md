# Car Nav (prototype)

In-car web navigation for Tesla owners in Armenia, where the built-in map can't route.
Runs in the car's browser. The UI follows the car's own navigation map layout
(Navigate pill, Home/Work, Recents/Favorites/Charging/Hungry/Lucky, right-side map tools,
heading-up 3D map, turn card).

## Run

```bash
npm install
npm run dev        # http://localhost:5174 (add ?dev for the test bar: simulated drive, voice language)
npm run build      # production build in dist/
```

### Deploy (Railway)

Railway detects Node, runs `npm install`, `npm run build`, then `npm start`
(a static server on Railway's `PORT`). Node 22.12+ is required (`engines` in package.json).
Generate a public domain in Railway; it's HTTPS, which the car's browser needs for GPS.
Variables prefixed `VITE_` are baked in at build time, so redeploy after changing them.

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
- `src/nav/controller.ts`: GPS, route progress, voice prompts, off-route rerouting, drive simulator
- `src/nav/progress.ts`: snapping the car to the route, next turn, remaining time and distance
- `src/components/`: search pill and panel, place card, guidance card, map tools
