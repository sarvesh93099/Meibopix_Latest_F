"""Checkpoint deployment must retain exact bytes and avoid partial updates."""

import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/scripts/manage_models.py'
spec = importlib.util.spec_from_file_location('deployment_models', SCRIPT)
models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(models)


class ModelDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.target = self.root / 'target'
        self.entries = []
        for name, content in [('lower.pth', b'exact-lower-weights'), ('upper.pth', b'exact-upper-weights')]:
            (self.source / name).write_bytes(content)
            self.entries.append({'name': name, 'size_bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})

    def test_local_sync_preserves_bytes_and_skips_verified_files(self):
        models.sync_models(self.target, self.entries, str(self.source))
        models.verify(self.target, self.entries)
        with patch.object(models.shutil, 'copyfile', side_effect=AssertionError('Unnecessary download')):
            models.sync_models(self.target, self.entries, '')

    def test_failed_verification_does_not_replace_any_checkpoint(self):
        self.target.mkdir()
        (self.target / 'lower.pth').write_bytes(b'previous-lower')
        (self.source / 'upper.pth').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'verification failed'):
            models.sync_models(self.target, self.entries, str(self.source))
        self.assertEqual((self.target / 'lower.pth').read_bytes(), b'previous-lower')
        self.assertFalse((self.target / 'upper.pth').exists())
        self.assertFalse(list(self.target.glob('.model-install-*')))

    def test_lfs_pointer_cannot_pass_as_a_checkpoint(self):
        self.target.mkdir()
        (self.target / 'lower.pth').write_text('version https://git-lfs.github.com/spec/v1\n')
        with self.assertRaisesRegex(ValueError, 'Missing or invalid'):
            models.verify(self.target, self.entries)

    def test_missing_source_fails_with_instructions(self):
        with self.assertRaisesRegex(ValueError, 'MODEL_SOURCE'):
            models.sync_models(self.target, self.entries, '')
