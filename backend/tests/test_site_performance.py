"""Verify CPU budgets, compressed static serving, warmup, and bounded list queries."""

import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from sqlalchemy import event

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import smoke_tests
from app.utils import cpu
from app.services import runtime_services
from app.models import Doctor, Patient, PatientAssessment, Report, db
from app.services.patient_service import get_assessments_for_patient, get_reports_for_patient


class CpuBudgetTests(unittest.TestCase):
    def test_cpu_affinity_and_container_quota_limit_the_auto_budget(self):
        with patch.object(cpu.os, 'process_cpu_count', return_value=16, create=True):
            with patch.object(cpu.os, 'sched_getaffinity', return_value=set(range(8)), create=True):
                with patch.object(cpu.Path, 'read_text', return_value='200000 100000'):
                    self.assertEqual(cpu.inference_thread_count(), 2)

    def test_auto_budget_is_six_on_a_large_host_and_one_on_a_single_core(self):
        for cores, expected in ((16, 6), (1, 1)):
            with patch.object(cpu.os, 'process_cpu_count', return_value=cores, create=True):
                with patch.object(cpu.os, 'sched_getaffinity', return_value=set(range(cores)), create=True):
                    with patch.object(cpu.Path, 'read_text', side_effect=OSError):
                        self.assertEqual(cpu.inference_thread_count(), expected)
                        self.assertEqual(cpu.inference_thread_count(cuda=True), min(2, cores))
        self.assertEqual(cpu.inference_thread_count(3), 3)


class StaticServingTests(unittest.TestCase):
    def setUp(self):
        self.app = smoke_tests.backend_app_module.app
        self.client = self.app.test_client()
        self.folder = tempfile.TemporaryDirectory(dir=smoke_tests.RUNTIME_ROOT)
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        (self.root / 'assets').mkdir()
        self.content = b'export const data = "' + b'hello-world-' * 500 + b'";'
        self.compressed = gzip.compress(self.content)
        (self.root / 'assets/app-1234abcd.js').write_bytes(self.content)
        (self.root / 'assets/app-1234abcd.js.gz').write_bytes(self.compressed)
        (self.root / 'index.html').write_text('<html>MeiboPix</html>', encoding='utf-8')
        self.config = patch.dict(self.app.config, {'FRONTEND_DIST_DIR': str(self.root)})
        self.config.start()
        self.addCleanup(self.config.stop)

    def test_hashed_assets_use_precompressed_content_and_immutable_caching(self):
        response = self.client.get('/assets/app-1234abcd.js', headers={'Accept-Encoding': 'gzip'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Content-Encoding'], 'gzip')
        self.assertIn('javascript', response.mimetype)
        self.assertIn('Accept-Encoding', response.headers['Vary'])
        self.assertIn('immutable', response.headers['Cache-Control'])
        self.assertEqual(gzip.decompress(response.data), self.content)
        response.close()

    def test_declined_compression_and_range_requests_return_the_original_bytes(self):
        response = self.client.get('/assets/app-1234abcd.js', headers={'Accept-Encoding': 'gzip;q=0, *;q=1'})
        self.assertNotIn('Content-Encoding', response.headers)
        self.assertEqual(response.data, self.content)
        response.close()
        response = self.client.get('/assets/app-1234abcd.js', headers={'Accept-Encoding': 'gzip', 'Range': 'bytes=0-5'})
        self.assertEqual(response.status_code, 206)
        self.assertNotIn('Content-Encoding', response.headers)
        self.assertEqual(response.data, self.content[:6])
        response.close()

    def test_conditional_and_head_requests_work_and_spa_html_revalidates(self):
        initial = self.client.get('/assets/app-1234abcd.js', headers={'Accept-Encoding': 'gzip'})
        etag = initial.headers['ETag']
        initial.close()
        cached = self.client.get('/assets/app-1234abcd.js', headers={'Accept-Encoding': 'gzip', 'If-None-Match': etag})
        self.assertEqual(cached.status_code, 304)
        cached.close()
        head = self.client.head('/assets/app-1234abcd.js', headers={'Accept-Encoding': 'gzip'})
        self.assertEqual(int(head.headers['Content-Length']), len(self.compressed))
        self.assertEqual(head.data, b'')
        head.close()
        html = self.client.get('/home')
        self.assertEqual(html.status_code, 200)
        self.assertEqual(html.headers['Cache-Control'], 'no-cache')
        html.close()
        self.assertEqual(self.client.get('/assets/missing.js').status_code, 404)


class ModelWarmupTests(unittest.TestCase):
    def test_repeated_warmup_requests_share_one_background_thread(self):
        thread = Mock()
        thread.is_alive.return_value = True
        with smoke_tests.backend_app_module.app.app_context():
            with patch.object(runtime_services.runtime, 'MEIBOGRAPHY_SERVICE_HELPERS', None):
                with patch.object(runtime_services, '_warmup_thread', None):
                    with patch.object(runtime_services.threading, 'Thread', return_value=thread) as start:
                        self.assertTrue(runtime_services.start_meibography_warmup())
                        self.assertTrue(runtime_services.start_meibography_warmup())
        start.assert_called_once()
        thread.start.assert_called_once()

    def test_guest_warmup_returns_promptly_without_initializing_in_the_request(self):
        with patch('app.modules.meibography.service.get_model_status', return_value={'available': True}):
            with patch('app.modules.meibography.service.start_meibography_warmup', return_value=True) as warm:
                response = smoke_tests.backend_app_module.app.test_client().post('/api/guest/meibography/warmup', json={})
        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.get_json()['loading'])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        warm.assert_called_once()

    def test_missing_models_do_not_start_background_loading(self):
        with patch('app.modules.meibography.service.get_model_status', return_value={'available': False, 'error': 'Unavailable'}):
            with patch('app.modules.meibography.service.start_meibography_warmup') as warm:
                response = smoke_tests.backend_app_module.app.test_client().post('/api/guest/meibography/warmup', json={})
        self.assertEqual(response.status_code, 503)
        warm.assert_not_called()


class ListQueryTests(unittest.TestCase):
    def test_lists_batch_relationships_and_report_cards_skip_session_image_data(self):
        with smoke_tests.backend_app_module.app.app_context():
            doctor = Doctor.query.filter_by(username='smoke-admin').first()
            for index in range(12):
                patient = Patient(full_name=f'Performance Patient {index}', age=30, mobile='9999999999', gender='Other', doctor_id=doctor.id)
                db.session.add(patient)
                db.session.flush()
                report = Report(patient_id=patient.id, file_path=f'perf-report-{index}.pdf')
                db.session.add(report)
                db.session.flush()
                db.session.add(PatientAssessment(
                    patient_id=patient.id, report_id=report.id, completed_tests='["DEQ"]',
                    session_data=json.dumps({'large_image': 'data:image/png;base64,' + 'x' * 20000}),
                ))
            db.session.commit()
            statements = []

            def record(connection, cursor, statement, parameters, context, executemany):
                if statement.lstrip().upper().startswith('SELECT'):
                    statements.append(statement)

            db.session.expire_all()
            event.listen(db.engine, 'before_cursor_execute', record)
            try:
                assessments = get_assessments_for_patient(doctor)
                self.assertGreaterEqual(len(assessments), 12)
                self.assertLessEqual(len(statements), 6)
                self.assertTrue(all(item['patient']['doctor_id'] == doctor.id for item in assessments))
                self.assertTrue(all(item['report_download_url'] for item in assessments if item['report_id']))
                statements.clear()
                reports = get_reports_for_patient(doctor)
                self.assertGreaterEqual(len(reports), 12)
                selects = [statement for statement in statements if 'FROM patient_assessment' in statement]
                self.assertTrue(selects)
                self.assertTrue(all('patient_assessment.session_data' not in statement for statement in selects))
            finally:
                event.remove(db.engine, 'before_cursor_execute', record)


if __name__ == '__main__':
    unittest.main()
