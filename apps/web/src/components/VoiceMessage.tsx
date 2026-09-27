import { formatDuration, type VoiceMeta } from '@galena/chat-core';
import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const TICK_MS = 100;

export function VoiceMessage({ voice, own }: { voice: VoiceMeta; own: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const progressRef = useRef(0);

  useEffect(() => {
    if (!playing) {
      return;
    }
    const startedAt = Date.now() - progressRef.current * voice.duration_ms;
    const timer = window.setInterval(() => {
      const next = (Date.now() - startedAt) / voice.duration_ms;
      if (next >= 1) {
        progressRef.current = 0;
        setProgress(0);
        setPlaying(false);
        return;
      }
      progressRef.current = next;
      setProgress(next);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, voice.duration_ms]);

  const togglePlay = (): void => {
    if (!playing && progressRef.current >= 1) {
      progressRef.current = 0;
      setProgress(0);
    }
    setPlaying((value) => !value);
  };

  return (
    <div className="min-w-[190px]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={playing ? 'Pause voice message' : 'Play voice message'}
          onClick={togglePlay}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
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
                  played ? 'bg-accent' : 'bg-muted-foreground/40',
                )}
                style={{ height: `${Math.max(3, Math.round((value / 255) * 28))}px` }}
              />
            );
          })}
        </span>
        <span
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
            className={cn(
              'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold',
              own ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
              'hover:bg-black/5 dark:hover:bg-white/10',
            )}
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
