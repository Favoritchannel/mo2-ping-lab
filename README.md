# MO2 Ping Lab

**A network path analyzer for [Mortal Online 2](https://www.mortalonline2.com/) — measure your real route to the NA (Sarducaa) server, compare it against a relay, and find out whether a "ping booster" would actually help you *before* paying for one.**

> ⚠️ Community test tool. Not affiliated with or endorsed by Star Vault AB.
> It only *measures* network latency — it does not read game memory, inject anything, or interact with the game client in any way.

## Why this exists

Mortal Online 2 is a first-person melee MMO where parry timing lives and dies by latency — and more importantly, by latency *stability*. The NA server for the Sarducaa continent is hosted at OVH Beauharnois (Québec, Canada).

Commercial ping boosters (ExitLag, GearUP, LagoFast…) reroute your game traffic through their private networks. Sometimes that genuinely helps — bad ISP peering, evening congestion, packet loss. Often it does nothing, because your direct route is already optimal, and you're paying a subscription for +3 ms of overhead.

**The only honest way to know is to measure.** That's what this tool does:

- your **actual current route** to the game server (through a VPN/tunnel if one is active),
- the **direct path** to the game's datacenter,
- optionally, a path through **your own WireGuard relay** (see below).

It then tells you which path wins — by median RTT *and* tail stability (p95) — and keeps a run history so you can compare "before" and "after" enabling a tunnel.

## How it works

- **RTT = TCP handshake time.** No ICMP, no raw sockets, no admin rights, locale-independent. The game server blocks ping (ICMP) anyway — but it answers TCP on its game port, and a SYN→SYN-ACK round trip is exactly one network RTT.
- **Warm-up discard.** The first connection on Windows routinely costs hundreds of extra milliseconds (route/ARP warm-up). It is measured and thrown away so it can't wreck the jitter stats.
- **25 samples per path** (configurable), all paths measured in parallel. Reported per path: median, average, min/max, p95, jitter (σ), packet loss, and a sparkline of every sample.
- **Verdict.** Paths are scored as `median + (p95 − median) / 2` — a path that's occasionally terrible loses to one that's consistently okay, which is what melee timing actually feels like.
- **Before/After.** Every run is stored locally (`%APPDATA%/MO2 Ping Lab/history.json`). The app automatically pairs a tunnel-off run with a tunnel-on run and shows the delta per path.
- **Tunnel awareness.** If a WireGuard interface (`wg*`) is up, the app detects it — and the "game server" path then measures the route *through* the tunnel, because that's how you'd actually play.

## Running it

```bash
npm install
npm start          # dev run
npm run dist       # build a portable Windows .exe into dist/
```

Requirements: Node 20+, Windows. The built exe is portable — no install, no admin needed for measuring.

## Adding your own relay

The whole point of a relay is to sit *next to the game server* (OVH Beauharnois / Montréal region) and give your traffic a cleaner route than your ISP's default. A $0 Oracle Cloud free-tier VM in the Montréal region with WireGuard works fine.

Drop a `paths.json` next to the exe (or edit the bundled one) — see [`paths.example.json`](paths.example.json):

```json
{
  "id": "relay",
  "name": "Via my relay",
  "host": "YOUR_RELAY_IP",
  "port": 22,
  "extraMs": 1.7,
  "role": "relay"
}
```

`extraMs` is the relay→datacenter RTT you measured from the relay itself. `port` is any TCP port your relay answers on. The external `paths.json` overrides the bundled config — no rebuild needed.

Expectation management, from real measurements: if you're geographically close (US East/Midwest) your direct route is probably already near-optimal and a relay adds ~3–5 ms of overhead for nothing. The relay wins when your ISP's route to Québec is congested or lossy — common from Eastern Europe. **Measure, don't guess.**

## Dev notes

- `PINGLAB_AUTOTEST=C:\path\shot.png npm start` — runs one measurement, saves a window screenshot, exits (used for CI-less self-testing).
- The UI background is any `renderer/bg.png` you provide (not shipped in the repo).
- Private builds can bundle `paths.private.json` (gitignored) and a WireGuard client config; the public build contains neither.

## License

MIT — see [LICENSE](LICENSE).
