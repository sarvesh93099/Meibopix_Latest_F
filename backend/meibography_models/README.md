# Meibography checkpoints

Keep the original checkpoint files in this folder. `.pth` files are ignored by Git and excluded from Docker builds. `manifest.json` records their exact sizes and SHA-256 checksums; retain it in source control.

Required files:

- `best_lower_eyelid_effb5.pth`
- `best_lower_meibo_effb5.pth`
- `best_upper_eyelid_effb5_unet.pth`
- `best_upper_meibo_effb5_unet.pth`

From the project root, run `python deploy/scripts/manage_models.py verify`. To install missing files, use `sync` with `MODEL_SOURCE` set to a local folder or private S3 prefix. Deployment verifies the complete staged set before installing it. The website loads these local files; no downloads occur during image analysis.

Compose mounts this directory read-only. See [deployment without Git LFS](../../deploy/MODELS.md) for the full setup and repository migration.
