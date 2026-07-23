import assert from 'node:assert/strict';
import test from 'node:test';
import { isAuthenticatedOverleafPage } from '../src/overleafBrowser.js';
test('Google OAuth pages are never treated as completed Overleaf login', () => {
    assert.equal(isAuthenticatedOverleafPage('https://accounts.google.com/v3/signin/identifier', false), false);
});
test('Overleaf login and auth callback pages are not authenticated destinations', () => {
    assert.equal(isAuthenticatedOverleafPage('https://www.overleaf.com/login', false), false);
    assert.equal(isAuthenticatedOverleafPage('https://www.overleaf.com/users/auth/google_oauth2/callback', false), false);
});
test('an Overleaf project page without a login link is authenticated', () => {
    assert.equal(isAuthenticatedOverleafPage('https://www.overleaf.com/project/0123456789abcdef01234567', false), true);
    assert.equal(isAuthenticatedOverleafPage('https://www.overleaf.com/project/0123456789abcdef01234567', true), false);
});
//# sourceMappingURL=loginState.test.js.map