"""Verify or install local checkpoints from a folder or private S3 prefix.

No model downloads occur inside the web server. Files are staged, checked
against the manifest, then installed atomically before the service restarts.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = PROJECT_ROOT / 'backend' / 'meibography_models' / 'manifest.json'


def deployment_settings():
    try:
        from dotenv import dotenv_values
    except ImportError:
        return {}
    return dotenv_values(PROJECT_ROOT / '.env')


def read_manifest(path):
    entries = json.loads(Path(path).read_text(encoding='utf-8'))['files']
    if not entries:
        raise ValueError('The model manifest is empty.')
    names = set()
    for entry in entries:
        name = entry['name']
        if name in names or Path(name).name != name or '/' in name or '\\' in name or not name.endswith(('.pth', '.onnx')):
            raise ValueError('The model manifest contains an invalid filename.')
        if entry['size_bytes'] <= 0 or len(entry['sha256']) != 64:
            raise ValueError('The model manifest contains invalid verification data.')
        int(entry['sha256'], 16)
        names.add(name)
    return entries


def matches(path, entry):
    path = Path(path)
    if not path.is_file() or path.stat().st_size != entry['size_bytes']:
        return False
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest() == entry['sha256']


def verify(directory, entries):
    invalid = [entry['name'] for entry in entries if not matches(Path(directory) / entry['name'], entry)]
    if invalid:
        raise ValueError('Missing or invalid checkpoints: ' + ', '.join(invalid))


def sync_models(directory, entries, source):
    directory = Path(directory)
    pending = [entry for entry in entries if not matches(directory / entry['name'], entry)]
    if not pending:
        print('All checkpoints verified; no download needed.')
        return
    if not source:
        raise ValueError('Set MODEL_SOURCE to a local model folder or s3://bucket/prefix, or copy the checkpoints manually.')
    if '://' in source and not source.startswith('s3://'):
        raise ValueError('MODEL_SOURCE must be a local folder or an S3 prefix.')
    directory.mkdir(parents=True, exist_ok=True)
    # Verify every pending file before replacing any installed checkpoint.
    with tempfile.TemporaryDirectory(prefix='.model-install-', dir=directory) as staging:
        for entry in pending:
            target = Path(staging) / entry['name']
            if source.startswith('s3://'):
                subprocess.run(['aws', 's3', 'cp', source.rstrip('/') + '/' + entry['name'], str(target), '--only-show-errors'], check=True)
            else:
                shutil.copyfile(Path(source) / entry['name'], target)
            if not matches(target, entry):
                raise ValueError('Checkpoint verification failed: ' + entry['name'])
        for entry in pending:
            os.replace(Path(staging) / entry['name'], directory / entry['name'])
            print('Installed verified checkpoint:', entry['name'])


def main():
    settings = deployment_settings()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('verify', 'sync'))
    parser.add_argument('--directory', default=os.getenv('MEIBOGRAPHY_MODEL_FOLDER') or os.getenv('MODEL_PATH') or settings.get('MEIBOGRAPHY_MODEL_FOLDER') or settings.get('MODEL_PATH') or 'backend/meibography_models')
    parser.add_argument('--source', default=os.getenv('MODEL_SOURCE') or settings.get('MODEL_SOURCE') or '')
    parser.add_argument('--manifest', default=str(DEFAULT_MANIFEST))
    args = parser.parse_args()
    directory = Path(args.directory)
    if not directory.is_absolute():
        directory = PROJECT_ROOT / directory
    if directory.suffix in ('.pth', '.onnx'):
        directory = directory.parent
    try:
        entries = read_manifest(args.manifest)
        if args.action == 'sync':
            sync_models(directory, entries, args.source)
        else:
            verify(directory, entries)
        print(f'{len(entries)} checkpoints ready in {directory.resolve()}')
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Model setup failed: {error}\n')


if __name__ == '__main__':
    main()
