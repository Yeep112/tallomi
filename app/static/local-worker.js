// Tallomi on the owner's phone while the computer is not running (1.63.0): this program's own Python (Pyodide) runs here, on the phone's copy of the book.
// The page (app-local.js) hands over: where the runtime files are (the public phone site; the same files the phone version uses), this program's Python
// files (taken from the computer, so the version always matches the book) and, when needed, a fresh snapshot of the book to install.
// Every request the page would have sent to the computer is answered here instead. The book is a SQLite file in the browser's own storage (IndexedDB).
let py, handle, ready = null, saving = Promise.resolve();
const say = (type, m) => postMessage({ type, m });

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('下載失敗：' + url);
  return new Uint8Array(await r.arrayBuffer());
}

async function boot(d) {
  // one window at a time owns the copy: two windows saving into the same browser storage would overwrite each other
  if (self.navigator && navigator.locks) {
    const got = await new Promise((resolve) => {
      navigator.locks.request('tallomi-local-book', { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(false); return undefined; }
        resolve(true);
        return new Promise(() => {});
      });
    });
    if (!got) throw new Error('BUSY');
  }
  say('stage', '載入程式…');
  const base = d.runtime.replace(/\/?$/, '/');
  const { loadPyodide } = await import(base + 'pyodide/pyodide.mjs');
  py = await loadPyodide({ indexURL: base + 'pyodide/' });
  await py.loadPackage(['sqlite3', 'ssl', 'jinja2', 'markupsafe', 'click', 'pyodide-http']);
  py.FS.mkdirTree('/tmp/w');
  for (const w of ['flask', 'werkzeug', 'blinker', 'itsdangerous']) {
    for (const n of d.wheels.filter((x) => x.startsWith(w + '-'))) py.FS.writeFile('/tmp/w/' + n, await fetchBytes(base + 'wheels/' + n));
  }
  py.FS.writeFile('/tmp/app.zip', d.engine);
  say('stage', '讀取手機上的帳本…');
  py.FS.mkdirTree('/data');
  py.FS.mount(py.FS.filesystems.IDBFS, {}, '/data');
  await new Promise((res, rej) => py.FS.syncfs(true, (e) => (e ? rej(e) : res())));
  if (d.install) {                                    // a fresh copy of the book replaces whatever was here (only when nothing is waiting to be sent)
    py.FS.writeFile('/tmp/snap.zip', d.install);
    py.runPython(`
import zipfile, os, shutil
for n in os.listdir('/data'):
    p = os.path.join('/data', n)
    shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
zipfile.ZipFile('/tmp/snap.zip').extractall('/data')
`);
    await new Promise((res, rej) => py.FS.syncfs(false, (e) => (e ? rej(e) : res())));
  }
  if (!py.FS.analyzePath('/data/pennyworth.db').exists) throw new Error('手機上還沒有帳本的副本');
  py.globals.set('tz_offset_min', new Date().getTimezoneOffset());
  py.globals.set('want_bio', !!d.bio);
  py.globals.set('want_recurring', !!d.recurring);
  say('stage', '啟動中…');
  py.runPython(`
import zipfile, glob, site, sys, os, time
sp = site.getsitepackages()[0]
for w in glob.glob('/tmp/w/*.whl'):
    zipfile.ZipFile(w).extractall(sp)
zipfile.ZipFile('/tmp/app.zip').extractall('/pw')
m = int(tz_offset_min); a = abs(m)
os.environ['TZ'] = 'UTC' + ('-' if m < 0 else '') + str(a // 60) + (':%02d' % (a % 60) if a % 60 else '')
try:
    time.tzset()
except Exception:
    pass
os.environ['PENNYWORTH_PHONE'] = '1'
os.environ['PENNYWORTH_LOCAL_COPY'] = '1'
os.environ['PENNYWORTH_LOCAL_RECURRING'] = '1' if want_recurring else '0'
os.environ['PENNYWORTH_NO_OWNER_PROFILE'] = '1'
os.environ['PENNYWORTH_DATA_DIR'] = '/data'
sys.path.insert(0, '/pw')
try:                                   # the program's own web lookups (rates, prices) go through the phone's own network
    import pyodide_http
    pyodide_http.patch_all()
except Exception:
    pass
import urllib.request, urllib.error
def _as_url_error(fn):
    def wrapped(*a, **k):
        try:
            return fn(*a, **k)
        except (urllib.error.URLError, TimeoutError, ValueError):
            raise
        except Exception as e:
            raise urllib.error.URLError('%s: %s' % (type(e).__name__, str(e)[:120]))
    return wrapped
urllib.request.urlopen = _as_url_error(urllib.request.urlopen)
urllib.request.OpenerDirector.open = _as_url_error(urllib.request.OpenerDirector.open)
if want_bio:                           # this phone unlocks its own copy with Face ID / fingerprint (the phone checks it; see app-local.js)
    import json
    _p = '/data/applock.json'
    if os.path.exists(_p):
        _d = json.load(open(_p))
        if _d.get('hash'):
            _d['bio'] = True
            json.dump(_d, open(_p, 'w'))
from app import server
_app = server.create_app()
_client = _app.test_client()
def handle(method, path, headers, body):
    r = _client.open(path, method=method, headers=dict(headers), data=(body.to_bytes() if body is not None else None))
    return r.status_code, dict(r.headers), r.get_data()
`);
  handle = py.globals.get('handle');
}

// the saving of the book is kept in order and never overlaps
function save() {
  saving = saving.then(() => new Promise((res) => py.FS.syncfs(false, () => res())));
  return saving;
}

onmessage = async (ev) => {
  const d = ev.data;
  if (d.type === 'init') {
    ready = boot(d).then(() => say('ready')).catch((e) => say('error', String((e && e.message) || e)));
    return;
  }
  const { id, method, path, headers, body } = d;
  await ready;
  if (!handle) { postMessage({ id, status: 503, headers: {}, body: new TextEncoder().encode('{"error":"手機上的程式還沒啟動"}') }); return; }
  try {
    const p = path.startsWith('/api/rev') ? path.replace(/([?&])wait=\d+/, '$1wait=0') : path;
    const res = handle(method, p, Object.entries(headers || {}), body && body.length ? body : undefined).toJs({ create_proxies: false });
    const [status, hdrs, data] = res;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (method !== 'GET' && method !== 'HEAD' && status < 400 && !/^\/api\/lock\/(unlock|lock|unlock-biometric)/.test(path)) await save();
    postMessage({ id, status, headers: hdrs instanceof Map ? Object.fromEntries(hdrs) : hdrs, body: bytes }, [bytes.buffer]);
  } catch (e) {
    postMessage({ id, status: 500, headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify({ error: String(e) })) });
  }
};
