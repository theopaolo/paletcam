# ADR 0005: Supported browser boundary

- Status: accepted
- Date: 2026-07-12

## Decision

Paletcam supports mobile phones only (scope set on 2026-08-15). Production
support targets the current and previous major iOS Safari and Chrome for
Android on phones, both browser-hosted and installed PWA modes. Camera permission,
lifecycle recovery, storage persistence, offline startup, backup recovery, and
community journeys get checked on a real phone through the pwa/preprod deploy.
Automated Chromium and mobile WebKit tests catch regressions but do not replace
a physical iOS Safari check.

Desktop browsers are development surfaces only. Tablets, iPadOS included, are
not supported. Basic mobile usability is maintained: named and operable
controls, readable contrast, practical touch targets, reduced motion, zoom and
text tolerance, and dialogs that do not trap focus. Keyboard navigation and
screen-reader flows are out of scope unless product or legal requirements
change. Cheap aria attributes stay.

## Consequences

Unsupported browser defects receive best-effort handling. Any data-loss, privacy,
authentication, camera-start, service-worker, or blocking usability defect on the
supported mobile matrix blocks promotion to pwa/prod according to severity.

