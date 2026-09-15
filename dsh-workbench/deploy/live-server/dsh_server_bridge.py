"""Authenticated Jupyter bridge; all data queries run on the container."""
import json
import os
import pathlib
import subprocess
import time
import urllib.request
import urllib.error
import fcntl

ROOT = pathlib.Path(__file__).resolve().parent
BASE = 'http://127.0.0.1:4341'

def ensure_server():
    with (ROOT / 'runtime.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            with urllib.request.urlopen(BASE + '/healthz', timeout=3) as response:
                if json.load(response).get('runtime') == 'dsh-live-server':
                    return
            raise RuntimeError('Port occupied by another service')
        except urllib.error.URLError:
            pass
        env = dict(os.environ, DSH_SERVER_DATA=str(ROOT / 'data'),
                   DSH_LIVE_CONFIG_FILE=str(ROOT / 'private' / 'live-source.json'))
        with (ROOT / 'service.log').open('ab') as log:
            proc = subprocess.Popen(['node', str(ROOT / 'server.mjs')], cwd=ROOT,
                env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        (ROOT / 'service.pid').write_text(str(proc.pid))
        for _ in range(40):
            if proc.poll() is not None:
                raise RuntimeError('Server failed to start; inspect private server log')
            try:
                with urllib.request.urlopen(BASE + '/healthz', timeout=1) as response:
                    if json.load(response).get('runtime') == 'dsh-live-server':
                        return
            except urllib.error.URLError:
                time.sleep(.25)
        raise RuntimeError('Server startup timeout')

def run_query(params):
    try:
        ensure_server()
        path = '/publish' if params.get('operation') == 'publish' else '/query'
        request = urllib.request.Request(BASE + path,
            data=json.dumps(params).encode(), headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.load(response)
    except Exception:
        return {'error':'服务器实时查询暂时不可用，请检查服务器日志与授权'}
