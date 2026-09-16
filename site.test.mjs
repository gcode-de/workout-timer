import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('all app shell files used for offline mode exist', async () => {
    const serviceWorker = await readFile('service-worker.js', 'utf8');
    const paths = [...serviceWorker.matchAll(/'\.\/(?!$)([^']+)'/g)].map((match) => match[1]);

    assert.ok(paths.length >= 8);
    await Promise.all(paths.map((path) => access(path)));
});

test('manifest is installable and uses relative navigation paths', async () => {
    const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));

    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.ok(manifest.icons.some(({ sizes }) => sizes === '192x192'));
    assert.ok(manifest.icons.some(({ sizes }) => sizes === '512x512'));
});
