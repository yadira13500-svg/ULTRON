# ULTRON iPhone workflow acceptance checklist

This is a test plan, not a claim that a physical iPhone run has already passed. The current build environment can inspect and test the deployed code and APIs, but cannot drive Safari on the owner's physical iPhone or emulate its microphone/camera permission sheets.

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
10. Add ULTRON to the Home Screen, launch standalone, and check notch/Dynamic Island and home-indicator safe areas.
11. Test with VoiceOver, larger text, reduced motion and a slow network; confirm labels, focus order and clear error states.

## Pass evidence to record
- iPhone model and iOS version; Safari version; viewport orientation.
- Each step's pass/fail result and a screenshot where useful.
- Console/network errors and mission IDs for failed workflows.
- Permission state for microphone and camera.
- No sensitive account information or credentials in screenshots.

Do not mark mobile acceptance complete until these tests are run on a real iPhone or a trustworthy iOS simulator.