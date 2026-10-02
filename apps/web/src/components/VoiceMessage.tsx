import { formatDuration, type VoiceMeta } from '@zilar/chat-core';
import { Pause, Play } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const TICK_MS = 100;

/** The audio element sending play/pause events right now, if any. */
let activeVoiceAudio: HTMLAudioElement | null = null;

export function VoiceMessage({ voice, own }: { voice: VoiceMeta; own: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const labelId = useId();
  const playable = voice.url !== undefined && voice.url !== '' && !failed;

  useEffect(() => {
    if (!playing) {
      return;
    }
    const timer = window.setInterval(() => {
      const audio = audioRef.current;
      if (audio === null || !Number.isFinite(audio.duration) || audio.duration <= 0) {
        return;
      }
      setProgress(Math.min(1, audio.currentTime / audio.duration));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing]);

  // A voice message that unmounts mid-play leaves nothing behind: another
  // player is free to start, and this element never resumes on its own.
  useEffect(
    () => () => {
      if (activeVoiceAudio === audioRef.current) {
        activeVoiceAudio = null;
      }
    },
    [],
  );

  // The button reflects the element's real state, not just its own clicks:
  // the track ending, a media key, or another player pausing this one all
  // flow through these handlers. `paused` alone cannot drive this: jsdom
  // (and a loaded-but-idle element) reports `paused` while playing, so the
  // handlers trust the event itself over the property.
  const onAudioPlay = (audio: HTMLAudioElement): void => {
    activeVoiceAudio = audio;
    setFailed(false);
    setPlaying(true);
  };

  const onAudioPause = (audio: HTMLAudioElement): void => {
    setPlaying(false);
    if (activeVoiceAudio === audio) {
      activeVoiceAudio = null;
    }
  };

  const onAudioEnded = (audio: HTMLAudioElement): void => {
    setPlaying(false);
    setProgress(0);
    if (activeVoiceAudio === audio) {
      activeVoiceAudio = null;
    }
  };

  const togglePlay = (): void => {
    const audio = audioRef.current;
    if (audio === null || !playable) {
      return;
    }
    if (playing) {
      audio.pause();
      return;
    }
    // Only one voice message plays at a time: starting one pauses the other.
    if (activeVoiceAudio !== null && activeVoiceAudio !== audio) {
      activeVoiceAudio.pause();
    }
    if (audio.currentTime > 0 && audio.duration > 0 && audio.currentTime >= audio.duration) {
      audio.currentTime = 0;
      setProgress(0);
    }
    try {
      const play = audio.play();
      // A rejected play (autoplay policy, missing bytes) shows the
      // unavailable state instead of a dead button. When the play resolves,
      // the element's own `onPlay` flips the button, so this never sets
      // `playing` directly: the button always reflects the real state.
      if (play !== undefined) {
        void Promise.resolve(play).catch(() => setFailed(true));
      }
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="min-w-[190px]">
      {voice.url !== undefined && (
        <audio
          ref={audioRef}
          src={voice.url}
          preload="metadata"
          aria-labelledby={labelId}
          onPlay={(event) => onAudioPlay(event.currentTarget)}
          onPause={(event) => onAudioPause(event.currentTarget)}
          onEnded={(event) => onAudioEnded(event.currentTarget)}
          onError={() => {
            setFailed(true);
            setPlaying(false);
            setProgress(0);
          }}
        />
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={playing ? 'Pause voice message' : 'Play voice message'}
          aria-disabled={!playable}
          {...(!playable ? { title: 'Audio unavailable' } : {})}
          onClick={togglePlay}
          className={cn(
            'key-primary flex size-10 shrink-0 items-center justify-center rounded-full',
            !playable && 'opacity-50',
          )}
        >
          {playing ? (
            <Pause className="size-4" aria-hidden="true" />
          ) : (
            <Play className="size-4 translate-x-px" aria-hidden="true" />
          )}
        </button>
        <span className="flex h-8 flex-1 items-center gap-[2px]" aria-hidden="true">
          {voice.waveform.map((value, index) => {
            const played = index / voice.waveform.length <= progress;
            return (
              <span
                key={index}
                className={cn(
                  'w-[2px] rounded-full',
                  played ? 'bg-voice-played' : 'bg-voice-unplayed',
                )}
                style={{ height: `${Math.max(3, Math.round((value / 255) * 28))}px` }}
              />
            );
          })}
        </span>
        <span
          id={labelId}
          className={cn(
            'shrink-0 text-[12px] tabular-nums',
            own ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
          )}
        >
          {formatDuration(voice.duration_ms)}
        </span>
        {voice.transcript !== undefined && (
          <button
            type="button"
            aria-label={showTranscript ? 'Hide transcript' : 'Show transcript'}
            aria-pressed={showTranscript}
            onClick={() => setShowTranscript((value) => !value)}
            className="key-icon shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold"
          >
            Aa
          </button>
        )}
      </div>
      {showTranscript && voice.transcript !== undefined && (
        <p className="mt-1.5 max-w-[420px] text-[14px] leading-5 whitespace-pre-wrap">
          {voice.transcript.text}
        </p>
      )}
    </div>
  );
}
