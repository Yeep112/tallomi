// Tallomi phone version: runs the program's Python (Pyodide) off the main thread. The book is a SQLite file kept in the
// browser's own storage (IndexedDB), and every request the page makes to /api/... is answered here by the real program.
import { loadPyodide } from './pyodide/pyodide.mjs';

let py, handle, ready = null, saving = Promise.resolve();
const say = (type, m) => postMessage({ type, m });

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('下載失敗：' + url);
  return new Uint8Array(await r.arrayBuffer());
}

async function boot() {
  // Only one window may own the book at a time: two copies saving into the same browser storage would overwrite each other.
  if (self.navigator && navigator.locks) {
    const got = await new Promise((resolve) => {
      navigator.locks.request('pennyworth-book', { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(false); return undefined; }
        resolve(true);
        return new Promise(() => {});                    // hold it until this window is closed
      });
    });
    if (!got) throw new Error('BUSY');
  }
  say('stage', '載入程式…');
  // Everything the program is made of is asked for right away, while Pyodide itself is still starting: the downloads and the
  // start-up do not wait for each other. A site built with a compiled copy (bundle.zip) hands over ready-made .pyc files, so the
  // phone does not have to compile the program on every start; without one, the plain wheels and app.zip are used.
  const wheelNames = ['flask', 'werkzeug', 'blinker', 'itsdangerous'].flatMap((w) => self.__wheels.filter((n) => n.startsWith(w + '-')));
  const files = (async () => {
    try { const r = await fetch('./bundle.zip'); if (r.ok) return { bundle: new Uint8Array(await r.arrayBuffer()) }; } catch { /* no bundle: the plain files */ }
    return { wheels: await Promise.all(wheelNames.map((n) => fetchBytes('./wheels/' + n))), app: await fetchBytes('./app.zip') };
  })();
  files.catch(() => {});                                // a failure is reported where the files are used; no "unhandled" noise before that
  py = await loadPyodide({ indexURL: new URL('./pyodide/', import.meta.url).href });
  py.FS.mkdirTree('/data');
  py.FS.mount(py.FS.filesystems.IDBFS, {}, '/data');
  // the packages and the reading of the book (browser storage) are independent of each other
  await Promise.all([
    py.loadPackage(['sqlite3', 'ssl', 'jinja2', 'markupsafe', 'click', 'pyodide-http']),
    new Promise((res, rej) => py.FS.syncfs(true, (e) => (e ? rej(e) : res()))),
  ]);
  say('stage', '讀取你的帳本…');
  const got = await files;
  if (got.bundle) {
    py.FS.writeFile('/tmp/bundle.zip', got.bundle);
  } else {
    py.FS.mkdirTree('/tmp/w');
    got.wheels.forEach((bytes, i) => py.FS.writeFile('/tmp/w/' + wheelNames[i], bytes));
    py.FS.writeFile('/tmp/app.zip', got.app);
  }
  py.globals.set('tz_offset_min', new Date().getTimezoneOffset());
  say('stage', '啟動中…');
  py.runPython(`
import zipfile, glob, site, sys, os, time
sp = site.getsitepackages()[0]
if os.path.exists('/tmp/bundle.zip'):               # compiled: sp/... goes next to the other packages, pw/... is the program
    z = zipfile.ZipFile('/tmp/bundle.zip')
    for info in z.infolist():
        if info.is_dir():
            continue
        top, _, rel = info.filename.partition('/')
        dest = os.path.join(sp if top == 'sp' else '/pw', rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'wb') as f:
            f.write(z.read(info))
else:
    for w in glob.glob('/tmp/w/*.whl'):
        zipfile.ZipFile(w).extractall(sp)
    zipfile.ZipFile('/tmp/app.zip').extractall('/pw')
# The browser's time zone (a fixed offset is enough for a bookkeeping day boundary)
m = int(tz_offset_min); a = abs(m)
os.environ['TZ'] = 'UTC' + ('-' if m < 0 else '') + str(a // 60) + (':%02d' % (a % 60) if a % 60 else '')
try:
    time.tzset()
except Exception:
    pass
os.environ['PENNYWORTH_PHONE'] = '1'
os.environ['PENNYWORTH_NO_OWNER_PROFILE'] = '1'
os.environ['PENNYWORTH_DATA_DIR'] = '/data'
sys.path.insert(0, '/pw')
try:                                   # let the program's own web lookups (rates) go through the browser's fetch
    import pyodide_http
    pyodide_http.patch_all()
except Exception:
    pass
# The browser reports a blocked or failed request (CORS, no network) as its own kind of error. The program only knows "could not connect":
# turn every such failure into that one, so rates and prices say "no connection, enter by hand" instead of failing.
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
from app import server
_app = server.create_app()
_client = _app.test_client()
def handle(method, path, headers, body):
    r = _client.open(path, method=method, headers=dict(headers), data=(body.to_bytes() if body is not None else None))
    return r.status_code, dict(r.headers), r.get_data()
`);
  handle = py.globals.get('handle');
}

// keep the saving of the book in order and never overlap
function save() {
  saving = saving.then(() => new Promise((res) => py.FS.syncfs(false, () => res())));
  return saving;
}

onmessage = async (ev) => {
  const d = ev.data;
  if (d.type === 'init') {
    self.__wheels = d.wheels;
    ready = boot().then(() => say('ready')).catch((e) => say('error', String((e && e.message) || e)));
    return;
  }
  const { id, method, path, headers, body } = d;
  await ready;
  if (!handle) { postMessage({ id, status: 503, headers: {}, body: new TextEncoder().encode('{"error":"尚未啟動"}') }); return; }
  try {
    const p = path.startsWith('/api/rev') ? path.replace(/([?&])wait=\d+/, '$1wait=0') : path;      // no long waiting: one request at a time
    const res = handle(method, p, Object.entries(headers || {}), body && body.length ? body : undefined).toJs({ create_proxies: false });
    const [status, hdrs, data] = res;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (method !== 'GET' && method !== 'HEAD' && status < 400 && !/^\/api\/lock\/(unlock|lock|unlock-biometric)/.test(path)) await save();
    postMessage({ id, status, headers: hdrs instanceof Map ? Object.fromEntries(hdrs) : hdrs, body: bytes }, [bytes.buffer]);
  } catch (e) {
    postMessage({ id, status: 500, headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify({ error: String(e) })) });
  }
};
