# Narra Captcha Bridge Extension Recovery Design

## Goal

Restore the missing Chrome extension required by Narra Studio's CAPTCHA bridge, make it available from both development and packaged builds, and remove the broken dependency on the retired remote update endpoint.

Success means:

- Chrome can load the extension with **Load unpacked**.
- The extension connects only to Narra's loopback WebSocket bridge at `ws://127.0.0.1:17773`.
- Narra reports extension version `1.3.1` or newer, the active Google Flow project, and successful token verification.
- Development builds and Windows packages contain the same extension files.
- The setup screen opens the bundled extension folder and no longer opens `undefined/captcha-extension.zip`.

## Scope

### Included

- A Manifest V3 Chrome extension owned by this repository.
- A background service worker that tracks Google Flow tabs and speaks the existing bridge protocol.
- A page-context helper that requests reCAPTCHA Enterprise tokens from an already-open Google Flow page.
- Packaging and local-folder discovery for the extension.
- Regression checks for extension structure, permissions, protocol version, and package staging.

### Excluded

- CAPTCHA-solving services or bypass mechanisms.
- Google credential, cookie, token, or 2FA storage.
- Changing the existing Narra bridge protocol or port.
- Publishing to the Chrome Web Store or an external download server.
- Claiming end-to-end Google Flow success without a user-authenticated browser test.

## Architecture

The source of truth will be `apps/desktop/captcha-extension`.

The extension will use these components:

1. `manifest.json`: Manifest V3 metadata, version `1.3.1`, least-privilege permissions, and host access limited to Google Labs/Flow pages.
2. `background.js`: maintains the loopback WebSocket, reconnects with bounded backoff, reports `hello` and `status`, validates incoming message shapes, and routes token requests to the active Flow tab.
3. `page-token.js`: runs in the page's main JavaScript world only on an explicit token request, obtains the reCAPTCHA site key from the loaded enterprise script/page state, validates the requested action against the supported action allowlist, calls `grecaptcha.enterprise.execute`, and returns only the result or a generic error.

The existing desktop bridge remains the protocol owner:

- Extension to app: `hello`, `status`, `captcha_response`, `pong`.
- App to extension: `captcha_request`, `ping`.
- A response is correlated by the numeric request `id`.

## Data Flow

1. Chrome starts the extension service worker.
2. The worker connects to `ws://127.0.0.1:17773` and sends `{type: "hello", client, version}`.
3. The worker queries matching tabs and sends a status containing only booleans and the active Labs URL.
4. Narra sends a `captcha_request` with an ID and an allowed action.
5. The worker selects an active `https://labs.google/fx/tools/flow...` tab and executes the token helper in that tab's main world.
6. The helper waits for the existing reCAPTCHA Enterprise runtime, executes it for the requested action, and returns the token to the worker.
7. The worker sends the correlated `captcha_response` to Narra. It does not persist or log the token.

## Security Constraints

- No remote servers, analytics, update checks, or broad `<all_urls>` access.
- No cookie, identity, storage, clipboard, downloads, debugger, or web-request permission.
- The WebSocket target is a fixed loopback address and port; it is not configurable from page content.
- Page messages cannot trigger arbitrary script execution or select arbitrary URLs.
- CAPTCHA actions are allowlisted to the actions already used by Narra (`IMAGE_GENERATION`, `VIDEO_GENERATION`, and `TEST`).
- Tokens exist only in memory for the duration of a single request and are never written to logs or Chrome storage.
- Errors returned across the bridge are bounded and generic; page stack traces are not forwarded.
- Only a currently open Google Flow project qualifies as ready.

## Desktop and Packaging Changes

- `getExtensionDirectory()` will continue to support development and packaged paths, but it will require a valid `manifest.json` rather than accepting any directory.
- The setup page's download action will be changed to open the bundled folder. The existing **Open extension folder** action remains the installation entry point.
- `scripts/prepare-recovered-desktop-package.mjs` will copy `apps/desktop/captcha-extension` into the staged app.
- `apps/desktop/electron-builder.yml` will include the staged extension as an unpacked resource so Chrome can load real files outside `app.asar`.
- Packaging must fail with a clear error if the extension source or required files are missing.

## Error Handling

- WebSocket unavailable: reconnect with capped delay and report disconnected state without noisy token logging.
- No Flow tab/project: return a bounded error and update status to not ready.
- reCAPTCHA runtime/site key unavailable: fail the request; do not inject a third-party script or use a hidden fallback key in the extension.
- Invalid request ID/action/type: reject without executing page code.
- Tab navigation or closure during execution: fail that request and refresh status.

## Testing Strategy

Implementation follows test-first development.

Automated checks will verify:

- Required extension files and Manifest V3 metadata exist.
- Permissions and host access remain within the approved allowlist.
- Version matches the desktop minimum (`1.3.1`).
- The worker validates protocol messages/actions and never contains token persistence/logging paths.
- Diagnostics reject a directory without a manifest.
- Package staging copies the extension to the location resolved by the packaged app.
- Existing `pnpm typecheck`, `pnpm test`, and `pnpm build` remain green.

Manual verification, which requires the user's signed-in Chrome session, will verify:

1. Open the bundled folder from Narra.
2. Load it from `chrome://extensions` with Developer mode enabled.
3. Open a real Google Flow project.
4. Confirm version/connection/project status in Narra.
5. Run **Verify now** and confirm success without token values appearing in logs.

## Remaining Limitation

Automated tests can establish structure, protocol compatibility, packaging, and security invariants. Only the manual signed-in Chrome test can establish that the current Google Flow page still exposes a compatible reCAPTCHA Enterprise runtime and site-key source.
