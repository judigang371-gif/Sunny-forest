# Sunny Quest authoritative multiplayer server (prototype)

This is a **standalone prototype**, not yet wired into `khjoo.html` or deployed.

## Run

Requires Node.js 20+.

```sh
cd server
npm install
npm start
```

Health check: `http://localhost:8080/health`. WebSocket endpoint: `ws://localhost:8080`.

Deploy to a service that runs persistent Node.js processes and supports WebSockets; use `wss://` from the HTTPS GitHub Pages client. Configure the host's `PORT` environment variable as needed.

## Protocol

Client sends:
- `{"type":"join","map":"forest","name":"Player","x":200,"y":200}`
- `{"type":"input","dx":1,"dy":0}` (movement direction, -1 to 1)
- `{"type":"attack","dx":1,"dy":0}` (attack direction)

Server sends:
- `welcome` with assigned player ID
- `snapshot` with authoritative players, enemies, projectiles and sequence number (10/s)
- `hurt` with server-side HP and damage
- `kill` when an enemy is defeated
- `error` for unsupported maps

## Important limitations before production

- **No authentication or Firebase ID-token verification.** Do not expose this prototype publicly as a trusted production game server.
- Only forest, blueforest and purpleforest have basic enemy simulation. Bosses, dungeon rooms, walls, skills, armor, drops, PvP and persistence are **not implemented**.
- Movement is currently direction-input based, with a fixed per-message step; implement per-client input buffering and fixed-tick processing before enabling public multiplayer.
- Enemy attack power and player attack damage are provisional. Implement server-side equipment/class stats and cooldown validation.
- No reconnection, room capacity, abuse prevention, cross-instance coordination or persistence yet.
- The existing Firebase room-leader implementation in `khjoo.html` remains active until a tested migration replaces it.

## Migration steps

1. Deploy the server privately and enable WSS.
2. Verify Firebase Auth ID tokens server-side.
3. Implement all current game maps, walls, skills, hitboxes and server-authoritative rewards.
4. Add a client adapter that sends inputs and renders snapshots without local monster simulation.
5. Run two-player tests, then switch multiplayer over behind a feature flag.
