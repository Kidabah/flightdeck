# MakerDeck

Standalone parametric container generator with live 3D preview and STL export.

**Not wired into Flightdeck yet** — this is its own thing so you can iterate on phone-friendly quoting later without touching the print ops stack.

## Run locally

From this folder, serve the static files (ES modules need HTTP, not `file://`):

```bash
# Python
python -m http.server 8765

# or Node
npx serve .
```

Open [http://localhost:8765](http://localhost:8765)

## MVP features

- **Shapes:** rectangular box, rounded box, hexagonal container
- **Sliders:** inner size, wall thickness, floor thickness, corner radius (rounded)
- **Live preview:** Three.js orbit/zoom on a virtual bed
- **Export:** binary STL download with sensible filename

## Roadmap (later)

- Slip / snap lids
- Vase profile editor (revolve)
- Batch “set of N boxes”
- Quote PDF / email share link
- Flightdeck hook: slice → queue → dispatch

## Stack

Vanilla HTML/CSS/JS, Three.js (CDN), no build step.
