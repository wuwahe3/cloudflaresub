import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildConvertedClashUrl,
  decryptPayload,
  encryptPayload,
  expandNodes,
  parseNodeLinks,
  parsePreferredEndpoints,
  renderClashSubscription,
  renderRawSubscription,
  renderSurgeSubscription,
} from '../src/core.js';
import worker from '../src/worker.js';

const vmess = 'vmess://ewogICJ2IjogIjIiLAogICJwcyI6ICJkZW1vLXdzLXRscyIsCiAgImFkZCI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAicG9ydCI6ICI0NDMiLAogICJpZCI6ICIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLAogICJzY3kiOiAiYXV0byIsCiAgIm5ldCI6ICJ3cyIsCiAgInRscyI6ICJ0bHMiLAogICJwYXRoIjogIi93cyIsCiAgImhvc3QiOiAiZWRnZS5leGFtcGxlLmNvbSIsCiAgInNuaSI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAiZnAiOiAiY2hyb21lIiwKICAiYWxwbiI6ICJoMixodHRwLzEuMSIKfQ==';

const { nodes } = parseNodeLinks(vmess);
assert.equal(nodes.length, 1);
assert.equal(nodes[0].type, 'vmess');
assert.equal(nodes[0].server, 'edge.example.com');

const { endpoints } = parsePreferredEndpoints('104.16.1.2#HK\n104.17.2.3:2053#US');
assert.equal(endpoints.length, 2);

const expanded = expandNodes(nodes, endpoints, { keepOriginalHost: true, namePrefix: 'CF' });
assert.equal(expanded.nodes.length, 2);
assert.equal(expanded.nodes[0].server, '104.16.1.2');
assert.equal(expanded.nodes[0].hostHeader, 'edge.example.com');
assert.equal(expanded.nodes[1].port, 2053);

const raw = renderRawSubscription(expanded.nodes);
assert.ok(raw.length > 10);

const clash = renderClashSubscription(expanded.nodes);
assert.match(clash, /proxies:/);
assert.match(clash, /edge\.example\.com/);

const surge = renderSurgeSubscription(expanded.nodes, 'https://sub.example.com/sub/demo?target=surge');
assert.match(surge, /\[Proxy]/);
assert.match(surge, /vmess/);

const convertedClash = buildConvertedClashUrl('https://sub.example.com/sub/demo?target=clash&token=secret');
assert.equal(
  convertedClash,
  'http://180.184.42.229:8880/sub?target=clash&url=https%3A%2F%2Fsub.example.com%2Fsub%2Fdemo%3Ftarget%3Dclash%26token%3Dsecret&config=https%3A%2F%2Fcdn.jsdelivr.net%2Fgh%2FACL4SSR%2FACL4SSR%40master%2FClash%2Fconfig%2FACL4SSR_Online.ini&emoji=true&udp=true',
);

const secret = 'this-is-a-very-secret-key';
const token = await encryptPayload({ nodes: expanded.nodes }, secret);
const payload = await decryptPayload(token, secret);
assert.equal(payload.nodes.length, 2);

const generateRequestBody = {
  nodeLinks: vmess,
  preferredIps: '104.16.1.2#HK',
  namePrefix: 'CF',
  keepOriginalHost: true,
};

const missingKvResponse = await worker.fetch(
  new Request('https://sub.example.com/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(generateRequestBody),
  }),
  {},
);
const missingKvBody = await missingKvResponse.json();
assert.equal(missingKvResponse.status, 500);
assert.equal(missingKvBody.ok, false);
assert.match(missingKvBody.error, /SUB_STORE/);

const failingKvResponse = await worker.fetch(
  new Request('https://sub.example.com/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(generateRequestBody),
  }),
  {
    SUB_STORE: {
      async get() {
        throw new Error('KV unavailable');
      },
      async put() {},
    },
  },
);
const failingKvBody = await failingKvResponse.json();
assert.equal(failingKvResponse.status, 500);
assert.equal(failingKvBody.ok, false);
assert.match(failingKvBody.error, /KV unavailable/);

const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const appJs = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
assert.match(indexHtml, /data-download-target="clashUrl"/);
assert.match(appJs, /sub\.txt/);

console.log('smoke test passed');
