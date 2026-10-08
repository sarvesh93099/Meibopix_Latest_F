# MeiboPix

A responsive eye assessment workspace with a guided home screen, patient records, questionnaires, image tools, blink counting, and reports.

## Explore the guest workspace

Choose **Explore as a guest** on the sign-in screen to use all eight tests and view or download your results without creating an account. Fictional patients and sample reports provide a starting point; results you create are kept separately from those samples. Guest profiles, test results, and reports use this tab's session storage and never grant access to staff patient records. Resetting the workspace, leaving guest mode, or closing the tab clears the guest session data.

Manual measurements, questionnaires, clinical notes, blink counting, and PDF reports work locally in guest mode. Image processing sends only the selected image and its measurement settings to the same-origin guest image endpoints; it requires a running backend. Meibography segmentation requires the trained model checkpoints. Missing services or models produce a clear unavailable result rather than invented predictions. Staff accounts and persistent clinical records require the backend. Camera features require browser permission and HTTPS or localhost.

## Folder structure

```text
meibopix-latest-main/
  frontend/
    src/
      pages/               # Home, sign-in, patients, tools, assessments
      components/          # Shared controls, layout, assessment panels
      features/            # Feature-specific code and guest demonstration
      styles/              # Shared tokens plus route-specific sign-in, workspace and exam styles
      utils/               # API, session, and cache helpers
      assets/              # Icons and reference images
    scripts/               # Frontend source validation
    tests/                 # Blink tracking and guest isolation regression checks
    vite.config.js
  backend/
    app.py                 # Bootstrap and compatibility exports
    serve.py               # Production Waitress entry point
    app/
      config.py            # Typed environment configuration
      core/                # Shared constants and runtime state
      models/              # Auth and patient database entities
      routes/              # API route groups
      services/            # Business logic, questionnaire scoring, storage, camera lifecycle
      modules/
        blink/             # Blink API and session processing
        meibography/       # Segmentation models, image analysis, enhancement, tear measurement
      middleware/          # Request handling and errors
      utils/               # Image, environment, request, logging helpers
    tests/                 # Resource regression checks
    smoke_tests.py         # Isolated API and image workflow checks
    meibography_models/    # Optional segmentation weights
    mp_models/             # Blink face landmark model
    requirements.txt      # Complete backend dependencies
  deploy/                  # EC2, nginx, systemd, AWS instructions
  .env.example             # Safe local configuration template
  docker-compose.yml
```

Backend implementation lives in the focused `backend/app` packages; import it directly from there. `backend/app.py`, `serve.py`, and `wsgi.py` remain the development, Waitress, and WSGI entry points. `backend/requirements.txt` is the single dependency list for local development and deployment.

Keep all four segmentation checkpoints in `backend/meibography_models/` inside this project. The former model folders outside the project and their redundant archive have been consolidated here. Runtime databases, uploads, and reports are application data; preserve them when cleaning generated files. `frontend/dist/` is the deployable frontend build, `frontend/node_modules/` contains installed dependencies, and `artifacts/`, `backend/.smoke_runtime/`, and `__pycache__/` are regenerable validation outputs or caches excluded from source control.

## Run locally

Use Python 3.11 and a current Node.js LTS release. From this project folder:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend/requirements.txt
# Only if you do not already have a .env:
Copy-Item .env.example .env
.\.venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Replace the `SECRET_KEY` placeholder in your new `.env` with the generated value. Preserve any existing `.env`; it contains your own settings. The example uses local SQLite storage and creates runtime folders automatically. Existing clinician sign-in and registration stay available; optionally set your own `AUTH_ADMIN_USERNAME` and `AUTH_ADMIN_PASSWORD` to seed an administrator.

Start the backend in one terminal:

```powershell
.\.venv\Scripts\python backend/serve.py
```

Start the frontend in another:

```powershell
cd frontend
npm ci
npm run dev
```

Open the local URL Vite prints. For a production frontend bundle, run `npm run build` inside `frontend`; Flask also serves the resulting `frontend/dist` directory. On Linux/macOS use `.venv/bin/python` in place of the Windows executable path.

## Real meibography models

The **Check eye glands** section includes a **Try a sample image** gallery with real upper and lower eyelid images. **Load sample** opens an image in the review stage and selects its known eyelid; **Download** saves the original-resolution PNG. These two images total about 1 MB and load only in the meibography section. Attribution and the CC BY 4.0 license are documented in [frontend/public/samples/meibography/README.md](frontend/public/samples/meibography/README.md). Sample images do not supply a known gland-loss score; analyzing them uses the same backend and model requirements as an uploaded image.

The full backend dependency list supports accounts, patients, image enhancement, tear measurements, questionnaires, reports, blink video processing, and segmentation.

Provide the trained checkpoint files listed in [backend/meibography_models/README.md](backend/meibography_models/README.md) to enable real segmentation. Model status requests inspect readiness without importing PyTorch or loading weights. The first actual analysis initializes the models, so it takes longer than subsequent analyses. The trained models still need substantial RAM; use a host sized for the actual checkpoints. Missing models return a clear unavailable result.

Analysis reuses the selected eyelid prediction from lid detection and the full-image gland prediction when the padded crop covers that same image. The distinct gland views, 512-pixel model input, thresholds, and grading remain unchanged. Component filtering uses label lookups to avoid scanning the full image for every component. Requests return the source, eyelid boundary, and final gland overlays immediately; per-gland animation images are omitted by default because the review screen does not use them. API clients can request them with `include_gland_progression: true`. The result's `analysis_duration_ms` includes model initialization, analysis, and image encoding inside the analysis handler; it excludes network transfer and JSON serialization.

## Resource settings

The backend defaults to 4 Waitress request threads, 1 OpenCV thread, and 2 PyTorch CPU threads when segmentation is enabled. Image decoding is capped at 15 MB and 12 million pixels. Enhancement keeps the original image dimensions and processes contrast on a luminance plane capped at 1600 pixels on its longest side. Local downloads stream from disk and support range requests. External database connection pools default to 3 connections plus 2 overflow connections.

All limits are configurable in `.env.example`. Existing `.env` settings override defaults. These are conservative settings, not a measured guarantee of memory usage or latency. See the [Pillow image limits](https://pillow.readthedocs.io/en/stable/handbook/security.html) and [PyTorch thread settings](https://docs.pytorch.org/docs/stable/generated/torch.set_num_threads.html) for the underlying APIs.

    Docker installs the complete backend dependency list. CPU PyTorch packages are selected by default; set `TORCH_DEVICE=cuda` only for a configured GPU host. Set `HOST=0.0.0.0` for external backend connections and use the HTTPS production configuration in [deploy/README.md](deploy/README.md).

## Faster pages and independent model deployment

The sign-in, workspace and assessment styles load with their routes. Sign-in CSS is approximately 26 KB uncompressed (about 7 KB gzip), compared with the former 105 KB shared bundle. Vision, PDF libraries and clinical styles remain deferred. The redesigned studio uses system fonts and inline SVG artwork, with no additional UI dependency or animated drawing loop.

Large image processing shares one slot across guest and clinician endpoints. Busy image requests return HTTP 429 with `Retry-After: 5`, keeping concurrent decoded image arrays from accumulating. Authentication, records and health requests remain available. Prediction input size, model weights, thresholds and grading are unchanged.

Git LFS is no longer required for deployment. Keep checkpoints locally or set `MODEL_SOURCE` to a private S3 prefix; `deploy/scripts/manage_models.py` verifies every checkpoint against `backend/meibography_models/manifest.json`. Downloads happen only during deployment. Docker mounts the files read-only instead of adding roughly 504 MB to each build. See [deployment without Git LFS](deploy/MODELS.md) for copying, syncing, Docker and migrating an existing repository.

## Validate changes

```powershell
.\.venv\Scripts\python backend/smoke_tests.py --skip-ml
.\.venv\Scripts\python -m unittest discover -s backend/tests -v
cd frontend
npm test
npm run check
npm run build
```

Backend tests use temporary databases and storage folders. Optional model inference is skipped when checkpoints are absent. Seeded sample reports are clearly labeled; guest-created results come from the selected test inputs. Clinical interpretation belongs to a qualified clinician.
