# Frontend structure

```text
src/
  pages/                 # Lazy route screens: home, sign-in, records, tools, assessment
  components/            # Shared navigation, controls, patient avatars, assessment panels
  features/
    blink/               # Blink tracking state machine and measurement helpers
    demo/                # Isolated guest session, sample records, actual local results, PDFs
    meibography/          # Assessment state, scoring, image helpers and lazy model/PDF loaders
    tests/               # Shared eye-check catalog and navigation descriptions
  styles/
    base.css             # Shared reset, controls and motion; loaded at startup
    tokens.css           # Colors, surfaces, typography and spacing tokens
    login.css            # Sign-in studio; loaded with the login route
    dashboard.css        # Legacy patient/report styles; loaded with workspace/exams
    workspace.css        # Sidebar, home, cards and test library; loaded with Layout
    assessment.css       # Assessment surfaces; loaded with the exam route
    clinical.css         # Legacy clinical styles; loaded with the exam route
    exam-layout.css      # Responsive assessment geometry
    exam-polish.css      # Assessment control finish
  utils/                 # API URL handling, authentication, HTTP and scoped caches
  assets/                # Local icons and eye reference images
```

`App.jsx` loads route screens on demand. `utils/performance.js` shares route imports and warms a page on navigation hover or keyboard focus, while respecting data-saving and slow-connection settings. Assessment panels, PDF generation and the face landmark runtime also load only when needed. Opening the home or sign-in screen does not initialize a camera/model. Camera access starts after the visitor chooses to enable it.

Legacy dashboard and clinical rules stay in `@layer legacy`. Current route styles and feature components retain precedence. `App.jsx` lazily loads `Layout`, so sign-in does not download dashboard, workspace, or assessment CSS. Shared resets and animation keyframes live in `styles/base.css`. Product motion uses transform and opacity and respects reduced-motion preferences. The eye artwork is a shared inline SVG component and fonts use the system stack; neither needs an external download.

`utils/api.js` centralizes API URLs. The clinician workflow uses `/api/upload`, `/api/predict` and `/api/results`. Protected routes permit guests to use all tests without assigning a clinician or administrator role. `features/demo/adapter.js` serves fictional sample records alongside guest-created profiles, saved measurements, questionnaires, and reports. It rejects staff, administrator, unknown, and external actions. Only allowlisted same-origin `/api/guest/meibography/` endpoints reach the backend for model status, image analysis, enhancement, and tear measurements. These operations require the backend; segmentation additionally requires the trained checkpoints. Selected images are sent for processing without granting access to staff records or saving them to the clinical database.

Guest changes use tab-scoped session storage; resetting or exiting clears those changes and releases PDF object URLs. Sample records carry `demo_sample: true`; guest-created results carry `demo_sample: false` and `guest_session: true`. The Home screen counts guest-created completed tests and reports, and the test library supports category filters, text search, and keyboard navigation.

Patient and clinic caches use a stable account identity and role. Guest caches have a separate tab-scoped namespace. The frontend does not migrate unscoped legacy caches, which could belong to another account on a shared browser.

From `frontend/`, run `npm test` for blink tracking and guest isolation, `npm run check` for undefined source references, and `npm run build` for a production bundle. The source check uses Babel already provided by the Vite React build plugin; no additional dependency is installed.
