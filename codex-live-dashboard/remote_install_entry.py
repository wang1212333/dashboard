from pathlib import Path
import jupyter_server
root=Path('/home/jovyan/work/dev/codex-live-dashboard')
public=root/'public';public.mkdir(exist_ok=True)
(public/'index.html').write_text((root/'index.html').read_text())
target=Path(jupyter_server.__file__).parent/'static'/'codex-live-dashboard'
if not target.exists():target.symlink_to(public,target_is_directory=True)
print('Dedicated static app path installed')
