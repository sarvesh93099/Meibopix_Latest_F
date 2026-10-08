# Deploy models without Git LFS

Code, the small checkpoint manifest, and trained model files have separate lifecycles. Git stores source code and `backend/meibography_models/manifest.json`. The four `.pth` checkpoints stay on local disk and are ignored by Git. No Git LFS client is needed to build, deploy, or run the application.

The website uses the same checkpoint bytes, input size, segmentation algorithm, and grading as before. Moving the download out of Git does not change inference quality or add a network hop to image requests. Deployment verifies SHA-256 checksums; the running server loads the verified files from local storage and retains its lazy, process-wide model instances.

## Local files or an uploaded project

Keep the four original `.pth` files in `backend/meibography_models/`. Upload the source folder and the checkpoints to EC2 at `/opt/meibography/meibography`. `ec2_setup.sh` also accepts a project uploaded without a `.git` directory.

Verify the copied weights before startup:

```bash
cd /opt/meibography/meibography
.venv/bin/python deploy/scripts/manage_models.py verify
```

On Windows, run the same script with your virtual environment's Python executable. A checkpoint must match both the size and SHA-256 digest in the manifest. Git LFS pointer files do not pass verification.

## Private S3 storage

Upload the original checkpoints once, from a machine that has them:

```bash
aws s3 cp backend/meibography_models/ s3://YOUR-PRIVATE-BUCKET/meibopix-models/v1/ --recursive --exclude "*" --include "*.pth"
```

Set this in the server's `.env` or deployment environment:

```env
MODEL_SOURCE=s3://YOUR-PRIVATE-BUCKET/meibopix-models/v1
MODEL_PATH=./backend/meibography_models
```

Give the EC2 instance role `s3:GetObject` permission for this prefix. Use a separate prefix from patient uploads and reports. Run:

```bash
.venv/bin/python deploy/scripts/manage_models.py sync
```

`sync` skips files that already match the manifest. Missing or corrupt checkpoints are downloaded into a temporary folder, verified as a complete set, then moved into place. A failed download or checksum leaves the installed files intact. S3 is accessed during deployment, never during inference. A local source folder can also be supplied with `--source /path/to/original/models`.

## Docker

Model weights are excluded from the Docker build context. Compose mounts `./backend/meibography_models` into the backend read-only. This avoids copying roughly 504 MB into each application image and allows code updates to reuse the same local files.

Verify/sync the model files on the host, then build and start Compose. A standalone `docker run` must mount the model directory at `/app/backend/meibography_models` too.

## EC2 profiles and updates

EC2 setup/update scripts install the complete `backend/requirements.txt` dependency list and verify/sync the models before restarting the service.

Fresh EC2 virtual environments and Docker builds use the single `backend/requirements.txt` file and select CPU PyTorch packages by default from the [official PyTorch CPU index](https://download.pytorch.org/whl/cpu/), avoiding unused CUDA dependencies on CPU hosts. For a GPU host, set `TORCH_DEVICE=cuda` when running setup/update or building Docker, and provision the matching NVIDIA runtime. Choose the compute platform using [PyTorch's installation guide](https://pytorch.org/get-started/locally/). An existing virtual environment retains its already-installed compatible PyTorch build; changing the deployment flag does not silently replace it.

Routine CI installs `backend/requirements.txt` and runs regression/API checks without downloading model weights. The manual `run_ml_tests` workflow option uses the same dependencies, then fetches verified checkpoints through the repository's `MODEL_SOURCE` variable and AWS credentials to verify full inference.

## If weights were already tracked by Git

Adding an ignore rule does not remove files from old Git commits. Once the real checkpoints are safely retained locally, stop tracking them in a new commit:

```bash
git rm --cached -- backend/meibography_models/*.pth
git add .gitignore .gitattributes backend/meibography_models/manifest.json
git commit -m "Deploy local model assets independently of Git LFS"
```

`--cached` leaves local files on disk. Existing repository history still contains its earlier LFS references; a fresh checkout of the new commit does not require downloading them. If checkpoints are retrained, regenerate the manifest from the new original files and publish them to a new source prefix together.
