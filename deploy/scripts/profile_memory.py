"""Measure peak process RSS for real API requests in an isolated child process.

Use --backend both for the development comparison, or --backend onnx on the VM.
The report covers the backend process, not the OS, Nginx, or filesystem cache.
"""
import argparse
import gc
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / 'backend'))


def worker(args):
    import cv2
    import psutil
    from app.factory import app
    from app.extensions import db
    from app.utils.image_utils import encode_image_to_data_url
    process = psutil.Process()
    stages = [{'stage': 'startup', 'rss_mib': process.memory_info().rss / 1048576}]
    results = []
    client = app.test_client()
    status = client.get('/api/guest/meibography/status')
    assert status.status_code == 200 and status.get_json()['available'], status.get_json()
    assert client.post('/api/auth/login', json={
        'username': 'memory-benchmark', 'password': 'benchmark-password-not-for-production',
    }).status_code == 200
    for repetition in range(args.repeats):
        for sample in args.sample:
            image = cv2.imread(str(sample))
            if image is None:
                raise ValueError(f'Cannot decode {sample}')
            if image.shape[0] * image.shape[1] > 1500000:
                raise ValueError('Benchmark samples must respect the 1.5 megapixel profile limit.')
            lid = 'upper' if 'upper' in sample.name else 'lower'
            payload = {'image_data': encode_image_to_data_url(image), 'lid': lid,
                       'source_lid': lid, 'include_gland_progression': False, 'compact_response': True}
            started = time.perf_counter()
            response = client.post('/api/model/analyze', json=payload)
            data = response.get_json()
            assert response.status_code == 200, data
            output = data['result']
            results.append({'sample': sample.name, 'repeat': repetition + 1,
                            'seconds': round(time.perf_counter() - started, 3),
                            'metrics': {key: output[key] for key in (
                                'coverage_pct', 'dropout_pct', 'grade', 'gland_count',
                                'probability_mean', 'probability_max', 'detected_lid')}})
            stages.append({'stage': f'{sample.name}-{repetition + 1}',
                           'rss_mib': process.memory_info().rss / 1048576})
            response.close()
            del image, payload, response, data, output
            gc.collect()
    stages.append({'stage': 'after_requests', 'rss_mib': process.memory_info().rss / 1048576})
    report = {'backend': args.backend, 'platform': platform.platform(),
              'stages': stages, 'requests': results,
              'torch_imported': 'torch' in sys.modules,
              'mediapipe_imported': 'mediapipe' in sys.modules}
    # Windows venv launchers spawn a second Python process. Read the worker's
    # own high-water mark so monitoring only the tiny launcher cannot underreport.
    info = process.memory_info()
    if hasattr(info, 'peak_wset'):
        report['worker_peak_rss_mib'] = info.peak_wset / 1048576
    else:
        import resource
        peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        report['worker_peak_rss_mib'] = peak_rss / (1048576 if sys.platform == 'darwin' else 1024)
    args.report.write_text(json.dumps(report, indent=2), encoding='utf-8')
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def measure(args, backend):
    import psutil
    with tempfile.TemporaryDirectory(prefix='meibopix-memory-') as folder:
        folder = Path(folder)
        env = os.environ.copy()
        env.update({'MEIBOGRAPHY_INFERENCE_BACKEND': backend,
                    'MODEL_PATH': str(PROJECT / 'backend/meibography_models' / ('onnx' if backend == 'onnx' else '')),
                    'APP_ENV': 'development', 'ENFORCE_HTTPS': 'false', 'SESSION_COOKIE_SECURE': 'false',
                    'DEBUG': 'false', 'ENABLE_CAMERA': 'false', 'ENABLE_SERVER_BLINK': 'false',
                    'SECRET_KEY': 'isolated-memory-benchmark-secret',
                    'DATABASE_URL': 'sqlite:///' + str(folder / 'test.db'),
                    'UPLOAD_FOLDER': str(folder / 'uploads'), 'REPORT_FOLDER': str(folder / 'reports'),
                    'STORAGE_BACKEND': 'local', 'AUTH_ADMIN_USERNAME': '', 'AUTH_ADMIN_PASSWORD': '',
                    'ADMIN_USERNAME': '', 'ADMIN_PASSWORD': '', 'AUTH_ENABLE_2FA': 'false',
                    'AUTH_BOOTSTRAP_USERNAME': 'memory-benchmark',
                    'AUTH_BOOTSTRAP_PASSWORD': 'benchmark-password-not-for-production',
                    'OPENCV_THREADS': '1', 'TORCH_THREADS': '1', 'ONNX_THREADS': '1',
                    'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1',
                    'MAX_IMAGE_PIXELS': '1500000', 'MAX_GLAND_PROGRESS_FRAMES': '0',
                    'MAX_CONTENT_LENGTH_MB': '12', 'MAX_IMAGE_UPLOAD_MB': '5', 'MALLOC_ARENA_MAX': '2'})
        # Explicitly override the model alias too, so a deployment env cannot win.
        env['MEIBOGRAPHY_MODEL_FOLDER'] = env['MODEL_PATH']
        report_path = folder / 'worker.json'
        command = [sys.executable, str(Path(__file__).resolve()), '--worker', '--backend', backend,
                   '--repeats', str(args.repeats), '--report', str(report_path)]
        for sample in args.sample:
            command.extend(['--sample', str(sample.resolve())])
        log_path = args.report.with_name(args.report.stem + '-' + backend + '.log')
        peak = 0
        started = time.perf_counter()
        with log_path.open('w', encoding='utf-8') as log:
            child = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT)
            monitored = psutil.Process(child.pid)
            while child.poll() is None:
                try:
                    processes = [monitored, *monitored.children(recursive=True)]
                    peak = max(peak, sum(process.memory_info().rss for process in processes))
                except psutil.NoSuchProcess:
                    break
                time.sleep(0.01)
            code = child.wait()
        if code != 0:
            raise RuntimeError(f'{backend} benchmark failed; see {log_path}')
        report = json.loads(report_path.read_text(encoding='utf-8'))
        report.update({'peak_process_rss_mib': round(max(peak / 1048576, report['worker_peak_rss_mib']), 1),
                       'elapsed_seconds': round(time.perf_counter() - started, 2),
                       'sampling_interval_ms': 10})
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', choices=('onnx', 'torch', 'both'), default='onnx')
    parser.add_argument('--repeats', type=int, default=2)
    parser.add_argument('--sample', type=Path, action='append')
    parser.add_argument('--report', type=Path, default=PROJECT / 'artifacts/low-memory-profile.json')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    args.sample = args.sample or list((PROJECT / 'frontend/public/samples/meibography').glob('*.png'))
    if not args.sample or args.repeats < 1:
        parser.error('Supply sample images and at least one repetition.')
    if args.worker:
        worker(args)
        return
    args.report.parent.mkdir(parents=True, exist_ok=True)
    backends = ('torch', 'onnx') if args.backend == 'both' else (args.backend,)
    reports = []
    for backend in backends:
        print(f'Measuring {backend} backend...', flush=True)
        report = measure(args, backend)
        reports.append(report)
        args.report.write_text(json.dumps(reports, indent=2) + '\n', encoding='utf-8')
        print(f"{backend}: peak RSS {report['peak_process_rss_mib']} MiB", flush=True)
    if len(reports) == 2:
        for original, converted in zip(reports[0]['requests'], reports[1]['requests']):
            assert original['metrics'] == converted['metrics'], (
                'Reported metrics differ between runtimes', original, converted)
        print('Reported metrics match on every validation request.', flush=True)


if __name__ == '__main__':
    main()
