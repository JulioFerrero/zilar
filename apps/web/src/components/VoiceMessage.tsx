import { Data, Effect, Schedule } from 'effect';
import { formatDuration, type VoiceMeta } from '@zilar/chat-core';
import { Captions, Pause, Play } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { cn } from '@/lib/utils';
import { getVoiceTranscript } from '@/lib/api';
import { mediaSrc } from '@/lib/attachments';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useVoiceTranscriptionEnabled } from '@/lib/useVoiceTranscription';

const TICK_MS = 100;

/** The browser refused to start playback (autoplay policy, missing bytes, no audio API). */
class PlayRefused extends Data.TaggedError('PlayRefused') {}

type TranscriptState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; text: string }
  | { kind: 'error'; message: string };

/** The audio element sending play/pause events right now, if any. */
let activeVoiceAudio: HTMLAudioElement | null = null;

/** Session memory of fetched transcripts, keyed by voice URL: toggling a
 * transcript (or meeting the same message again) never refetches. */
const transcriptCache = new Map<string, string>();

/** Forgets the session cache (tests only). */
export function resetVoiceTranscriptCache(): void {
  transcriptCache.clear();
}

function friendlyTranscriptError(failure: ApiFailure): string {
  if (failure.code === 'transcription_not_configured') {
    return 'Transcription is not set up on this server.';
  }
  if (failure.code === 'rate_limited') {
    return 'Too many tries — wait a little and try again.';
  }
  if (failure.code === 'voice_too_large') {
    return 'The recording is too large to transcribe.';
  }
  if (failure.code === 'not_audio') {
    return 'The file is not a supported recording.';
  }
  if (failure.code === 'network_error') {
    return 'Could not reach the server.';
  }
  return 'Transcription failed. Try again.';
}

export function VoiceMessage({
  chatId,
  voice,
  own,
}: {
  /** The chat JID, required by `GET /api/files`, which checks membership. */
  chatId: string;
  voice: VoiceMeta;
  own: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptState>(() => {
    // A transcript that arrived with the message (older servers may embed
    // one) shows without a fetch.
    if (voice.transcript !== undefined) {
      return { kind: 'ready', text: voice.transcript.text };
    }
    return { kind: 'idle' };
  });
  const labelId = useId();
  const playable = voice.url !== undefined && voice.url !== '' && !failed;
  // Playback goes through the file route; transcription keeps the raw URL.
  const audioSrc =
    voice.url === undefined || voice.url === '' ? undefined : mediaSrc(chatId, voice.url);
  const transcriptionEnabled = useVoiceTranscriptionEnabled();
  const canTranscribe = transcriptionEnabled && voice.url !== undefined && voice.url !== '';
  const showControl = voice.transcript !== undefined || canTranscribe;

  // The playback progress tick: one read every TICK_MS while the message
  // plays. The query is rebuilt on each `playing` change, so a pause, the end
  // or an unmount interrupts the loop. The first read comes one tick after play.
  useQuery(
    (): Effect.Effect<unknown> =>
      playing
        ? Effect.sync(() => {
            const audio = audioRef.current;
            if (audio === null || !Number.isFinite(audio.duration) || audio.duration <= 0) {
              return;
            }
            setProgress(Math.min(1, audio.currentTime / audio.duration));
          }).pipe(Effect.repeat(Schedule.spaced(TICK_MS)), Effect.delay(TICK_MS))
        : Effect.void,
    [playing],
  );

  // One transcript fetch; the outcome lands in `transcript`. Unmounting
  // interrupts it, so a late answer never updates a message that is gone.
  const [, fetchTranscript] = useAction((url: string) =>
    fromApi(() => getVoiceTranscript(url)).pipe(
      Effect.matchEffect({
        onSuccess: ({ text }) =>
          Effect.sync(() => {
            transcriptCache.set(url, text);
            setTranscript({ kind: 'ready', text });
          }),
        onFailure: (failure) =>
          Effect.sync(() => {
            setTranscript({ kind: 'error', message: friendlyTranscriptError(failure) });
          }),
      }),
    ),
  );

  // Starting playback. A refused play shows the unavailable state. When the
  // play resolves, the element's own `onPlay` flips the button, so this never
  // sets `playing` directly: the button always reflects the real state.
  const [, startPlayback] = useAction(
    (audio: HTMLAudioElement) =>
      Effect.try({ try: () => audio.play(), catch: () => new PlayRefused() }).pipe(
        Effect.flatMap((started) =>
          started === undefined
            ? Effect.void
            : Effect.tryPromise({ try: () => started, catch: () => new PlayRefused() }),
        ),
        Effect.catchTag('PlayRefused', () => Effect.sync(() => setFailed(true))),
      ),
    { mode: 'replace' },
  );

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

  const toggleTranscript = (): void => {
    if (transcriptOpen) {
      setTranscriptOpen(false);
      return;
    }
    setTranscriptOpen(true);
    if (transcript.kind === 'ready' || transcript.kind === 'loading') {
      return;
    }
    const url = voice.url;
    if (url === undefined || url === '') {
      return;
    }
    const cached = transcriptCache.get(url);
    if (cached !== undefined) {
      setTranscript({ kind: 'ready', text: cached });
      return;
    }
    setTranscript({ kind: 'loading' });
    fetchTranscript(url);
  };

  const retryTranscript = (): void => {
    const url = voice.url;
    if (url === undefined || url === '') {
      return;
    }
    setTranscript({ kind: 'loading' });
    fetchTranscript(url);
  };

  const togglePlay = (): void => {
    const audio = audioRef.current;
    // A failed audio may be retried by clicking again (the error can be
    // transient); only a message without any audio URL is a dead button.
    if (audio === null || voice.url === undefined || voice.url === '') {
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
    setFailed(false);
    startPlayback(audio);
  };

  return (
    <div className="min-w-[190px]">
      {voice.url !== undefined && (
        <audio
          ref={audioRef}
          src={audioSrc}
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
        <Button
          type="button"
          size="icon-lg"
          aria-label={playing ? 'Pause voice message' : 'Play voice message'}
          aria-disabled={!playable}
          {...(!playable ? { title: 'Audio unavailable' } : {})}
          onClick={togglePlay}
          className={cn('size-10 shrink-0 rounded-full', !playable && 'opacity-50')}
        >
          {playing ? (
            <Pause className="size-4" aria-hidden="true" />
          ) : (
            <Play className="size-4 translate-x-px" aria-hidden="true" />
          )}
        </Button>
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
        {showControl && (
          <IconButton
            size={24}
            radius={6}
            aria-label={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
            aria-pressed={transcriptOpen}
            onClick={toggleTranscript}
          >
            <Captions className="size-3.5" aria-hidden="true" />
          </IconButton>
        )}
      </div>
      {transcriptOpen && showControl && transcript.kind === 'loading' && (
        <div className="mt-1.5">
          <StateMessage kind="loading" size="inline" title="Transcribing…" />
        </div>
      )}
      {transcriptOpen && showControl && transcript.kind === 'ready' && (
        <p className="mt-1.5 max-w-[420px] text-[14px] leading-5 whitespace-pre-wrap">
          {transcript.text}
        </p>
      )}
      {transcriptOpen && showControl && transcript.kind === 'error' && (
        <div className="mt-1.5 flex items-center gap-2 text-[14px]">
          <span className="text-danger">{transcript.message}</span>
          <Button type="button" variant="secondary" size="sm" onClick={retryTranscript}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
