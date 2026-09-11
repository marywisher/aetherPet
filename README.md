# aetherPet

**An open-source, pluggable, low-frequency AI companion pet.** 🍃🐾

aetherPet is a spiritual successor to *Travel Frog (旅かえる)*: your pet lives quietly in its own little world — it wanders, watches the water, counts leaves, and every once in a while writes *you* a letter. No social networks, no leaderboards, no FOMO. Just a small, warm presence that remembers you.

> 中文版说明见 [README.zh-CN.md](./README.zh-CN.md)

---

## Why it exists

The beloved game *Travel Frog* will officially cease operations on December 8, 2026. However, its gameplay and spirit should not be abandoned just like that. Therefore, we plan to create our own version.

aetherPet is designed as **an open ecosystem**, not a closed app:

- **核心基座 (core kernel) + pluggable packs** — the event engine and the "presentation layer" (visual + copy) are fully decoupled. Anyone can reskin the pet by providing a *theme/voice pack* (JSON + CSS + images) — no code required.
- **Hermit mode by default** — each pet lives independently, never interacting with other pets. No social pressure, no interaction quotas.
- **Data sovereignty** — your pet's memories and timeline belong to *you*. Export everything as JSON, migrate to another service hub later.
- **Low-frequency by design** — the pet's proactive reach-out *backs off* the longer you're away (1 day → 3 days → 7 days → 30 days, like a thoughtful friend). Come back whenever; it waited.

## Current status

| Stage | Module | Status |
|-------|--------|--------|
| 0–1 | Requirements · Architecture · Foundation · Auth · Pack loader | ✅ done |
| 2 | Pet FSM · Event engine · Contract freeze v1.0.1 | ✅ done |
| 3 | Catch-up simulation · Backoff · Timeline UI | ✅ done |
| 4 | Daily gift + reply letter | ✅ done |
| 5 | Announcements + profile | ✅ done |
| 6 | Export/import · Deploy · Perf smoke | ✅ done (2026-09-10) |

See [`docs/dev-stage-plan.md`](docs/dev-stage-plan.md) for the full plan and [`docs/requirements.md`](docs/requirements.md) for the MVP spec. Self-hosting guide: [`docs/SELF_HOST.md`](docs/SELF_HOST.md).

## Tech stack

- **TypeScript + Next.js (App Router)** — full stack, single deployable
- **MySQL 8.x** via `mysql2` (async pool) — production-grade, BT-panel friendly
- **Domain layer is pure TS** — zero `next`/`react` imports, independently testable with Vitest
- Validation: `zod` · Tests: `vitest` (138+ unit tests)

## Quick start (development)
Prerequisites: Node ≥ 20, Docker (for local MySQL), npm.

### Windows PowerShell

If PowerShell blocks `npm`, use `npm.cmd` instead:

```powershell
npm.cmd install
npm.cmd run db:up
npm.cmd run dev
```
```bash
# 1. install deps
npm install

# 2. start local MySQL (MySQL 8 identical to production)
npm run db:up

# 3. copy env template and fill in SMTP (any SMTP; the hub's own mail)
cp .env.example .env.local   # set DB_*, SMTP_*, HUB_* values

# 4. run dev server
npm run dev
# open http://localhost:3000
```

Walkthrough: sign up with your email → you receive a magic code (email body carries the **hub identity**: hub name, privacy page, admin contact) → name your pet → land on the home scene, pet sitting at home.

```bash
npm test          # unit tests
npm run typecheck # tsc --noEmit
npm run build     # production build
```

## Logging

Daily-rotating file logs (server-only) at `logs/YYYY-MM-DD.log`.

| Env | Default | Meaning |
|-----|---------|---------|
| `LOG_DIR` | `logs` | log directory |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LOG_CONSOLE` | `1` | also print to console (`0` to disable) |

Use in code: `import { createLogger } from "@/lib/logger"; const l = createLogger("auth");`

## Docs index

| Document | Purpose |
|----------|---------|
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary (authoritative terms: hermit mode, catch-up, backoff…) |
| [`docs/requirements.md`](docs/requirements.md) | MVP requirements & 11 acceptance items |
| [`docs/architecture.md`](docs/architecture.md) | Architecture (event-voice pack contract, catch-up, deploy) |
| [`docs/database-schema.md`](docs/database-schema.md) | MySQL DDL & index design |
| [`docs/dev-stage-plan.md`](docs/dev-stage-plan.md) | 6-stage development plan & verification matrix |
| [`docs/asset-prompts.md`](docs/asset-prompts.md) | Image prompts for the hand-drawn asset pack (JIMENG) |

## Contributing

We welcome co-creators — start with [`CONTRIBUTING.md`](CONTRIBUTING.md) for task list (`good first issue` / `help wanted`), conventions and quality gates.

- **Want to join the core dev?** Read `CONTRIBUTING.md` and `docs/dev-stage-plan.md`, pick an unfinished stage, open an issue to coordinate.
- **Want to contribute a theme/voice pack?** The pack contract is frozen at v1.0.1 (`docs/packs-contract.md`) — a pack is just JSON + CSS + images. You can reskin the pet without touching code.
- **Found a bug?** Open an issue with the reproduction steps and the relevant log line from `logs/`.

Roadmap (not in MVP): Live2D expression, AI dialogue, generated postcards, plugin marketplace, currency/market, multi-hub federation.

## License

Open-core: the core kernel is open source (license to be finalized before first release); some value-added services may be closed-source plugins. Details pending.

---

*Made with 🍵 for people who want a small presence, not another feed.*
