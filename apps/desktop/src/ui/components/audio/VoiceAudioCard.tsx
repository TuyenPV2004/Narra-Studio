import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface VoiceAudioCardProps {
  src: string;
  filename?: string | undefined;
  title?: string | undefined;
  subtitle?: string | undefined;
  className?: string | undefined;
  compact?: boolean | undefined;
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function VoiceAudioCard({
  src,
  className = "",
  compact = false,
}: VoiceAudioCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState("");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setPlaybackError("");
      if (Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handleError = () => {
      setIsPlaying(false);
      setPlaybackError("Không thể phát âm thanh.");
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [src]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      setPlaybackError("");
      audio.play().catch((error) => {
        setIsPlaying(false);
        setPlaybackError(
          "Không thể phát tệp âm thanh này: " +
            (error instanceof Error ? error.message : String(error)),
        );
      });
    }
  }, [isPlaying]);

  const seekRelative = useCallback(
    (delta: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const targetDuration = duration || audio.duration || 0;
      const targetTime = Math.max(
        0,
        Math.min(targetDuration, audio.currentTime + delta),
      );
      audio.currentTime = targetTime;
      setCurrentTime(targetTime);
    },
    [duration],
  );

  const handleSeek = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio) return;
      const nextTime = Number(event.target.value);
      audio.currentTime = nextTime;
      setCurrentTime(nextTime);
    },
    [],
  );

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className={`source-voice-music-card ${compact ? "source-voice-music-card--compact" : ""} ${className}`}
      data-playing={isPlaying}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Top Row: Rewind 10s -> Play/Pause -> Forward 10s */}
      <div className="source-voice-music-card__top">
        <button
          type="button"
          className="source-voice-music-card__skip-btn"
          onClick={() => seekRelative(-10)}
          aria-label="Lùi 10 giây"
          title="Lùi 10s"
        >
          <SkipBack size={15} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="source-voice-music-card__play-btn"
          onClick={togglePlay}
          aria-label={isPlaying ? "Tạm dừng" : "Phát âm thanh"}
          title={isPlaying ? "Tạm dừng" : "Phát"}
        >
          {isPlaying ? (
            <Pause size={15} fill="currentColor" aria-hidden="true" />
          ) : (
            <Play
              size={15}
              fill="currentColor"
              aria-hidden="true"
              style={{ marginLeft: 2 }}
            />
          )}
        </button>

        <button
          type="button"
          className="source-voice-music-card__skip-btn"
          onClick={() => seekRelative(10)}
          aria-label="Tiến 10 giây"
          title="Tiến 10s"
        >
          <SkipForward size={15} aria-hidden="true" />
        </button>
      </div>

      {/* Bottom Timeline: Time Left -> Scrubber -> Time Right */}
      <div className="source-voice-music-card__timeline">
        <span className="source-voice-music-card__time">
          {formatAudioTime(currentTime)}
        </span>

        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          className="source-voice-music-card__scrubber"
          aria-label="Tiến trình âm thanh"
          style={
            {
              "--progress-pct": `${progressPercent}%`,
            } as React.CSSProperties
          }
        />

        <span className="source-voice-music-card__time">
          {formatAudioTime(duration)}
        </span>
      </div>

      {playbackError && (
        <p className="source-voice-playback-error" role="alert">
          {playbackError}
        </p>
      )}
    </div>
  );
}
