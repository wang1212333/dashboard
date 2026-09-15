"""Run on the existing Jupyter container after unpacking the deployment package."""
from pathlib import Path
import hashlib
import json
import os
import tomllib
import jupyter_server

root = Path(__file__).resolve().parent
if root != Path('/home/jovyan/work/dev/dsh-live-server'):
    raise RuntimeError('Unexpected installation directory')
saved = root/'private/live-source.json'
if saved.exists():
    connection = json.loads(saved.read_text())
else:
    source = Path.home() / '.config/codex-live-dashboard/config.toml'
    config = tomllib.loads(source.read_text())['mcp_servers']['data-gateway']
    auth = next(v for k, v in config['http_headers'].items() if k.lower() == 'authorization')
    if not auth.startswith('Bearer '):
        raise RuntimeError('Unsupported existing credential format')
    connection = {'url':config['url'], 'token':auth[7:]}
scope = hashlib.sha256(json.dumps(connection, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
for binding in (root/'data/live').glob('binding-*.json'):
    if json.loads(binding.read_text())['scope'] != scope:
        raise RuntimeError('Existing server authorization differs from exported release; reauthorize explicitly')
private = root/'private'
private.mkdir(mode=0o700, exist_ok=True)
os.chmod(private, 0o700)
target = private/'live-source.json'
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as stream:
    json.dump(connection, stream)
os.chmod(target, 0o600)
static = Path(jupyter_server.__file__).parent/'static/dsh-live-server'
if static.is_symlink() and static.resolve() == root/'public':
    pass
elif static.exists() or static.is_symlink():
    raise RuntimeError('Static entry exists; refusing to overwrite')
else:
    static.symlink_to(root/'public', target_is_directory=True)
from dsh_server_bridge import ensure_server
ensure_server()
print('DSH_SERVER_INSTALL_OK: server-side credential verified; service running; authenticated entry installed')
