import assert from 'node:assert/strict';
import test from 'node:test';
import { cdpPort } from '../src/persistentChrome.js';
test('cdpPort accepts fixed local Chrome endpoints', () => {
    assert.equal(cdpPort('http://127.0.0.1:9222'), 9222);
    assert.equal(cdpPort('http://localhost:9333'), 9333);
});
test('cdpPort rejects non-local and invalid endpoints', () => {
    assert.throws(() => cdpPort('https://example.com:9222'));
    assert.throws(() => cdpPort('http://127.0.0.1:99999'));
});
//# sourceMappingURL=persistentChrome.test.js.map