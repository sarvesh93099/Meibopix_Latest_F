"""PyTorch backend and checkpoint loader; imported only by the full profile/exporter."""
import os
import segmentation_models_pytorch as smp
import torch
from app.utils.env import env_int
from app.utils.cpu import inference_thread_count

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
TORCH_THREADS = inference_thread_count(env_int('TORCH_THREADS', 0), cuda=DEVICE == 'cuda')
torch.set_num_threads(TORCH_THREADS)
if DEVICE == 'cuda':
    torch.backends.cudnn.benchmark = True
DEFAULT_ENCODER = "efficientnet-b5"
ENCODER_CANDIDATES = ["efficientnet-b5", "efficientnet-b4", "efficientnet-b3",
    "efficientnet-b2", "efficientnet-b1", "efficientnet-b0", "resnet50", "resnet34",
    "resnet18", "resnet101", "resnet152", "mobilenet_v2", "densenet121"]

# Build a plain U-Net shell before loading the checkpoint weights into it.
def _build_model(encoder=DEFAULT_ENCODER):
    """Create the segmentation model architecture expected by the checkpoints."""
    with torch.device("meta"):
        return smp.Unet(
            encoder_name=encoder,
            encoder_weights=None,
            in_channels=3,
            classes=1,
        )


# Normalize several common checkpoint formats into a bare state dict the model can load.
def _normalize_checkpoint_state_dict(checkpoint):
    """Normalize common training wrapper layouts into a plain state dict."""
    state_dict = checkpoint
    if isinstance(state_dict, dict):
        if "model_state" in state_dict:
            state_dict = state_dict["model_state"]
        elif "state_dict" in state_dict:
            state_dict = state_dict["state_dict"]
        elif "model" in state_dict:
            state_dict = state_dict["model"]

    if isinstance(state_dict, dict) and state_dict:
        first_key = next(iter(state_dict.keys()))
        if first_key.startswith("module."):
            state_dict = {
                (key[7:] if key.startswith("module.") else key): value
                for key, value in state_dict.items()
            }

    return state_dict


# Load the checkpoint once, then reuse the normalized state dict across default/fallback attempts.
def _load_checkpoint_state_dict(path):
    """Load and normalize one checkpoint file into the state dict expected by the model."""
    try:
        checkpoint = torch.load(path, map_location="cpu", mmap=True)
    except (RuntimeError, ValueError) as error:
        if 'mmap' not in str(error).lower():
            raise
        # Older checkpoint formats cannot be memory mapped.
        checkpoint = torch.load(path, map_location="cpu")
    return _normalize_checkpoint_state_dict(checkpoint)


# Apply a prepared state dict onto a freshly built model shell.
def _load_state_strip(module, state_dict):
    """Load a prepared state dict into an initialized model module."""
    module.load_state_dict(state_dict, assign=True)
    return module


# Try each fallback encoder until one produces a compatible model for the checkpoint.
def _load_model_autodetect(path, state_dict):
    """Try a list of encoders until one matches the checkpoint tensor shapes."""
    failures = []
    for encoder in ENCODER_CANDIDATES:
        try:
            model = _build_model(encoder)
            _load_state_strip(model, state_dict)
            return model.to(DEVICE).eval(), encoder
        except Exception as error:
            failures.append(f"{encoder}: {str(error)[:80]}")

    raise RuntimeError(
        f"Unable to load checkpoint '{os.path.basename(path)}' with known encoders:\n" +
        "\n".join(failures)
    )


# Load with the default encoder first because that is the fast path for expected checkpoints.
def _load_binary_model(path, encoder=DEFAULT_ENCODER):
    """Load a model with the preferred encoder first, then fall back to autodetect."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing model file: {path}")

    state_dict = _load_checkpoint_state_dict(path)

    try:
        model = _build_model(encoder)
        loaded_model = _load_state_strip(model, state_dict).to(DEVICE).eval()
        return loaded_model, encoder
    except Exception as error:
        return _load_model_autodetect(path, state_dict)



class TorchModel:
    def __init__(self, module):
        self.module = module

    def predict(self, array):
        tensor = torch.from_numpy(array).to(DEVICE, non_blocking=DEVICE == 'cuda')
        with torch.inference_mode():
            return torch.sigmoid(self.module(tensor))[0, 0].cpu().numpy()


class TorchBackend:
    name = 'torch'
    device = DEVICE
    cpu_threads = TORCH_THREADS
    extension = '.pth'

    def load_model(self, path):
        model, encoder = _load_binary_model(path)
        return TorchModel(model), encoder

    def get_status(self):
        return {}
