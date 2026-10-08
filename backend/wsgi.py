# Expose the Flask app for WSGI servers that import `application`.
import importlib.util
import sys
from pathlib import Path


def _load_backend_app_module():
    module_name = '_backend_root_app'
    cached_module = sys.modules.get(module_name)
    if cached_module is not None:
        return cached_module

    module_path = Path(__file__).resolve().with_name('app.py')
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Unable to load backend app module from {module_path}')

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


app = _load_backend_app_module().app


application = app
