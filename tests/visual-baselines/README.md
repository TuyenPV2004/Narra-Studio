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

The smoke flow opens the source-built production renderer with an isolated profile and GPU rendering disabled. It connects through local Chrome DevTools Protocol, navigates with the preserved `genyu:navigate-page` event, checks expanded/collapsed Header offsets and compares ARGB pixels with a maximum 0.1% differing-pixel ratio. It reports renderer console/network errors and never authenticates, solves CAPTCHA, invokes generation, exports media or spends provider credit.
