# The door page scans QR codes itself with `BarcodeDetector`, where the browser has it

Date: 2026-11-13. Author: lane P. Status: accepted.

## Context

`2026-11-13-door-opened-by-the-attendant.md` removed the phone camera from the door: the camera app opens the site the holder's QR names. Without a scanner inside the page the attendant needs the pass as text. The integrator asked for a scanner inside the door page, time-boxed, with no new dependency.

## Decision

- `web/src/features/pass/DoorScanner.tsx`: the button "Scan the QR code with this page" is rendered only when `BarcodeDetector` exists, lists `qr_code` in `getSupportedFormats()`, and `navigator.mediaDevices.getUserMedia` exists. Elsewhere nothing is rendered and the paste box stays.
- The camera is `getUserMedia({ video: { facingMode: 'environment' }, audio: false })` in a muted inline video; the detector reads it every 200 ms. Each code goes through `decodePass`, which takes a bare pass or any URL carrying `#p=`, so the site the code names is ignored and the check runs on the attendant's page. A code that is not a pass says so and scanning goes on.
- The camera's tracks stop on a hit, on unmount (including "Stop the camera"), and when the page is hidden (`visibilitychange`), which says so. A refused camera says to paste instead.
- No new dependency.

## Alternatives considered

- **A JavaScript QR decoder (for example `jsQR`).** It works where `BarcodeDetector` does not (Safari on iOS, Firefox, Chrome on Windows), but it is a new dependency and did not fit the time box.

## Consequences

- Tested with a mocked detector and camera (`web/src/features/pass/scanner.test.tsx`). **Not tried on a physical phone.** Chrome on Android has `BarcodeDetector`; Safari on iOS and Firefox do not, so there the attendant pastes the pass.
