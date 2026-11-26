# @pebble3d/mcp-server (M2 stub)

Not implemented in milestone 1. M2 scope:

- An MCP server that lets an agent author and run a scene: load/patch `scene.json`, step the sim, take screenshots (reusing `pnpm shot`).
- Spatial queries (`raycast`, overlap, nearest-surface) over the Rust/WASM Rapier world.
- Diagnostics: stats, sim state hash, console errors, per-body state.
- A headless CLI runner that shares the same entry points.
