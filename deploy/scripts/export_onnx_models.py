"""Export trusted checkpoints locally and validate FP32 outputs before deployment.

Each model exports in its own process so conversion never retains four networks.
No quantization or change in model input resolution is applied.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / 'backend'))


def sha256(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def export_one(checkpoint, output, samples):
    import cv2
    import numpy as np
    import onnx
    import torch
    from app.modules.meibography.torch_backend import _load_binary_model
    from app.modules.meibography.model_service import _preprocess_image, _enhance_meibo_input
    from app.modules.meibography.inference_backends import OnnxBackend

    torch.set_num_threads(1)
    model, encoder = _load_binary_model(str(checkpoint))
    model = torch.nn.Sequential(model.cpu(), torch.nn.Sigmoid()).eval()
    dummy = torch.zeros((1, 3, 512, 512), dtype=torch.float32)
    with torch.inference_mode():
        torch.onnx.export(model, dummy, str(output), dynamo=False, opset_version=17,
                          input_names=['image'], output_names=['probability'],
                          do_constant_folding=True, external_data=False)
    onnx.checker.check_model(str(output))
    runtime = OnnxBackend()
    cases = [np.zeros((240, 320, 3), dtype=np.uint8),
             np.random.default_rng(42).integers(0, 256, (400, 280, 3), dtype=np.uint8)]
    for sample in samples:
        image = cv2.imread(str(sample))
        if image is None:
            raise ValueError(f'Cannot read validation sample: {sample}')
        cases.extend([image, _enhance_meibo_input(image)])
    errors = []
    for image in cases:
        array, _ = _preprocess_image(image)
        with torch.inference_mode():
            expected = model(torch.from_numpy(array)).numpy()[0, 0]
        actual = runtime.predict(str(output), array)
        # Export must match the source FP32 probabilities before being installed.
        np.testing.assert_allclose(actual, expected, rtol=0, atol=1e-4)
        errors.append(float(np.abs(actual - expected).max()))
    runtime.release()
    return {'encoder': encoder, 'validation_cases': len(cases),
            'max_absolute_probability_error': max(errors)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', type=Path, default=PROJECT / 'backend/meibography_models')
    parser.add_argument('--output', type=Path, default=PROJECT / 'backend/meibography_models/onnx')
    parser.add_argument('--sample', type=Path, action='append')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--checkpoint', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    samples = args.sample or list((PROJECT / 'frontend/public/samples/meibography').glob('*.png'))
    if args.worker:
        result = export_one(args.checkpoint, args.output, samples)
        args.output.with_suffix('.validation.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        return
    from app.modules.meibography.inference_backends import MODEL_FILES
    entries = json.loads((args.models / 'manifest.json').read_text(encoding='utf-8'))['files']
    expected = {entry['name']: entry for entry in entries}
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.onnx-export-', dir=args.output.parent) as staging:
        staging = Path(staging)
        manifest = {'format': 'onnx', 'precision': 'float32', 'input_shape': [1, 3, 512, 512],
                    'opset': 17, 'files': []}
        for name in MODEL_FILES:
            checkpoint = args.models / (name + '.pth')
            source_sha = sha256(checkpoint)
            if source_sha != expected[checkpoint.name]['sha256']:
                raise ValueError(f'Checkpoint does not match trusted manifest: {checkpoint.name}')
            output = staging / (name + '.onnx')
            command = [sys.executable, str(Path(__file__).resolve()), '--worker',
                       '--checkpoint', str(checkpoint.resolve()), '--output', str(output.resolve())]
            for sample in samples:
                command.extend(['--sample', str(sample.resolve())])
            print(f'Exporting and checking {checkpoint.name}', flush=True)
            subprocess.run(command, check=True)
            validation = json.loads(output.with_suffix('.validation.json').read_text(encoding='utf-8'))
            manifest['files'].append({'name': output.name, 'size_bytes': output.stat().st_size,
                                      'sha256': sha256(output), 'source_sha256': source_sha, **validation})
        # Publish only after every exported network has passed source comparison.
        for entry in manifest['files']:
            os.replace(staging / entry['name'], args.output / entry['name'])
        (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'All four FP32 models exported and validated in {args.output}', flush=True)


if __name__ == '__main__':
    main()
