# Quality-gate tooling (orchestrator-only, never part of an upstream PR)

- `Dockerfile` builds `majoor-gate:local` (node:24-bookworm + Python 3.11 venv with requirements-dev, exiftool, ffmpeg). Build: copy requirements*.txt next to it, `docker build -t majoor-gate:local .`
- `gate.sh <worktree>` runs the full `npm run quality` gate in the container as the invoking user, with explicit handling of what is red on upstream main: pip-audit (Pillow CVEs) informational; Prettier checked as per-file drift vs merge-base (must not grow; a drop is warned).
- `node.sh <worktree> <cmd...>` runs any node/npm command in the container (homelab rule: never node on the host).
