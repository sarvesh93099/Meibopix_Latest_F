"""Runtime selection and a CPU ONNX backend with at most one resident model."""
import gc
import os
from pathlib import Path
import threading

from flask import current_app, has_app_context
from app.utils.env import env_flag, env_int

MODEL_INPUT = 512
MODEL_FILES = (
    'best_lower_eyelid_effb5', 'best_lower_meibo_effb5',
    'best_upper_eyelid_effb5_unet', 'best_upper_meibo_effb5_unet',
)


def configured_backend():
    name = (current_app.config.get('MEIBOGRAPHY_INFERENCE_BACKEND', 'torch')
            if has_app_context() else os.getenv('MEIBOGRAPHY_INFERENCE_BACKEND', 'torch'))
    name = str(name).strip().lower()
    if name not in ('torch', 'onnx'):
        raise ValueError('MEIBOGRAPHY_INFERENCE_BACKEND must be torch or onnx.')
    return name


def create_backend(name=None):
    name = name or configured_backend()
    if name == 'onnx':
        return OnnxBackend()
    if name == 'torch':
        from .torch_backend import TorchBackend
        return TorchBackend()
    raise ValueError('Unsupported inference backend.')


class OnnxModel:
    """A file handle, not a second in-memory network."""
    def __init__(self, backend, path):
        self.backend = backend
        self.path = str(path)

    def predict(self, array):
        return self.backend.predict(self.path, array)


class OnnxBackend:
    name = 'onnx'
    device = 'cpu'
    extension = '.onnx'

    def __init__(self):
        self.cpu_threads = max(1, env_int('ONNX_THREADS', 1))
        self._session = None
        self._path = None
        self._lock = threading.RLock()
        self._loads = 0

    def load_model(self, path):
        if not Path(path).is_file():
            raise FileNotFoundError(f'Missing exported model: {Path(path).name}')
        return OnnxModel(self, path), 'efficientnet-b5'

    def release(self):
        with self._lock:
            self._session = None
            self._path = None
            gc.collect()

    def _get_session(self, path):
        if self._session is not None and self._path == path:
            return self._session
        # Evict BEFORE creating the next session: never overlap two weight sets.
        self.release()
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = self.cpu_threads
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
        # Retaining a large arena across all network stages costs small hosts RAM.
        options.enable_cpu_mem_arena = False
        # Avoid one large preallocated activation slab on memory-constrained hosts.
        options.enable_mem_pattern = env_flag('ONNX_ENABLE_MEM_PATTERN', False)
        options.add_session_config_entry('session.intra_op.allow_spinning', '0')
        session = ort.InferenceSession(path, sess_options=options, providers=['CPUExecutionProvider'])
        input_node = session.get_inputs()[0]
        if input_node.shape != [1, 3, MODEL_INPUT, MODEL_INPUT]:
            raise ValueError('Exported model must use the original 1x3x512x512 input.')
        self._session = session
        self._path = path
        self._loads += 1
        return session

    def predict(self, path, array):
        with self._lock:
            session = self._get_session(path)
            result = session.run(None, {session.get_inputs()[0].name: array})[0]
            return result[0, 0]

    def get_status(self):
        with self._lock:
            return {
                'resident_models': int(self._session is not None),
                'resident_model': Path(self._path).name if self._path else None,
                'model_session_loads': self._loads,
            }
