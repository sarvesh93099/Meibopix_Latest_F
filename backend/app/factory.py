"""Compatibility wrapper that exposes the root backend app factory from backend/app.py."""

import importlib.util
import sys
from pathlib import Path


_ROOT_APP_MODULE_NAME = '_backend_root_app'


def _load_root_app_module():
    cached_module = sys.modules.get(_ROOT_APP_MODULE_NAME)
    if cached_module is not None:
        return cached_module

    module_path = Path(__file__).resolve().parents[1] / 'app.py'
    spec = importlib.util.spec_from_file_location(_ROOT_APP_MODULE_NAME, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Unable to load backend app module from {module_path}')

    module = importlib.util.module_from_spec(spec)
    sys.modules[_ROOT_APP_MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


_root_app_module = _load_root_app_module()
app = _root_app_module.app
create_app = _root_app_module.create_app


__all__ = ['app', 'create_app']
