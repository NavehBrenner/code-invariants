# React plugin catalog

Honest catalog for **`@qualety/react`** (`Plugin.name: "react"`).  
This is the implementation list for this plugin plus a **backlog inventory** (not implement-now). Installing the plugin does **not** enable its rules. `configs.recommended` sets both implemented rules to `"error"` for users who opt into that preset.

TanStack Query detectors live **in this plugin** (not a separate `@qualety/react-tanstack` package). No runtime UI kit / DataRegion ships here.

Behavior tables are locked in [SPECS.md](../SPECS.md) §3.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `react/no-fetch-in-useeffect` | Do not kick off HTTP data loading inside `useEffect` / `useLayoutEffect`. `defineRule` / `requires: ["typescript"]` | `error` |
| `react/query-error-handled` | TanStack `useQuery` / `useInfiniteQuery` must handle errors (structural R1-lite). `defineRule` / `requires: ["typescript"]` | `error` |

### `react/no-fetch-in-useeffect`

See SPECS §3. Summary:

- **Effect callees:** `useEffect`, `useLayoutEffect` bound to `react` (named, default `React`, `import * as React`). Local / unresolved same-name functions are not flagged.
- **Callback:** inline function / arrow only. Identifier callbacks are a known miss.
- **Scan:** callback body, blocks, IIFEs. Do **not** scan nested function declarations / non-IIFE arrows.
- **Forbidden:** global or imported `fetch(...)`; default/named/namespace callees from `axios` / `ky` / `got` (exact or `axios/…`); `.get/.post/.put/.patch/.delete` on those bindings.
- **Not forbidden:** DOM, subscriptions, analytics, `setTimeout`, non-listed HTTP libs.
- **Config:** none. Future allowlist is a SPECS note only.
- **Violation:** range on the forbidden call; message names the API; concrete suggestion (TanStack Query / SWR / route loader / RSC).

### `react/query-error-handled`

See SPECS §3 R1. Summary:

- **Import:** `@tanstack/react-query` (or `/` subpath).
- **In:** `useQuery`, `useInfiniteQuery` (aliases + namespace).
- **Skip:** `useSuspenseQuery`, `useSuspenseInfiniteQuery` (boundary / throw).
- **Compliance:** call-local binding/alias tracking in the enclosing function: `if` / ternary / `&&` on **that call’s** `isError` / `error` / `status === "error"` (destructure, rename, `q.*`, or simple local alias), **or** `throwOnError: true` / function form on the v5 first or v4 second options object. Destructure without a branch is not enough. Unrelated / other-call `isError`/`error`/`status` names are not compliance. Unresolved `throwOnError` identifier is not compliance.
- **Known miss:** checks only inside other functions / helpers / prop-drilled values / Error Boundaries.
- **Out:** pending UI, parent Error Boundary graph, SWR/Apollo, mandatory DataRegion.
- **Violation:** range on the hook call; message says the error is unhandled; concrete suggestion (local error UI or `throwOnError` + boundary).

## Backlog (not now)

Research inventory for later WPs. Do not implement these in the same change as the two rules above.

### Pure React / effects

Many overlap community [`eslint-plugin-react-you-might-not-need-an-effect`](https://github.com/nickjvandyke/eslint-plugin-react-you-might-not-need-an-effect). Document overlap; only promote to “we own” when there is a unique agent-facing gap.

- `react/no-derived-state-in-effect`
- `react/no-adjust-state-on-prop-change-effect`
- `react/no-reset-all-state-on-prop-change-effect` (prefer `key`)
- `react/no-event-handler-in-effect`
- `react/no-pass-data-to-parent-via-effect`
- `react/no-external-store-subscribe-in-effect` (prefer `useSyncExternalStore`)
- `react/no-initialize-state-in-effect`
- `react/require-effect-cleanup-for-subscriptions`
- `react/no-window-document-in-render`
- `react/no-random-or-time-key`

### Query UI (same plugin, more detectors later)

- `react/query-pending-handled` (R2-lite loading/pending branch; still no mandatory DataRegion)
- `react/query-no-data-non-null-assert`
- `react/query-key-array-or-factory` (careful overlap with TanStack eslint)
- SWR / Apollo error + loading twins
- Optional later: official DataRegion / `matchQuery` helper path as an **additional** compliance shape for R2-full

### Component API

- `react/no-boolean-prop-explosion` (prefer variant union)
- controlled XOR uncontrolled patterns

### Next / RSC — prefer future `@qualety/next` unless tiny

- serializable Server→Client props
- server-only / client-only import graph
- route segment `loading.tsx` / `error.tsx` conventions
- do **not** re-own `no-async-client-component`

### Design system

- token / class allowlists → `@qualety/tailwind` (or DS) plugin (ex-R3). **Not** this plugin.

## Do not own

Do not catalog as ours:

- eslint-plugin-react / react-hooks / jsx-a11y (rules-of-hooks, exhaustive-deps, jsx-key, a11y bulk)
- TanStack eslint mechanical rules (`@tanstack/eslint-plugin-query`)
- Next official `no-async-client-component`
- Semgrep XSS clones
