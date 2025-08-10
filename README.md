# WebGL Cloud Chamber (3D, Webpack)

A minimal single-page WebGL simulation of a cloud chamber. Tracks are rendered as glowing points with an accumulation buffer to create fading trails. Curvature depends on a user-controlled magnetic field; track thickness and brightness depend on the "vapor" setting. Click to inject an ionization event; drag to orbit the camera; scroll to zoom.

## Run (dev)

```bash
npm install
npm run serve
# will open http://localhost:9000 serving /public which loads dist/bundle.js
```

## Build

```bash
npm run build
# outputs dist/bundle.js
```

Then open `public/index.html` in a static server (or file URL).

> Note: A prebuilt `dist/bundle.js` is included so you can open `public/index.html` immediately without building.
