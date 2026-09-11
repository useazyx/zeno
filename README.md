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

## Running it

**Database and backend**

```bash
cd backend
npm install
npx prisma migrate deploy
npx prisma generate
npx prisma db seed            # unit hierarchy
npm run seed:occurrences      # optional: a year of incidents for the statistics screen
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
```

## API overview

| Resource | |
|---|---|
| `/units` | self-referencing unit hierarchy |
| `/firefighters`, `/vehicles`, `/crews`, `/shifts` | personnel and fleet |
| `/occurrences` | incidents |
| `/dispatches` | vehicle dispatched to an incident |
| `/ai/routes`, `/ai/model`, `/ai/training` | bridge to the AI service |
| `GET /realtime` | WebSocket: `occurrence.created/updated`, `dispatch.created/updated`, `vehicle.moved` |

## Team

Integrator project built by Arthur Roberto Weege Pontes, [@RenanTheFato](https://github.com/RenanTheFato)
and [@felipemsilva758](https://github.com/felipemsilva758). The original repository lives at
[RenanTheFato/projeto-integrador](https://github.com/RenanTheFato/projeto-integrador); this copy
keeps its full history.
