// Step by step test of what the Tallomi phone version needs. Each message answers with {type:'done', m} or {type:'fail', m}.
let py = null;
const say = (m) => postMessage({ type: 'done', m });
const fail = (e) => postMessage({ type: 'fail', m: (e && e.message) || String(e) });
self.addEventListener('message', async (ev) => {
  try {
    const t = ev.data.type;
    if (t === 'hello') { say(`可以建立背景執行緒；WebAssembly：${typeof WebAssembly === 'object' ? '有' : '沒有'}`); return; }
    if (t === 'compile') {
      const r = await fetch('pyodide/pyodide.asm.wasm');
      const buf = await r.arrayBuffer();
      const mod = await WebAssembly.compile(buf);
      say(`編譯成功（${WebAssembly.Module.imports(mod).length} 個匯入）`); return;
    }
    if (t === 'pyodide') {
      const { loadPyodide } = await import('./pyodide/pyodide.mjs');
      py = await loadPyodide({ indexURL: new URL('./pyodide/', import.meta.url).href });
      const mem = py._module && py._module.HEAPU8 ? ` 記憶體 ${(py._module.HEAPU8.length / 1048576).toFixed(0)} MB` : '';
      say(`Python ${py.runPython('import sys; sys.version.split()[0]')} 啟動成功，1+1=${py.runPython('1+1')}；${mem}`); return;
    }
    if (t === 'packages') {
      await py.loadPackage(['jinja2', 'markupsafe', 'click', 'pyodide-http']);
      say('套件載入成功'); return;
    }
  } catch (e) { fail(e); }
});
