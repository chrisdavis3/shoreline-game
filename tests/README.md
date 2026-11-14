# Verification

Run `npm test` for the six-file Node regression suite.

For browser touch checks, install Playwright in a test environment with Google Chrome available. Start `python server.py 8093`, then run:

```sh
node tests/touch.browser.cjs http://127.0.0.1:8093/
```

`PLAYWRIGHT_PACKAGE_DIR` optionally points to the directory containing an existing test environment's `package.json` and Playwright dependency. `SHORELINE_QA_OUTPUT` optionally chooses the screenshot directory; the default is `../outputs/shoreline-touch-qa` outside the repository.

The harness sends native browser touch events through Chromium's DevTools protocol. It checks movement, camera, simultaneous movement/digging, capture/cancellation, page zoom, game zoom, controls dialog and bridge traversal through the complete game update loop. It uses explicit QA positioning to reach digging and bridge scenarios, and advances deterministic simulation frames. It is not a physical iPhone/WebKit test or an end-to-end manual playthrough.
