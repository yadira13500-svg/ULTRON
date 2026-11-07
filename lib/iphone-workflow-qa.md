# ULTRON iPhone workflow acceptance checklist

The owner has confirmed that ULTRON has been added to the iPhone Home Screen, launches there and works. This is owner-reported acceptance for the Home Screen launch/use workflow, not a claim that every physical-device checklist item has passed. The build environment cannot independently drive the owner's iPhone or emulate its microphone/camera permission sheets.

## Existing mobile implementation inspected
- Responsive viewport includes `viewport-fit=cover`.
- Safe-area variables are applied to the sticky header, shell gutters, footer and toast.
- Touch inputs use 16px text to avoid iOS focus zoom; touch controls target at least 44px.
- Mobile breakpoints cover 760px, 520px, 420px, 380px and 320px widths.
- Landscape-height and reduced-motion handling are present.
- Chat uses dynamic viewport units and iOS momentum scrolling.
- PWA manifest and Apple touch icons are linked.

## Required physical-device tests in Safari
1. Sign in and load the private ULTRON workspace; refresh and confirm the session and task list persist.
2. At portrait widths, scroll every panel; confirm no horizontal page overflow, clipped controls, or hidden bottom actions.
3. Rotate to landscape; verify header, navigation, forms and chat remain usable.
4. Focus each mission input; confirm iOS does not zoom the page and the keyboard does not hide the submit button.
5. Draft a natural-language research plan, inspect its acceptance criteria, launch it, background Safari, return and inspect the persisted run.
6. Draft a claim-check plan with two HTTPS source URLs; confirm both sources are captured and the claim stays pending human review.
7. Cancel a queued mission and retry a failed mission; verify status and steps after refresh.
8. Test microphone dictation and voice conversation after explicit Safari permission; deny permission and confirm the rest of the app still works.
9. Test camera start, capture, stop and permission denial; verify the camera remains off unless explicitly started and is stopped when requested.
10. <b>Owner-confirmed:</b> ULTRON is added to the Home Screen, launches standalone and works. Still inspect notch/Dynamic Island and home-indicator safe areas explicitly; those layout checks are not confirmed by the owner's general report.
11. Test with VoiceOver, larger text, reduced motion and a slow network; confirm labels, focus order and clear error states.

## Pass evidence to record
- iPhone model and iOS version; Safari version; viewport orientation.
- Each step's pass/fail result and a screenshot where useful.
- Console/network errors and mission IDs for failed workflows.
- Permission state for microphone and camera.
- No sensitive account information or credentials in screenshots.

## Automated release evidence — 2026-11-07 (ULTRON v260)
- Managed Chromium loaded the deployed app shell through a short-lived anonymous preview; title, main heading, application script, Mission Control and chat panel were present.
- Responsive viewport checks at 320×568, 390×844, 844×390, 1024×768 and 1440×900 found no horizontal document overflow.
- The app's mobile CSS includes safe-area insets, 16px form controls and touch-target sizing for coarse-pointer devices. Managed Chromium did not emulate iOS Safari or a coarse-pointer device, so those specific rules still need physical confirmation.
- Backend acceptance: 39/39 self-tests passed; a real URL-verification mission completed, persisted and reopened with an independent verifier pass; a failed research mission produced a recovery proposal that preserved completed steps and was safely rejected without execution.
- Data integrity audit found zero orphan mission steps and zero orphan specialist tasks.

The Home Screen launch/use item is owner-confirmed. Automated Chromium viewport checks are not a substitute for iOS Safari. Do not mark overall mobile acceptance complete until microphone/camera permissions, keyboard behavior, VoiceOver, standalone safe areas, session persistence and the remaining mission interactions are run and recorded on a real iPhone or trustworthy iOS simulator.