// Tallomi phone check, part 2: starts one Python engine (a given Pyodide build) and reports each phase, so the page can tell
// which phase was running if the browser kills the page.
const say = (m) => postMessage({ type: 'phase', m });
for (const k of ['compile', 'instantiate', 'instantiateStreaming']) {
  const orig = WebAssembly[k];
  if (typeof orig !== 'function') continue;
  WebAssembly[k] = function (...a) {
    say(`wasm-${k}-start`);
    const r = orig.apply(this, a);
    return r.then((v) => { say(`wasm-${k}-done`); return v; });
  };
}
self.addEventListener('message', async (ev) => {
  if (ev.data.type !== 'run') return;
  try {
    const dir = new URL(ev.data.dir, import.meta.url).href;
    say('import');
    const { loadPyodide } = await import(dir + 'pyodide.mjs');
    say('loadPyodide-start');
    const py = await loadPyodide({ indexURL: dir });
    say('python-run');
    const v = py.runPython('import sys; sys.version.split()[0]');
    const two = py.runPython('1+1');
    const mem = py._module && py._module.HEAPU8 ? (py._module.HEAPU8.length / 1048576).toFixed(0) : '?';
    postMessage({ type: 'done', m: `Python ${v}，1+1=${two}，記憶體 ${mem} MB` });
  } catch (e) { postMessage({ type: 'fail', m: (e && e.message) || String(e) }); }
});
