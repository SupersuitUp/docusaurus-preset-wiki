import { test } from 'node:test';
import assert from 'node:assert/strict';

// The client module runs in a browser; here it gets the smallest browser it touches.
test('the beacon: one per page, ref on the first only, skipped under webdriver, on localhost and at SSR', async () => {
  const mod = await import('./client');
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  const beacons: { url: string; body: unknown }[] = [];
  const tick = () => new Promise((r) => setTimeout(r, 5));

  // SSR: no window, nothing happens and nothing throws.
  delete g.window;
  mod.onRouteDidUpdate({ location: { pathname: '/ssr' } });

  const nav = { webdriver: false, sendBeacon: (url: string, body: string) => { beacons.push({ url, body: JSON.parse(body) }); return true; } };
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  g.window = { location: { hostname: 'localhost' } };
  g.document = { title: 'T', referrer: 'https://news.example/x' };
  try {
    mod.onRouteDidUpdate({ location: { pathname: '/local' } });
    await tick();
    assert.equal(beacons.length, 0, 'localhost is skipped');

    (g.window as { location: { hostname: string } }).location.hostname = 't.wiki';
    nav.webdriver = true;
    mod.onRouteDidUpdate({ location: { pathname: '/bot' } });
    await tick();
    assert.equal(beacons.length, 0, 'automation is skipped');
    nav.webdriver = false;

    mod.onRouteDidUpdate({ location: { pathname: '/a' } });
    await tick();
    mod.onRouteDidUpdate({ location: { pathname: '/a' } });
    await tick();
    mod.onRouteDidUpdate({ location: { pathname: '/b' } });
    await tick();
    assert.deepEqual(beacons, [
      { url: '/_wiki/read', body: { path: '/a', title: 'T', ref: 'https://news.example/x' } },
      { url: '/_wiki/read', body: { path: '/b', title: 'T' } },
    ]);
  } finally {
    g.window = saved.window;
    g.document = saved.document;
    if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator);
  }
});
