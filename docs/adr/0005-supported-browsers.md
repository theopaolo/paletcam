# ADR 0005: Supported browser boundary

- Status: accepted
- Date: 2026-07-12

## Decision

Production support targets the current and previous major iOS/iPadOS Safari and
Chrome for Android, both browser-hosted and installed PWA modes. Camera permission,
lifecycle recovery, storage persistence, offline startup, backup recovery, and
community journeys are release gates on representative real devices. Automated
Chromium and mobile WebKit tests provide regression coverage but do not replace
physical iOS Safari verification.

Desktop browsers are development/fallback surfaces, not the primary camera
contract. Basic mobile usability—named/operable controls, readable contrast,
practical touch targets, reduced motion, zoom/text tolerance, and untrapped dialog
focus—is maintained. A broad desktop keyboard/WCAG program is outside the current
release priority unless product or legal requirements change.

## Consequences

Unsupported browser defects receive best-effort handling. Any data-loss, privacy,
authentication, camera-start, service-worker, or blocking usability defect on the
supported mobile matrix blocks release according to severity.

