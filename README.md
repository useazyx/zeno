# Zeno

A dispatch console for fire departments that picks the fastest route to an incident using a graph
neural network trained on the real street map of Taubaté, Brazil.

The shortest route in meters isn't always the fastest one. 500 meters on a highway and 500 meters
down a residential alley are very different trips for a fire truck. Zeno learns the traversal cost
of every street from its type, speed limit, lanes and what surrounds it, and then runs Dijkstra on
those learned costs. Every dispatch stores both routes, the neural one and the plain shortest
path, side by side.

Leia em português: [README.pt-BR.md](README.pt-BR.md)

## How it fits together

Three processes, started in this order:

```
PostgreSQL  <-  backend (Fastify, :3333)  ->  AI service (FastAPI, :8000)
                     ^
                     |  REST + WebSocket
                frontend (React, :5173)
```

- **AI service** (`machine/`): Python, PyTorch, PyTorch Geometric, OSMnx, NetworkX, FastAPI. Loads
  the Taubaté graph and applies the model to every edge once at startup, then answers "what's the
  best path between these two points". It has no database and knows nothing about incidents.
- **Backend** (`backend/`): Node.js, Fastify, TypeScript, Prisma, PostgreSQL, Zod. All the business
  rules live here: units, firefighters, vehicles, crews, shifts, incidents and dispatches, plus a
  WebSocket that streams dispatch events.
- **Frontend** (`frontend/`): React, Vite, TypeScript, Tailwind, MapLibre and Leaflet. Talks only to
  the backend, never to the AI service directly.

## The model

**GAT + MLP.** A Graph Attention Network encodes context: in two rounds of message passing each
intersection learns how much attention to pay to each neighbor, so the cost of street A→B also
reflects what's around B (a highway two blocks ahead, a narrow stretch after the turn). An MLP then
takes `[origin embedding, destination embedding, edge features]` and outputs a cost in seconds.

Each street feeds 9 features: length, inferred speed, lanes, one-way flag and a one-hot road type
(highway, primary, secondary, tertiary, local).

Edges are split 85/15 into train and validation. A real run:

```
   Epoch    Train loss    Val loss    Best val          LR
      50/800    0.2371      0.2335      0.2335    0.000300
     300/800    0.0624      0.0578      0.0578    0.000300
     800/800    0.0566      0.0541      0.0541    0.000075
```

Validation loss stays at or below training loss the whole way, and early stopping restores the best
state if validation starts climbing.

Two bugs from the first GNN attempt that are worth writing down, since both gave NaN from epoch 1:

- OSMnx node IDs are arbitrary (`123456789`) and GATConv uses them as matrix indices. They have to be
  remapped to `0..N-1` first.
- Unnormalized features (hundreds of meters next to values between 0 and 1) overflow the attention
  softmax. Everything is standardized, and the normalization parameters are saved inside the `.pth`
  so inference can turn the output back into seconds.

A small C++ module (`machine/src/cpp`, exposed through pybind11) keeps the per-edge neural costs in
a buffer outside the Python heap while the route is computed.

## Dispatch lifecycle

Creating a dispatch does three things in one transaction: records the dispatch, marks the vehicle
as committed and moves the incident to dispatched. Right after that the AI service computes the
route and both variants are saved.

```
DESPACHADO -> A_CAMINHO -> NO_LOCAL -> RETORNANDO -> FINALIZADO
     |             |
     +-------------+--> CANCELADO   (only before arriving)
```

Skipping a state is rejected with 400. If the AI service is down, `/ai/routes` answers 503 and the
dispatch is still created without a route, with a warning in the response. An AI outage must never
stop a truck from leaving.

There's no login. Whoever answers the emergency line has someone on the phone, and an auth screen
between the operator and the incident form costs seconds that belong to the call. In a real
deployment access control would be the network the console runs on.

Coordinates more than 2 km away from the mapped streets are refused. Without that limit, a typo
pointing to another state would still snap to some corner of Taubaté and return a confident,
meaningless route.

## The console

- **Panel** (`/`): live map of open incidents and vehicles. Critical alerts show over every page.
- **Incidents** (`/ocorrencias`): address search, a timeline with operator notes, vehicles ranked by
  the arrival time the AI predicts, nearby hospitals and water sources, a replay of the response
  and a printable report.
- **Routes** (`/rotas`): turn-by-turn guidance, street closures, the search trace of the
  bidirectional Dijkstra, and the same trip on the public OSRM server for comparison.
- **Coverage** (`/cobertura`): response-time isochrones of each station and how much of the recent
  demand they reach.
- **Neural network** (`/rede-neural`): training progress, attention weights and the learned cost of
  every street drawn on the map.
- **Garage** (`/garagem`): 3D view of each vehicle. **Water sources** (`/hidrantes`): hydrants,
  cisterns and intake points.
- **Wallboard** (`/telao`) and **vehicle terminal** (`/terminal/:vehicleId`) run full screen,
  outside the main layout.

Vehicle positions are stored over time. During a dispatch, a background monitor raises an alert
when a vehicle loses signal or stays stopped away from the incident. OpenStreetMap has no hydrants mapped in Taubaté, so `npm run seed:water-sources`
writes 42 demo hydrants on real intersections of main roads, flagged as a demo scenario.

## Running it

**Database and backend**

```bash
cd backend
npm install
cp .env.example .env          # then point DATABASE_URL at an existing PostgreSQL database
npx prisma migrate deploy
npx prisma generate
npx prisma db seed            # unit hierarchy
npm run seed:occurrences      # optional: a year of incidents for the statistics screen
npm run seed:water-sources    # optional: demo hydrants
npm run dev                   # http://localhost:3333/api/v1
```

**AI service** (Python 3.12, Poetry)

```bash
cd machine
poetry install
python src/pathfinding/train.py                        # first time only, saves models/path_network.pth
poetry run uvicorn api.main:app --host 127.0.0.1 --port 8000
```

Loading the graph and scoring every edge takes a few dozen seconds. `GET http://127.0.0.1:8000/health` reports
`engine_loaded: true` when it's ready. The C++ module is built with CMake from `machine/src/cpp`.

**Frontend**

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

## Tests

```bash
cd backend
npm test            # unit tests (Jest), Prisma and the AI client are mocked
npm run test:e2e    # end-to-end against the real stack: CRUDs, dispatch lifecycle, WebSocket, AI bridge

cd machine
poetry run pytest -q   # route engine on a synthetic city, no map download

cd frontend
npm test            # manoeuvre language, timeline, palette, coverage
npm run test:e2e    # Playwright at 1440 px and 360 px, with the stack running
```

GitHub Actions (`.github/workflows/ci.yml`) runs the backend, frontend and AI suites on every push.

## API overview

| Resource | |
|---|---|
| `/units` | self-referencing unit hierarchy |
| `GET /units/areas` | area each station reaches first, by response time (not official jurisdiction) |
| `/firefighters`, `/vehicles`, `/crews`, `/shifts` | personnel and fleet |
| `/vehicles/positions`, `/vehicles/:id/positions` | stored vehicle positions |
| `/occurrences` | incidents |
| `/occurrences/:id/timeline`, `POST /occurrences/:id/notes` | incident timeline and operator notes |
| `POST /occurrences/:id/recommendations` | available vehicles ranked by predicted arrival time |
| `/occurrences/:id/hospitals`, `/occurrences/:id/water-sources` | hospitals by travel time and nearest water sources |
| `/dispatches` | vehicle dispatched to an incident |
| `/water-sources` | hydrants, cisterns and intake points |
| `/ai/routes`, `/ai/model`, `/ai/training` | bridge to the AI service (`/ai/routes` accepts `closures`) |
| `POST /ai/coverage`, `GET /ai/edge-costs`, `GET /ai/eta-accuracy` | isochrones, learned street costs, predicted vs. reported arrival |
| `/geo/search`, `/geo/reverse`, `/geo/weather` | address search (Photon/OSM) and weather (Open-Meteo), no API key |
| `/geo/reference-route` | the same trip on the public OSRM server |
| `GET /realtime` | WebSocket: `occurrence.created/updated`, `occurrence.timeline`, `dispatch.created/updated`, `vehicle.moved` |

## Team

Integrator project built by Arthur Roberto Weege Pontes, [@RenanTheFato](https://github.com/RenanTheFato)
and [@felipemsilva758](https://github.com/felipemsilva758). The original repository lives at
[RenanTheFato/projeto-integrador](https://github.com/RenanTheFato/projeto-integrador); this copy
keeps its full history.
