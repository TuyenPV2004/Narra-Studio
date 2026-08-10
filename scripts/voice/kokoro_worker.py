from __future__ import annotations

import argparse
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate one Narra narration segment with Kokoro ONNX.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    parser.add_argument("--text-file", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--speed", required=True, type=float)
    parser.add_argument("--language", required=True, choices=("en-us", "en-gb"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not 0.8 <= args.speed <= 1.2:
        raise ValueError("Speed must be between 0.8 and 1.2.")
    text = Path(args.text_file).read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("Narration text is empty.")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    kokoro = Kokoro(args.model, args.voices)
    samples, sample_rate = kokoro.create(
        text,
        voice=args.voice,
        speed=args.speed,
        lang=args.language,
    )
    sf.write(output, samples, sample_rate, subtype="PCM_16")
    print(f"generated={output} sample_rate={sample_rate}")


if __name__ == "__main__":
    main()
