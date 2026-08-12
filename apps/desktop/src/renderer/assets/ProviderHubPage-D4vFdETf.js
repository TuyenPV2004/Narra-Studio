import {
  j as e,
  f as w,
  a as X,
  u as Y,
  B as Z,
  I as ee,
} from "./index-JlIFz2Wa.js";
import {
  _ as re,
  K as _,
  b as R,
  aD as U,
  b2 as $,
  x as se,
  aJ as B,
  a as t,
  A as ae,
} from "./lucide-BG4Ur802.js";
import { P as D } from "./ProviderLogo-BxSBVG8E.js";
import oe from "./Veo3LoginPage-D2tPD0vF.js";
import { B as W } from "./BrandButton-BUkBwN3T.js";
import "./recharts-CJY_liWu.js";
/* empty css                           */ import "./captcha-V3drNB7x.js";
import "./slotName-1HnJL09W.js";
function de({ tone: n = "neutral", className: p = "", children: h, ...c }) {
  return e.jsx("span", {
    ...c,
    className: `brand-badge brand-badge--${n} ${p}`.trim(),
    children: h,
  });
}
function le({
  busy: n,
  loading: p,
  connected: c,
  title: y,
  description: H,
  continueLabel: E,
  preparingLabel: L,
  prepareAccountLabel: S,
  journeyLabel: C,
  connectionLabel: k,
  createLabel: I,
  visualLabel: A,
  visualTitle: v,
  visualDescription: g,
  onContinue: r,
}) {
  const l = [
    { icon: $, label: k, done: c },
    { icon: se, label: I, done: !1 },
  ];
  return e.jsxs("section", {
    className: "atelier-launchpad",
    children: [
      e.jsxs("div", {
        className: "atelier-launchpad-copy",
        children: [
          e.jsxs("div", {
            className: "atelier-edition",
            children: [
              e.jsx(re, { size: 14 }),
              e.jsxs("span", {
                children: [w.displayNameUpper, " · CREATIVE ATELIER"],
              }),
            ],
          }),
          e.jsx("h1", { children: y }),
          e.jsx("p", { children: H }),
          e.jsxs("div", {
            className: "atelier-launchpad-actions",
            children: [
              e.jsx(W, {
                variant: "primary",
                size: "lg",
                className: "atelier-primary-action",
                disabled: n || p,
                onClick: r,
                children: n
                  ? e.jsxs(e.Fragment, {
                      children: [
                        e.jsx(_, { size: 17, className: "spin" }),
                        " ",
                        L,
                      ],
                    })
                  : e.jsxs(e.Fragment, {
                      children: [E, " ", e.jsx(R, { size: 17 })],
                    }),
              }),
              e.jsxs("button", {
                type: "button",
                className: "atelier-secondary-action",
                onClick: () =>
                  window.api.openExternalUrl("https://labs.google/fx"),
                children: [S, " ", e.jsx(U, { size: 14 })],
              }),
            ],
          }),
          e.jsx("div", {
            className: "atelier-journey",
            "aria-label": C,
            children: l.map((s, d) => {
              const o = s.icon;
              return e.jsxs(
                "div",
                {
                  className: `atelier-journey-step ${s.done ? "done" : ""}`,
                  children: [
                    e.jsx("span", {
                      className: "atelier-step-index",
                      children: s.done
                        ? e.jsx(B, { size: 13, strokeWidth: 2.8 })
                        : String(d + 1).padStart(2, "0"),
                    }),
                    e.jsx(o, { size: 16, strokeWidth: 1.7 }),
                    e.jsx("strong", { children: s.label }),
                  ],
                },
                s.label,
              );
            }),
          }),
        ],
      }),
      e.jsxs("div", {
        className: "atelier-visual-caption",
        children: [
          e.jsxs(de, {
            tone: "brand",
            className: "atelier-visual-provider",
            children: [e.jsx(D, { providerId: "veo3" }), " Google Flow"],
          }),
          e.jsxs("div", {
            children: [
              e.jsx("small", { children: A }),
              e.jsx("strong", { children: v }),
              e.jsx("p", { children: g }),
            ],
          }),
        ],
      }),
    ],
  });
}
const T = "veo3",
  ce = !1;
function fe({
  active: n,
  statuses: p,
  loading: h,
  auth: E,
  isLoggingIn: L,
  captchaSetupReady: S,
  onChoose: C,
  onActivate: j,
  onFinish: I,
  onVeo3LoginComplete: A,
  onToast: v,
}) {
  const { locale: g } = X(),
    r = Y("settings"),
    l = [],
    [s, d] = t.useState("provider"),
    [o, F] = t.useState(T),
    [b, u] = t.useState(!1),
    [f, P] = t.useState(""),
    [z, m] = t.useState(""),
    [x, K] = t.useState(0),
    O = t.useRef([]),
    N = p[o];
  (t.useEffect(() => {
    n && (d("provider"), F(T), m(""), P(""));
  }, [n]),
    t.useEffect(() => {
      x >= l.length && K(0);
    }, [x, l.length]),
    t.useEffect(() => {
      if (
        !n ||
        l.length < 2 ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
      const i = window.setInterval(() => {
        K((a) => (a + 1) % l.length);
      }, 5600);
      return () => window.clearInterval(i);
    }, [n, l.length]),
    t.useEffect(() => {
      O.current.forEach((i, a) => {
        i &&
          (n && a === x
            ? ((i.currentTime = 0), i.play().catch(() => {}))
            : i.pause());
      });
    }, [n, x]));
  const V = async () => {
      (u(!0), m(""));
      try {
        const i = await j(o);
        d(i.ready ? "ready" : "connect");
      } catch (i) {
        (m(i instanceof Error ? i.message : String(i)), d("connect"));
      } finally {
        u(!1);
      }
    },
    G = async (i) => {
      if (!b) {
        (u(!0), m(""));
        try {
          (F(i), await C(i));
          const a = await j(i);
          d(a.ready ? "ready" : "connect");
        } catch (a) {
          v(a instanceof Error ? a.message : String(a), "error");
        } finally {
          u(!1);
        }
      }
    },
    M = () => void G(o),
    Q = async () => {
      if (!(!f.trim() || b)) {
        (u(!0), m(""));
        try {
          await window.api.saveOllamaSettings({
            provider: "avis",
            avisApiKey: f.trim(),
          });
          const i = await j("avis");
          if (!i.ready)
            throw new Error(i.error || r("providerHub.avis.rejected"));
          (P(""),
            d("ready"),
            v(r("providerHub.avis.connectedToast"), "success"));
        } catch (i) {
          m(i instanceof Error ? i.message : String(i));
        } finally {
          u(!1);
        }
      }
    };
  return (
    t.useEffect(() => {
      s === "connect" && N?.ready && d("ready");
    }, [N?.ready, s]),
    n
      ? e.jsxs("div", {
          className: `page active provider-hub-page atelier-step-${s}`,
          children: [
            e.jsx("div", {
              className: "provider-wizard-media",
              "aria-hidden": "true",
              children: l.map((i, a) =>
                i.kind === "video"
                  ? e.jsx(
                      "video",
                      {
                        ref: (q) => {
                          O.current[a] = q;
                        },
                        className: a === x ? "active" : "",
                        src: i.url,
                        poster: i.poster,
                        title: i.title,
                        muted: !0,
                        loop: !0,
                        playsInline: !0,
                        preload: a < 2 ? "auto" : "metadata",
                      },
                      i.id,
                    )
                  : e.jsx(
                      "img",
                      {
                        className: a === x ? "active" : "",
                        src: i.url,
                        alt: "",
                        title: i.title,
                        loading: a < 2 ? "eager" : "lazy",
                        draggable: !1,
                      },
                      i.id,
                    ),
              ),
            }),
            e.jsx("div", {
              className: "provider-wizard-ambient provider-wizard-ambient-one",
            }),
            e.jsx("div", {
              className: "provider-wizard-ambient provider-wizard-ambient-two",
            }),
            e.jsx("header", {
              className: "provider-wizard-topbar",
              children: e.jsxs("div", {
                className: "provider-wizard-brand",
                children: [
                  e.jsx(Z, { className: "provider-wizard-logo" }),
                  e.jsx("small", { children: r("providerHub.welcome") }),
                ],
              }),
            }),
            e.jsxs("main", {
              className: `provider-wizard-stage step-${s} provider-${o}`,
              children: [
                s !== "provider" &&
                  s !== "ready" &&
                  e.jsxs("button", {
                    className: "provider-wizard-back",
                    onClick: () => d(s === "connect" ? "provider" : "connect"),
                    children: [
                      e.jsx(ae, { size: 15 }),
                      " ",
                      r("providerHub.back"),
                    ],
                  }),
                s === "provider" &&
                  e.jsx(le, {
                    busy: b,
                    loading: h,
                    connected: !!p.veo3?.configured,
                    title: r("providerHub.atelier.title"),
                    description: r("providerHub.atelier.description"),
                    continueLabel: r("providerHub.atelier.start"),
                    preparingLabel: r("providerHub.preparing"),
                    prepareAccountLabel: r("providerHub.prepareAccount"),
                    journeyLabel: r("providerHub.atelier.journey"),
                    connectionLabel: r("providerHub.atelier.connection"),
                    createLabel: r("providerHub.atelier.create"),
                    visualLabel: r("providerHub.atelier.visualLabel"),
                    visualTitle: r("providerHub.atelier.visualTitle"),
                    visualDescription: r(
                      "providerHub.atelier.visualDescription",
                    ),
                    onContinue: M,
                  }),
                s === "connect" &&
                  o === "avis" &&
                  e.jsxs("section", {
                    className: "provider-wizard-connect-card avis",
                    children: [
                      e.jsxs("header", {
                        className: "provider-wizard-connect-heading",
                        children: [
                          e.jsx("span", {
                            className: "provider-wizard-connect-logo",
                            children: e.jsx(D, { providerId: "avis" }),
                          }),
                          e.jsxs("div", {
                            children: [
                              e.jsx("span", {
                                className: "provider-wizard-eyebrow",
                                children: "External AI",
                              }),
                              e.jsx("h1", {
                                children: r("providerHub.avis.title"),
                              }),
                              e.jsx("p", {
                                children: r("providerHub.avis.description"),
                              }),
                            ],
                          }),
                        ],
                      }),
                      e.jsxs("label", {
                        className: "provider-wizard-key-field",
                        children: [
                          e.jsx("span", {
                            children: r("providerHub.avis.yourKey"),
                          }),
                          e.jsx("input", {
                            type: "password",
                            value: f,
                            onChange: (i) => P(i.target.value),
                            placeholder: r("providerHub.avis.placeholder"),
                            autoFocus: !0,
                            autoComplete: "off",
                          }),
                        ],
                      }),
                      e.jsxs("div", {
                        className: "provider-wizard-key-note",
                        children: [
                          e.jsx(B, { size: 14 }),
                          " ",
                          r("providerHub.avis.localOnly"),
                        ],
                      }),
                      z &&
                        e.jsx("div", {
                          className: "provider-wizard-error",
                          children: z,
                        }),
                      e.jsxs("div", {
                        className: "provider-wizard-connect-actions",
                        children: [
                          e.jsxs("button", {
                            type: "button",
                            className: "provider-wizard-buy-key",
                            onClick: () =>
                              window.api.openExternalUrl(
                                "https://www.avis.xyz/",
                              ),
                            children: [
                              r("providerHub.avis.openAvis"),
                              " ",
                              e.jsx(U, { size: 14 }),
                            ],
                          }),
                          e.jsx(W, {
                            variant: "primary",
                            size: "lg",
                            className: "provider-wizard-primary",
                            disabled: !f.trim() || b,
                            onClick: () => void Q(),
                            children: b
                              ? e.jsxs(e.Fragment, {
                                  children: [
                                    e.jsx(_, { size: 17, className: "spin" }),
                                    " ",
                                    r("providerHub.avis.checking"),
                                  ],
                                })
                              : e.jsxs(e.Fragment, {
                                  children: [
                                    r("providerHub.avis.connectContinue"),
                                    " ",
                                    e.jsx(R, { size: 17 }),
                                  ],
                                }),
                          }),
                        ],
                      }),
                    ],
                  }),
                s === "connect" &&
                  o === "veo3" &&
                  e.jsxs("section", {
                    className: "provider-wizard-veo-step",
                    children: [
                      e.jsxs("div", {
                        className: "provider-wizard-context",
                        children: [
                          e.jsx("span", {
                            className: "provider-wizard-context-icon veo",
                            children: e.jsx($, { size: 22 }),
                          }),
                          e.jsxs("div", {
                            children: [
                              e.jsx("strong", {
                                children: r("providerHub.google.title"),
                              }),
                              e.jsx("small", {
                                children: r("providerHub.google.description"),
                              }),
                            ],
                          }),
                        ],
                      }),
                      z &&
                        e.jsx("div", {
                          className: "provider-wizard-error",
                          children: z,
                        }),
                      e.jsx("div", {
                        className: "provider-wizard-veo-embed",
                        children: e.jsx(oe, {
                          active: n,
                          auth: E,
                          onToast: v,
                          isLoggingIn: L,
                          onQuickLogin: A,
                        }),
                      }),
                    ],
                  }),
                s === "ready" &&
                  e.jsxs("section", {
                    className: "provider-wizard-ready",
                    children: [
                      e.jsxs("div", {
                        className: "provider-wizard-ready-mark",
                        children: [
                          e.jsx("span", {
                            children: e.jsx(D, { providerId: o }),
                          }),
                          e.jsx("i", {
                            children: e.jsx(B, { size: 14, strokeWidth: 3 }),
                          }),
                        ],
                      }),
                      e.jsx("span", {
                        className: "provider-wizard-eyebrow",
                        children: r("providerHub.ready.eyebrow"),
                      }),
                      e.jsx("h1", { children: r("providerHub.ready.title") }),
                      e.jsx("p", {
                        children: r(
                          o === "avis"
                            ? "providerHub.ready.avisDescription"
                            : "providerHub.ready.googleDescription",
                        ),
                      }),
                      o === "avis" &&
                        typeof N?.balance == "number" &&
                        e.jsxs("div", {
                          className: "provider-wizard-balance",
                          children: [
                            e.jsx("small", {
                              children: r("providerHub.ready.balance"),
                            }),
                            e.jsx("strong", {
                              children: N.balance.toLocaleString(ee[g], {
                                maximumFractionDigits: 2,
                              }),
                            }),
                          ],
                        }),
                      e.jsxs("div", {
                        className: "provider-wizard-ready-actions",
                        children: [
                          ce,
                          e.jsxs(W, {
                            variant: "primary",
                            size: "lg",
                            className: "provider-wizard-primary",
                            onClick: () => I(o),
                            children: [
                              r(
                                o === "veo3" && !S
                                  ? "providerHub.ready.continueSetup"
                                  : "providerHub.ready.openDashboard",
                              ),
                              " ",
                              e.jsx(R, { size: 18 }),
                            ],
                          }),
                        ],
                      }),
                    ],
                  }),
              ],
            }),
            e.jsx("footer", {
              className: "provider-wizard-trust",
              children: e.jsxs("button", {
                type: "button",
                onClick: () =>
                  window.api.openExternalUrl(w.developer.websiteUrl),
                children: [
                  e.jsx("span", { children: r("providerHub.trustedBy") }),
                  e.jsx("img", {
                    src: w.developer.logoUrl,
                    alt: w.developer.name,
                  }),
                  e.jsx("strong", { children: w.developer.name }),
                ],
              }),
            }),
          ],
        })
      : null
  );
}
export { fe as default };
