# Centre proxy - SwiftShader validation state (2026-10-29, PARKED)

The geometric far proxy for the seed centre (0986edf + bounds fix 0bc191a) is
**state-machine verified but NOT visually validated in the integrated app**. It
stays gated behind `?detail=geometry`, default OFF. Do not enable by default until
the integrated visual gate closes on real GPU hardware.

## Verified
- Bounds fix: `GEO.manhattan` is an x,z ring, not a bbox; reading it as a bbox
  degenerated the hysteresis band (centre hid itself at any distance). Fixed in 0bc191a.
- Toggle state machine (headless Chrome, real app, fixed cameras): FAR state shows
  proxy + hides detailed centre; distance-detail DISABLED restores detailed centre and
  hides the proxy. No page errors.
- Geometry: proxy-only render is CLEAN (flat-color massing, 262,161 tris drawn,
  matching the Node-measured 262,160). The proxy mesh itself is not broken.

## Open (root cause unresolved)
- Full-app captures under SwiftShader (headless, `--use-angle=swiftshader`) are
  corrupt: noise band + striped ground + occasional exploded-vertex frames, plus one
  tab crash on a 1500 m top-down render.
- The corruption persists with the ENTIRE centre group hidden, so it is not caused by
  the proxy code - but that does not prove it is a generic SwiftShader fault either;
  the corrupting content (streamed tiles / aerial / monument mesh) is unidentified.
- Both `canvas.toDataURL` and `gl.readPixels` readback paths show it, so it is in the
  render, not the readback.
- Codex's earlier hardware validation (docs/validation/2026-10-28-far-geometry.json)
  used a real GPU and worked - the corruption is specific to this sandbox's software
  renderer.

## Parked, not resolved
Per user direction 2026-10-29 00:08 ("si hay algún problema o no encuentras solución,
continúa por otro lado"). Resume path: validate `?detail=geometry` on the user's real
GPU, or identify the corrupting mesh by extending the scene bisect (hide groups one at
a time) if software-render evidence is ever needed again.
