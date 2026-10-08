# Backend Architecture

The backend groups implementation under `app/`, while keeping server entry points and deployment assets stable.

```text
backend/
  app.py                       # Flask bootstrap and development runner
  serve.py                     # Production Waitress server
  wsgi.py                      # WSGI application export
  app/
    factory.py                 # Shared bootstrap exports for factory imports
    config.py                  # Environment configuration and path resolution
    extensions.py              # Shared database extension
    core/                      # Constants and process runtime state
    middleware/                # Request hooks and errors
    models/                    # Authentication and patient entities
    routes/                    # HTTP handlers and blueprint registration
    services/
      clinical_tools.py        # Questionnaire and clinical scoring helpers
      clinical_service.py      # Clinical API workflows
      runtime_services.py      # Lazy model, blink and camera initialization
      ...                      # Auth, patient, storage, record and camera services
    modules/
      blink/                   # Tracking, detection and blink API
      meibography/
        model_service.py       # Optional segmentation inference and checkpoints
        tear_meniscus.py       # Tear measurement implementation
        service.py             # Image processing workflows
        routes.py              # Clinician image API
        guest.py               # Isolated guest image API
        utils.py               # Feature image helpers
    utils/                     # Environment, image, logging and request helpers
  meibography_models/          # Local checkpoints plus tracked SHA-256 manifest
  mp_models/                   # Blink face landmark model
  tests/                       # Regression checks
  smoke_tests.py               # Isolated API checks; ML inference is optional
  requirements.txt             # Complete backend dependencies
  Dockerfile
  README.md
```

## Startup and request flow

`app.py` builds Flask, initializes configuration, storage and the database, then registers middleware and blueprints. `serve.py`, `wsgi.py`, and `app.factory` load that shared bootstrap. Routes delegate to services or feature modules. Models, utilities and runtime state are shared through the package.

Import implementations from their `app` package paths. The unused top-level configuration, model, storage, camera, environment and blink compatibility wrappers have been removed. Segmentation remains lazily imported, so the core installation does not require PyTorch. Moving its implementation into the meibography feature does not load it at startup.

## Files and deployment

All four segmentation checkpoints belong in this backend's `meibography_models/` directory. Explicit `MODEL_PATH` or `MEIBOGRAPHY_MODEL_FOLDER` settings can still point to another directory; relative paths resolve from the project root. There is no dependency on a model folder elsewhere in the workspace.

The database, uploads and reports are runtime application data and must be preserved. The frontend build in `../frontend/dist/` is served by Flask or nginx. Tests and browser checks generate disposable `.smoke_runtime/`, `__pycache__/`, and `../artifacts/` outputs. These are excluded from source control and Docker builds.

EC2/systemd, Docker, and CI continue to use the existing server entry points. See `../deploy/README.md` for deployment assets.

Large image work uses a shared admission slot in `app/utils/resource_limits.py`. It bounds concurrent image allocations before decoding and returns a retryable response when busy; ordinary API requests do not use that slot. Checkpoints are deployed independently of Git, verified by `../deploy/scripts/manage_models.py`, and read locally during inference.
