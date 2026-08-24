import argparse
import hashlib
import json
import os
import shutil
import sys
import time
import traceback
import uuid
import wave
from pathlib import Path

MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
SUPPORTED_LANGUAGES = ("en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "ja", "hu", "ko", "hi")
MAX_REFERENCE_FILES = 5
MAX_CHUNK_CHARS = 280
MIN_MODEL_BYTES = 100 * 1024 * 1024
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)

def runtime_root():
    return Path(os.environ.get("NARRA_XTTS_RUNTIME_ROOT", Path.cwd())).resolve()

def model_dir():
    tts_home = Path(os.environ.get("TTS_HOME", runtime_root() / "models"))
    return tts_home / "tts" / "tts_models--multilingual--multi-dataset--xtts_v2"

def checkpoint_metadata():
    import torch
    root = model_dir()
    required = ("model.pth", "config.json", "vocab.json", "speakers_xtts.pth")
    missing = [
        name for name in required
        if not (root / name).is_file()
        or (root / name).stat().st_size < (MIN_MODEL_BYTES if name == "model.pth" else 1)
    ]
    if missing:
        return {"installed": False, "reason": f"missing:{','.join(missing)}", "speakers": [], "languages": list(SUPPORTED_LANGUAGES)}
    try:
        config = json.loads((root / "config.json").read_text(encoding="utf-8"))
        speaker_data = torch.load(root / "speakers_xtts.pth", map_location="cpu", weights_only=True)
        speakers = list(speaker_data.keys()) if isinstance(speaker_data, dict) else []
        languages = config.get("languages") or list(SUPPORTED_LANGUAGES)
        if not speakers or not isinstance(languages, list):
            raise ValueError("checkpoint metadata is incomplete")
        return {"installed": True, "speakers": speakers, "languages": languages}
    except (OSError, ValueError, TypeError, RuntimeError) as error:
        return {"installed": False, "reason": f"checkpoint:{error}", "speakers": [], "languages": list(SUPPORTED_LANGUAGES)}

def runtime_info():
    import torch
    from TTS.api import TTS as _TTS
    del _TTS
    metadata = checkpoint_metadata()
    return {**metadata, "modelName": MODEL_NAME, "torchVersion": torch.__version__, "cudaAvailable": torch.cuda.is_available(), "cudaName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "", "device": "cuda" if torch.cuda.is_available() else "cpu"}

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

def validate_request(request, speakers):
    text = request.get("text")
    try:
        request["requestId"] = str(uuid.UUID(str(request.get("requestId", ""))))
    except ValueError as error:
        raise ValueError("Invalid XTTS-v2 request id") from error
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Invalid XTTS-v2 request")
    if request.get("mode") not in ("preset", "clone"):
        raise ValueError("Mode must be preset or clone")
    if request.get("language") not in SUPPORTED_LANGUAGES:
        raise ValueError("Unsupported XTTS-v2 language")
    if request["mode"] == "preset" and request.get("speaker") not in speakers:
        raise ValueError("Unknown XTTS-v2 preset speaker")
    reference_paths = request.get("referencePaths", [])
    if request["mode"] == "clone":
        if not isinstance(reference_paths, list) or not 1 <= len(reference_paths) <= MAX_REFERENCE_FILES:
            raise ValueError("Clone mode requires one to five reference files")
        if any(not Path(str(item)).is_file() for item in reference_paths):
            raise ValueError("Reference audio not found")

def split_long_segment(text, max_chars=MAX_CHUNK_CHARS):
    remaining = " ".join(text.split())
    chunks = []
    while len(remaining) > max_chars:
        window = remaining[: max_chars + 1]
        floor = max_chars // 2
        cut = max(window.rfind(separator, floor) for separator in (" ", ",", ";", ":", "—", "-"))
        if cut < floor:
            cut = max_chars
        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks

def plan_segments(model, text):
    sentences = model.synthesizer.split_into_sentences(text.strip()) or [text.strip()]
    return [chunk for sentence in sentences for chunk in split_long_segment(sentence) if chunk]

def request_fingerprint(request, segments):
    references = []
    for item in request.get("referencePaths", []):
        file_path = Path(item).resolve()
        stat = file_path.stat()
        references.append({"path": str(file_path), "size": stat.st_size, "mtimeNs": stat.st_mtime_ns})
    payload = {"segments": segments, "mode": request["mode"], "language": request["language"], "speaker": request.get("speaker", ""), "speed": float(request.get("speed", 1.0)), "references": references}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

def valid_wav(file_path):
    try:
        with wave.open(str(file_path), "rb") as wav_file:
            return wav_file.getnframes() > 0 and wav_file.getframerate() > 0
    except (OSError, EOFError, wave.Error):
        return False

def write_checkpoint(file_path, fingerprint, completed):
    temporary = file_path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"version": 1, "fingerprint": fingerprint, "completed": sorted(completed)}), encoding="utf-8")
    os.replace(temporary, file_path)

def concatenate_wavs(chunk_paths, output_path):
    temporary = output_path.with_suffix(f"{output_path.suffix}.partial")
    temporary.unlink(missing_ok=True)
    expected = None
    try:
        with wave.open(str(temporary), "wb") as output:
            for chunk_path in chunk_paths:
                with wave.open(str(chunk_path), "rb") as source:
                    params = (source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getcomptype())
                    if expected is None:
                        expected = params
                        output.setnchannels(params[0])
                        output.setsampwidth(params[1])
                        output.setframerate(params[2])
                        output.setcomptype(params[3], source.getcompname())
                    elif params != expected:
                        raise ValueError("XTTS-v2 chunks have incompatible WAV formats")
                    while frames := source.readframes(65_536):
                        output.writeframesraw(frames)
        os.replace(temporary, output_path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise

def generate(model, request, speakers):
    validate_request(request, speakers)
    started = time.monotonic()
    output_path = Path(request["outputPath"]).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    segments = plan_segments(model, request["text"])
    if not segments:
        raise ValueError("XTTS-v2 text produced no segments")
    fingerprint = request_fingerprint(request, segments)
    job_dir = runtime_root() / "jobs" / request["requestId"]
    checkpoint_path = job_dir / "checkpoint.json"
    checkpoint = {}
    try:
        checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    if checkpoint.get("fingerprint") != fingerprint:
        shutil.rmtree(job_dir, ignore_errors=True)
    job_dir.mkdir(parents=True, exist_ok=True)
    completed = {
        index for index in range(len(segments))
        if valid_wav(job_dir / f"segment-{index + 1:04d}.wav")
    }
    resumed_count = len(completed)
    write_checkpoint(checkpoint_path, fingerprint, completed)
    emit({"type": "progress", "event": "generation_plan", "requestId": request["requestId"], "totalSegments": len(segments), "completedSegments": len(completed), "resumedSegments": resumed_count})
    options = {"language": request["language"], "speed": float(request.get("speed", 1.0)), "split_sentences": False}
    if request["mode"] == "preset":
        options["speaker"] = request["speaker"]
    else:
        options["speaker_wav"] = request["referencePaths"]
    emit({"type": "progress", "event": "generation_started", "requestId": request["requestId"], "mode": request["mode"], "language": request["language"], "speed": options["speed"], "textChars": len(request["text"].strip())})
    for index, segment in enumerate(segments):
        chunk_path = job_dir / f"segment-{index + 1:04d}.wav"
        if index in completed:
            continue
        chunk_path.unlink(missing_ok=True)
        emit({"type": "progress", "event": "segment_started", "requestId": request["requestId"], "segmentIndex": index + 1, "totalSegments": len(segments), "completedSegments": len(completed), "resumedSegments": resumed_count, "segmentChars": len(segment)})
        model.tts_to_file(text=segment, file_path=str(chunk_path), **options)
        if not valid_wav(chunk_path):
            raise RuntimeError(f"XTTS-v2 segment {index + 1} is not a valid WAV")
        completed.add(index)
        write_checkpoint(checkpoint_path, fingerprint, completed)
        emit({"type": "progress", "event": "segment_completed", "requestId": request["requestId"], "segmentIndex": index + 1, "totalSegments": len(segments), "completedSegments": len(completed), "resumedSegments": resumed_count, "segmentChars": len(segment)})
    concatenate_wavs([job_dir / f"segment-{index + 1:04d}.wav" for index in range(len(segments))], output_path)
    with wave.open(str(output_path), "rb") as wav_file:
        sample_rate = wav_file.getframerate()
        audio_frames = wav_file.getnframes()
    shutil.rmtree(job_dir, ignore_errors=True)
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
        emit({"ok": True, "installed": True, "modelName": MODEL_NAME, **details})
    elif args.serve:
        serve()
    else:
        parser.error("Choose --check, --download, or --serve")

if __name__ == "__main__":
    main()
