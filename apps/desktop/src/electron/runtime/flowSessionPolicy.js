"use strict";

const AUTH_COOKIE_NAMES = new Set([
  "__Secure-next-auth.session-token",
  "SID",
  "SSID",
  "__Host-GAPS",
  "HSID",
]);

function hasAuthenticationCookie(cookies = []) {
  if (!Array.isArray(cookies)) return false;
  return cookies.some((c) => c && AUTH_COOKIE_NAMES.has(c.name));
}

function classifySessionFetchResult({ status, data, error }) {
  if (error) {
    return { kind: "network-error", message: error?.message || String(error) };
  }

  if (typeof status !== "number") {
    return { kind: "network-error", message: "Unknown status code" };
  }

  // 1. Success 200 OK
  if (status === 200) {
    if (data && data.user && data.user.email) {
      return {
        kind: "authenticated",
        user: {
          email: data.user.email,
          name: data.user.name || null,
          avatar: data.user.image || null,
        },
      };
    }
    // 200 OK but payload does not contain user session (e.g. empty JSON or HTML redirect)
    return { kind: "unauthenticated", status: 200 };
  }

  // 2. Unauthenticated / Forbidden (Direct Session Expiry)
  if (status === 401 || status === 403) {
    return { kind: "unauthenticated", status };
  }

  // 3. Transient / Rate-limiting Errors (Must NOT mark slot as expired)
  if (status === 408 || status === 425 || status === 429) {
    return { kind: "transient-error", status };
  }

  // 4. Redirects (Must NOT mark slot as expired)
  if (status >= 300 && status < 400) {
    return { kind: "redirect-error", status };
  }

  // 5. Server Errors (Must NOT mark slot as expired)
  if (status >= 500 && status < 600) {
    return { kind: "server-error", status };
  }

  // 6. Other Client Errors
  if (status >= 400 && status < 500) {
    return { kind: "client-error", status };
  }

  return { kind: "unknown-error", status };
}

function evaluateSlotStatus({
  cookiesCount = 0,
  hasAuthCookies = false,
  hasBearerToken = false,
  sessionClassification = null,
  previousStatus = "empty",
} = {}) {
  if (cookiesCount === 0) {
    return "empty";
  }

  if (sessionClassification?.kind === "authenticated") {
    return hasBearerToken ? "connected" : "authenticated";
  }

  // ONLY explicit 401/403 unauthenticated with existing auth cookies transitions to expired!
  if (sessionClassification?.kind === "unauthenticated") {
    return hasAuthCookies ? "expired" : "empty";
  }

  // Transient, server, redirect, network, or client errors MUST NEVER mark slot as expired
  if (
    sessionClassification?.kind === "transient-error" ||
    sessionClassification?.kind === "server-error" ||
    sessionClassification?.kind === "network-error" ||
    sessionClassification?.kind === "redirect-error" ||
    sessionClassification?.kind === "client-error" ||
    sessionClassification?.kind === "unknown-error"
  ) {
    if (previousStatus === "connected" && hasBearerToken) {
      return "connected";
    }
    if (previousStatus === "authenticated") {
      return "authenticated";
    }
    if (hasAuthCookies || cookiesCount > 0) {
      return "error";
    }
    return "empty";
  }

  return "empty";
}

module.exports = {
  AUTH_COOKIE_NAMES,
  hasAuthenticationCookie,
  classifySessionFetchResult,
  evaluateSlotStatus,
};
