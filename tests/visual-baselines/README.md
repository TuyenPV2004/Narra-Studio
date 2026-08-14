# Electron App Shell visual baselines

These images are generated from the isolated unpacked Electron build at a 1440 x 900 renderer viewport.

Update intentionally after visual review:

```powershell
pnpm package:electron-smoke
pnpm smoke:electron-ui:update
```

Verify the current build against the accepted baseline:

```powershell
pnpm smoke:electron-ui
```

The smoke flow opens an isolated profile with GPU rendering disabled, connects to the renderer through local Chrome DevTools Protocol, waits for the startup root/splash heuristics, navigates through the existing `genyu:navigate-page` event to Settings, checks expanded/collapsed Header offsets and masks machine-specific user-folder segments. It compares ARGB pixels with a maximum 0.1% differing-pixel ratio to tolerate minor capture/font rasterization noise while preserving layout-level regression sensitivity. It also reports renderer console/network errors. It does not authenticate, solve CAPTCHA or invoke generation.
