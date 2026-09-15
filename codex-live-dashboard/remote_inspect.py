import jupyter_server.base.handlers as h,inspect
print(h.default_handlers)
print(inspect.getsource(h.FileFindHandler.initialize))
from jupyter_core.paths import jupyter_path
print('data_dirs',jupyter_path())
import pathlib
print('static_dir',str(pathlib.Path(h.__file__).parents[1]/'static'))
print('writable',__import__('os').access(pathlib.Path(h.__file__).parents[1]/'static',__import__('os').W_OK))
