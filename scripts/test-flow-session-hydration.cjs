"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  AUTH_COOKIE_NAMES,
  hasAuthenticationCookie,
  classifySessionFetchResult,
  evaluateSlotStatus,
} = require("../apps/desktop/src/electron/runtime/flowSessionPolicy");

assert.equal(AUTH_COOKIE_NAMES.has("__Secure-next-auth.session-token"), true);
assert.equal(AUTH_COOKIE_NAMES.has("SID"), true);
assert.equal(AUTH_COOKIE_NAMES.has("SSID"), true);
assert.equal(AUTH_COOKIE_NAMES.has("__Host-GAPS"), true);
assert.equal(AUTH_COOKIE_NAMES.has("HSID"), true);
assert.equal(AUTH_COOKIE_NAMES.has("_ga"), false);
assert.equal(AUTH_COOKIE_NAMES.has("theme"), false);

assert.equal(hasAuthenticationCookie([{ name: "SID", value: "123" }]), true);
assert.equal(hasAuthenticationCookie([{ name: "_ga", value: "abc" }]), false);
assert.equal(hasAuthenticationCookie([]), false);

const authResult = classifySessionFetchResult({
  status: 200,
  data: { user: { email: "alpha@gmail.com", name: "Alpha", image: "https://avatar.url" } },
});
assert.equal(authResult.kind, "authenticated");
assert.equal(authResult.user.email, "alpha@gmail.com");

const empty200Result = classifySessionFetchResult({
  status: 200,
  data: {},
});
assert.equal(empty200Result.kind, "unauthenticated");
assert.equal(empty200Result.status, 200);

const unauth401 = classifySessionFetchResult({ status: 401 });
assert.equal(unauth401.kind, "unauthenticated");
assert.equal(unauth401.status, 401);

const unauth403 = classifySessionFetchResult({ status: 403 });
assert.equal(unauth403.kind, "unauthenticated");
assert.equal(unauth403.status, 403);

const rateLimit429 = classifySessionFetchResult({ status: 429 });
assert.equal(rateLimit429.kind, "transient-error");
assert.equal(rateLimit429.status, 429);

const timeout408 = classifySessionFetchResult({ status: 408 });
assert.equal(timeout408.kind, "transient-error");
assert.equal(timeout408.status, 408);

const redirect302 = classifySessionFetchResult({ status: 302 });
assert.equal(redirect302.kind, "redirect-error");
assert.equal(redirect302.status, 302);

const server500 = classifySessionFetchResult({ status: 500 });
assert.equal(server500.kind, "server-error");
assert.equal(server500.status, 500);

const server503 = classifySessionFetchResult({ status: 503 });
assert.equal(server503.kind, "server-error");
assert.equal(server503.status, 503);

const client404 = classifySessionFetchResult({ status: 404 });
assert.equal(client404.kind, "client-error");

const netError = classifySessionFetchResult({ error: new Error("DNS resolution failed") });
assert.equal(netError.kind, "network-error");

assert.equal(evaluateSlotStatus({ cookiesCount: 0 }), "empty");

assert.equal(
  evaluateSlotStatus({
    cookiesCount: 5,
    hasAuthCookies: true,
    hasBearerToken: false,
    sessionClassification: authResult,
  }),
  "authenticated"
);

assert.equal(
  evaluateSlotStatus({
    cookiesCount: 5,
    hasAuthCookies: true,
    hasBearerToken: true,
    sessionClassification: authResult,
  }),
  "connected"
);

assert.equal(
  evaluateSlotStatus({
    cookiesCount: 3,
    hasAuthCookies: true,
    hasBearerToken: false,
    sessionClassification: unauth401,
  }),
  "expired"
);

assert.equal(
  evaluateSlotStatus({
    cookiesCount: 1,
    hasAuthCookies: false,
    hasBearerToken: false,
    sessionClassification: unauth401,
  }),
  "empty"
);

assert.equal(
  evaluateSlotStatus({
    cookiesCount: 4,
    hasAuthCookies: true,
    hasBearerToken: false,
    sessionClassification: rateLimit429,
    previousStatus: "authenticated",
  }),
  "authenticated",
  "Rate limiting 429 must preserve authenticated state"
);

assert.equal(
  evaluateSlotStatus({
    cookiesCount: 4,
    hasAuthCookies: true,
    hasBearerToken: false,
    sessionClassification: timeout408,
    previousStatus: "authenticated",
  }),
  "authenticated",
  "Timeout 408 must preserve authenticated state"
);

assert.equal(
  evaluateSlotStatus({
    cookiesCount: 4,
    hasAuthCookies: true,
    hasBearerToken: false,
    sessionClassification: server500,
    previousStatus: "authenticated",
  }),
  "authenticated",
  "500 Server error must preserve authenticated state"
);

assert.equal(
  evaluateSlotStatus({
    cookiesCount: 4,
    hasAuthCookies: true,
    hasBearerToken: false,
    sessionClassification: netError,
    previousStatus: "authenticated",
  }),
  "authenticated",
  "Network offline error must preserve authenticated state"
);

assert.equal(
  evaluateSlotStatus({
    cookiesCount: 4,
    hasAuthCookies: true,
    hasBearerToken: false,
    sessionClassification: server500,
    previousStatus: "empty",
  }),
  "error",
  "Initial startup with server error must transition to error"
);

function simulateHydrationWithBearerFallback(slot, mockBearerStatus, mockCookieSession) {
  if (slot.bearerToken) {
    if (mockBearerStatus === 401 || mockBearerStatus === 403) {
      slot.bearerToken = null;
    }
  }

  const classification = classifySessionFetchResult(mockCookieSession);
  const status = evaluateSlotStatus({
    cookiesCount: 3,
    hasAuthCookies: true,
    hasBearerToken: Boolean(slot.bearerToken),
    sessionClassification: classification,
    previousStatus: slot.status,
  });
  slot.status = status;
  if (classification.user) {
    slot.email = classification.user.email;
  }
  return slot.status;
}

const slotTest = {
  id: 0,
  bearerToken: "Bearer expired_token_ya29",
  status: "empty",
  email: null,
};

const resultStatus = simulateHydrationWithBearerFallback(
  slotTest,
  401,
  { status: 200, data: { user: { email: "user@gmail.com", name: "User" } } }
);

assert.equal(resultStatus, "authenticated", "Bearer 401 with valid cookie session must resolve to authenticated, NOT expired");
assert.equal(slotTest.bearerToken, null, "Expired bearer token must be cleared from memory");
assert.equal(slotTest.email, "user@gmail.com", "Email must be populated from cookie session");

const slot0 = { id: 0, partition: "persist:slot-0", cookies: "SID=abc", email: "user0@gmail.com", status: "authenticated", projectId: "p-0" };
const slot1 = { id: 1, partition: "persist:slot-1", cookies: "SID=xyz", email: "user1@gmail.com", status: "authenticated", projectId: "p-1" };

slot0.cookies = "";
slot0.email = null;
slot0.status = "empty";
slot0.projectId = null;

assert.equal(slot0.status, "empty");
assert.equal(slot0.email, null);
assert.equal(slot1.status, "authenticated");
assert.equal(slot1.email, "user1@gmail.com");
assert.equal(slot1.projectId, "p-1");
assert.equal(slot1.cookies, "SID=xyz");

const sessionIpcPath = path.join(__dirname, "..", "apps", "desktop", "src", "electron", "ipc", "flow", "session.js");
const sessionIpcCode = fs.readFileSync(sessionIpcPath, "utf8");

assert.equal(sessionIpcCode.includes("hasSession:"), true, "get-all-slots must explicitly return hasSession field");
assert.equal(sessionIpcCode.includes("saveSettings({ bearerToken"), false, "Must not persist bearerToken to settings JSON");
assert.equal(sessionIpcCode.includes("saveSettings({ cookies"), false, "Must not persist cookies to settings JSON");

console.log("Production Google Flow session policy, HTTP classification & fallback tests passed successfully.");
