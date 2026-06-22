/**
 * Test setup for @bb/worker vitest pool workers tests.
 *
 * Harness caveats encoded here:
 *  1. Per-file storage isolation: each test file uses a unique lobby code so
 *     DO state from one test does not bleed into another.
 *  2. WebSocket-in-DO tests (*.integration.test.ts) need --max-workers=1
 *     --no-isolate, which is encoded in the test:integration script.
 */

// No global beforeAll warmup needed — the pool workers harness starts
// wrangler dev lazily. Individual tests obtain their own DO stubs.
