import { Pause, Play, Volume2, VolumeX } from "lucide-react";
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
  filename,
  title,
  subtitle,
  className = "",
  compact = false,
}: VoiceAudioCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
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

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [src]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      void audio.play().catch(() => {
        setIsPlaying(false);
      });
    }
  }, [isPlaying]);

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

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayName = title || filename || "Bản ghi âm thanh";

  return (
    <div
      className={`source-voice-music-card ${compact ? "source-voice-music-card--compact" : ""} ${className}`}
      data-playing={isPlaying}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Top Info & Waveform */}
      <div className="source-voice-music-card__cover">
        <div className="source-voice-music-card__info">
          <span className="source-voice-music-card__title" title={displayName}>
            {displayName}
          </span>
          {subtitle && (
            <span className="source-voice-music-card__subtitle">
              {subtitle}
            </span>
          )}
        </div>

        {/* Waveform Equalizer animation bars */}
        <div
          className={`source-voice-equalizer ${isPlaying ? "is-active" : ""}`}
          aria-hidden="true"
        >
          <span className="source-voice-equalizer__bar" />
          <span className="source-voice-equalizer__bar" />
          <span className="source-voice-equalizer__bar" />
          <span className="source-voice-equalizer__bar" />
          <span className="source-voice-equalizer__bar" />
          <span className="source-voice-equalizer__bar" />
          <span className="source-voice-equalizer__bar" />
          <span className="source-voice-equalizer__bar" />
        </div>
      </div>

      {/* Interactive Controls: Play -> Scrubber -> Time -> Mute in a single horizontal row */}
      <div className="source-voice-music-card__controls">
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
          {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
        </span>

        <button
          type="button"
          className="source-voice-music-card__mute-btn"
          onClick={toggleMute}
          aria-label={isMuted ? "Bật âm thanh" : "Tắt tiếng"}
          title={isMuted ? "Bật âm thanh" : "Tắt tiếng"}
        >
          {isMuted ? (
            <VolumeX size={15} aria-hidden="true" />
          ) : (
            <Volume2 size={15} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
