import argparse
import json
import os
import sys
import time
import traceback
import wave
from pathlib import Path

MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
SUPPORTED_LANGUAGES = ("en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "ja", "hu", "ko", "hi")
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)

def runtime_root():
    return Path(os.environ.get("NARRA_XTTS_RUNTIME_ROOT", Path.cwd())).resolve()

def marker_path():
    return runtime_root() / "runtime.json"

def read_marker():
    try:
        return json.loads(marker_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}

def runtime_info():
    import torch
    marker = read_marker()
    return {"installed": marker.get("modelName") == MODEL_NAME, "modelName": MODEL_NAME, "torchVersion": torch.__version__, "cudaAvailable": torch.cuda.is_available(), "cudaName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "", "device": "cuda" if torch.cuda.is_available() else "cpu", "speakers": marker.get("speakers", []), "languages": marker.get("languages", list(SUPPORTED_LANGUAGES))}

def load_model():
    import torch
    from TTS.api import TTS
    device = "cuda" if torch.cuda.is_available() else "cpu"
    started = time.monotonic()
    emit({"type": "lifecycle", "event": "worker_model_loading", "device": device})
    model = TTS(MODEL_NAME).to(device)
    details = {"device": device, "cudaAvailable": torch.cuda.is_available(), "cudaName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "", "torchVersion": torch.__version__, "loadMs": round((time.monotonic() - started) * 1000), "speakers": list(model.speakers or []), "languages": list(model.languages or SUPPORTED_LANGUAGES)}
    emit({"type": "lifecycle", "event": "worker_model_loaded", **details})
    return model, details

def write_marker(details):
    root = runtime_root()
    root.mkdir(parents=True, exist_ok=True)
    marker_path().write_text(json.dumps({"modelName": MODEL_NAME, "speakers": details["speakers"], "languages": details["languages"]}, ensure_ascii=False, indent=2), encoding="utf-8")

def validate_request(request, speakers):
    text = request.get("text")
    if not request.get("requestId") or not isinstance(text, str) or not text.strip():
        raise ValueError("Invalid XTTS-v2 request")
    if request.get("mode") not in ("preset", "clone"):
        raise ValueError("Mode must be preset or clone")
    if request.get("language") not in SUPPORTED_LANGUAGES:
        raise ValueError("Unsupported XTTS-v2 language")
    if request["mode"] == "preset" and request.get("speaker") not in speakers:
        raise ValueError("Unknown XTTS-v2 preset speaker")
    if request["mode"] == "clone" and not Path(str(request.get("referencePath", ""))).is_file():
        raise ValueError("Reference audio not found")

def generate(model, request, speakers):
    validate_request(request, speakers)
    started = time.monotonic()
    output_path = Path(request["outputPath"]).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    options = {"text": request["text"].strip(), "language": request["language"], "file_path": str(output_path), "speed": float(request.get("speed", 1.0)), "split_sentences": True}
    if request["mode"] == "preset":
        options["speaker"] = request["speaker"]
    else:
        options["speaker_wav"] = request["referencePath"]
    emit({"type": "progress", "event": "generation_started", "requestId": request["requestId"], "mode": request["mode"], "language": request["language"], "speed": options["speed"], "textChars": len(options["text"])})
    model.tts_to_file(**options)
    with wave.open(str(output_path), "rb") as wav_file:
        sample_rate = wav_file.getframerate()
        audio_frames = wav_file.getnframes()
    return {"type": "result", "ok": True, "requestId": request["requestId"], "elapsedMs": round((time.monotonic() - started) * 1000), "outputBytes": output_path.stat().st_size, "sampleRate": sample_rate, "audioFrames": audio_frames}

def serve():
    model, details = load_model()
    emit({"type": "ready", "event": "worker_ready", **details})
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            emit({"type": "lifecycle", "event": "request_received", "requestId": request.get("requestId"), "mode": request.get("mode"), "language": request.get("language"), "speed": request.get("speed"), "textChars": len(request.get("text", ""))})
            emit(generate(model, request, details["speakers"]))
        except Exception as error:
            request_id = request.get("requestId") if isinstance(request, dict) else ""
            emit({"type": "diagnostic", "event": "xtts_generation_failed", "requestId": request_id, "stage": "generate_audio", "errorType": type(error).__name__, "traceback": traceback.format_exc()})
            emit({"type": "result", "ok": False, "requestId": request_id, "error": str(error)})

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    if args.check:
        emit(runtime_info())
    elif args.download:
        _, details = load_model()
        write_marker(details)
        emit({"ok": True, **runtime_info()})
    elif args.serve:
        serve()
    else:
        parser.error("Choose --check, --download, or --serve")

if __name__ == "__main__":
    main()
