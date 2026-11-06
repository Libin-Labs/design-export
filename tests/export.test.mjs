import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { checkReadiness, exportSvg, exportDesign, DesignExportError } from '../dist/esm/index.js';

const rect = { kind: 'rect', id: 'box', x: 2, y: 3, width: 10, height: 20, fill: '#ff0000' };
const doc = (nodes = [rect]) => ({ width: 100, height: 80, nodes });
const text = {
  kind: 'text',
  id: 'title',
  x: 1,
  y: 12,
  text: '<script>"&\'😀',
  fontFamily: 'Arial',
  fontSize: 12,
  fill: '#000000',
};
const code = (expected) => (error) => error instanceof DesignExportError && error.code === expected;

test('real SVG has exact geometry, namespace, viewBox and deterministic output', () => {
  assert.equal(
    exportSvg(doc()),
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><rect id="box" fill="#ff0000" opacity="1" x="2" y="3" width="10" height="20"/></svg>',
  );
  const ellipse = {
    kind: 'ellipse',
    id: 'round',
    x: 20,
    y: 30,
    radiusX: 8,
    radiusY: 4,
    fill: 'none',
    opacity: 0.5,
  };
  assert.match(
    exportSvg(doc([ellipse])),
    /<ellipse id="round" fill="none" opacity="0.5" cx="20" cy="30" rx="8" ry="4"\/>/u,
  );
});

test('text and IDs are XML escaped without permitting executable markup', () => {
  const svg = exportSvg(doc([{ ...text, id: 'x" onload="evil' }]), { availableFonts: ['Arial'] });
  assert.ok(svg.includes('id="x&quot; onload=&quot;evil"'));
  assert.ok(svg.includes('&lt;script&gt;&quot;&amp;&apos;😀'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(!svg.includes('id="x" onload='));
});

test('readiness returns missing fonts and export refuses unready text', () => {
  assert.deepEqual(checkReadiness(doc([text])), { ready: false, missingFonts: ['Arial'] });
  assert.deepEqual(checkReadiness(doc([text]), { availableFonts: ['Arial'] }), {
    ready: true,
    missingFonts: [],
  });
  assert.throws(() => exportSvg(doc([text])), code('not-ready'));
});

test('invalid primitives, dimensions and XML are rejected', () => {
  for (const document of [
    null,
    { ...doc(), width: NaN },
    { ...doc(), height: 0 },
    { ...doc(), width: 16385 },
    doc([rect, rect]),
    doc([null]),
    doc([{ ...rect, width: -1 }]),
    doc([{ ...rect, x: Infinity }]),
    doc([{ ...rect, opacity: 2 }]),
    doc([{ ...rect, fill: 'url(https://evil.example)' }]),
    doc([{ ...rect, id: '' }]),
    doc([{ ...text, text: '\0' }]),
    doc([{ ...text, text: '\ud800' }]),
    doc([{ ...text, fontFamily: 'Arial; background:url(x)' }]),
  ])
    assert.throws(() => exportSvg(document), code('invalid'));
  assert.throws(
    () => exportSvg(doc([{ ...rect, kind: 'image', url: 'https://example.org/x' }])),
    code('unsupported'),
  );
});

test('node and UTF-8 output byte bounds cover empty and non-ASCII output', () => {
  assert.throws(
    () => exportSvg(doc([rect, { ...rect, id: 'other' }]), { maxNodes: 1 }),
    code('capacity'),
  );
  const svg = exportSvg(doc([text]), { availableFonts: ['Arial'] });
  const bytes = new TextEncoder().encode(svg).byteLength;
  assert.equal(exportSvg(doc([text]), { availableFonts: ['Arial'], maxOutputBytes: bytes }), svg);
  assert.throws(
    () => exportSvg(doc([text]), { availableFonts: ['Arial'], maxOutputBytes: bytes - 1 }),
    code('capacity'),
  );
  assert.throws(() => exportSvg(doc([]), { maxOutputBytes: 1 }), code('capacity'));
});

test('options reject malformed and out-of-bound settings', () => {
  for (const options of [
    null,
    [],
    { maxNodes: 0 },
    { maxNodes: null },
    { availableFonts: null },
    { maxOutputBytes: Infinity },
    { availableFonts: 'Arial' },
    { availableFonts: new Array(1) },
  ])
    assert.throws(() => checkReadiness(doc(), options), code('invalid'));
});

test('SVG asynchronous output is real SVG and does not invoke a raster adapter', async () => {
  const output = await exportDesign(doc(), 'svg', {
    rasterExporter: async () => {
      throw new Error('must not run');
    },
  });
  assert.deepEqual(output, { format: 'svg', mediaType: 'image/svg+xml', data: exportSvg(doc()) });
});

test('PNG/JPEG without adapters and PDF are explicitly unsupported', async () => {
  for (const format of ['png', 'jpeg', 'pdf'])
    await assert.rejects(exportDesign(doc(), format), code('unsupported'));
});

test('raster adapter receives a frozen snapshot and result bytes are detached', async () => {
  const source = doc([{ ...rect }]);
  const bytes = new Uint8Array([137, 80, 78, 71]);
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  let received;
  const pending = exportDesign(source, 'png', {
    rasterExporter: async (document, format) => {
      received = document;
      assert.equal(format, 'png');
      assert.throws(() => {
        document.nodes[0].x = 99;
      }, TypeError);
      await wait;
      return { mediaType: 'image/png', data: bytes };
    },
  });
  source.nodes[0].x = 70;
  assert.equal(received.nodes[0].x, 2);
  release();
  const result = await pending;
  bytes[0] = 0;
  assert.equal(result.data[0], 137);
});

test('adapter failure, incorrect media type, empty and oversized bytes fail explicitly', async () => {
  for (const rasterExporter of [
    async () => {
      throw new Error('render');
    },
    async () => ({ mediaType: 'image/jpeg', data: new Uint8Array([1]) }),
    async () => ({ mediaType: 'image/png', data: new Uint8Array() }),
    async () => null,
  ])
    await assert.rejects(exportDesign(doc(), 'png', { rasterExporter }), code('adapter'));
  await assert.rejects(
    exportDesign(doc(), 'png', {
      maxOutputBytes: 1,
      rasterExporter: async () => ({ mediaType: 'image/png', data: new Uint8Array([1, 2]) }),
    }),
    code('capacity'),
  );
});

test('Node Buffer raster output is copied without a shared view', async () => {
  const data = Buffer.from([255, 216, 255, 217]);
  const output = await exportDesign(doc(), 'jpeg', {
    rasterExporter: async () => ({ mediaType: 'image/jpeg', data }),
  });
  data[0] = 0;
  assert.equal(output.data[0], 255);
  output.data[1] = 0;
  assert.equal(data[1], 216);
});

test('mutating options during render cannot replace the captured abort signal', async () => {
  const controller = new AbortController();
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const options = {
    signal: controller.signal,
    rasterExporter: async () => {
      await wait;
      return { mediaType: 'image/png', data: new Uint8Array([1]) };
    },
  };
  const pending = exportDesign(doc(), 'png', options);
  options.signal = undefined;
  options.rasterExporter = undefined;
  controller.abort();
  release();
  await assert.rejects(pending, code('cancelled'));
});

test('cancellation during rendering suppresses output even if adapter resolves', async () => {
  const controller = new AbortController();
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const pending = exportDesign(doc(), 'jpeg', {
    signal: controller.signal,
    rasterExporter: async (_document, _format, signal) => {
      assert.equal(signal, controller.signal);
      await wait;
      return { mediaType: 'image/jpeg', data: new Uint8Array([255, 216]) };
    },
  });
  controller.abort();
  release();
  await assert.rejects(pending, code('cancelled'));
  await assert.rejects(
    exportDesign(doc(), 'svg', { signal: controller.signal }),
    code('cancelled'),
  );
  await assert.rejects(exportDesign(doc(), 'svg', { signal: {} }), code('invalid'));
});

test('standalone CJS produces the same SVG', () => {
  const cjs = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.deepEqual(Object.keys(cjs).sort(), [
    'DesignExportError',
    'checkReadiness',
    'exportDesign',
    'exportSvg',
  ]);
  assert.equal(cjs.exportSvg(doc()), exportSvg(doc()));
});
