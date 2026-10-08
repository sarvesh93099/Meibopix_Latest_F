# Backend

`app.py` bootstraps Flask, configuration, storage, database models, middleware and blueprints. `serve.py` runs the production Waitress server. The `app/` package separates routes, services, models, middleware, utilities, and the blink/meibography feature modules. Import implementation modules directly from `app/`; unused top-level compatibility wrappers have been removed.

Questionnaire scoring lives in `app/services/clinical_tools.py`. Segmentation and tear measurement live in `app/modules/meibography/model_service.py` and `tear_meniscus.py`. Model checkpoints belong in `meibography_models/` inside this backend so local runs and deployment use the same files.

Install `requirements.txt` for the complete backend, including patient workflows, reports, questionnaires, image tools, blink processing, and segmentation. The trained model weights remain separate and must be supplied to enable segmentation.

Model status requests inspect checkpoint/dependency availability without loading segmentation networks. OpenCV/PyTorch thread limits, image upload/pixel limits, and request connection pools can be configured in the project `.env`. Enhancement preserves image dimensions and caps the contrast-processing plane to reduce CPU and temporary allocations. Local upload/report responses stream from disk.

Run `python backend/smoke_tests.py --skip-ml` and `python -m unittest discover -s backend/tests -v` from the project root. The tests isolate their database and storage in temporary runtime folders. Run smoke tests without `--skip-ml` on a machine with trained weights to verify inference too.

Canonical API routes:

- `POST /api/upload`: upload an image or save a captured snapshot.
- `POST /api/predict`: perform real segmentation when models are installed.
- `GET /api/model/status`: lightweight readiness information.
- `GET/POST /api/results`: reports and assessments.
- `POST /api/enhance`: bounded image contrast and sharpening.
- `POST /api/tear-meniscus/measure`: manual image measurement.
- `POST /api/blink-counter/analyze`: server blink video processing.

Legacy aliases remain supported. See the project [README](../README.md) for setup, folder structure, guest demonstration, and deployment links.
