import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { Check, Pause as PauseIcon, Play as PlayIcon, Settings } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Button } from './Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './DropdownMenu';
import { Spinner } from './Spinner';

/**
 * Scoped audio player primitive — Radix Slider progress bar + play/pause +
 * speed control, replacing the bare native `<audio controls>` element used
 * across Activity Monitor's call recordings. Ported from the shadcn/Radix
 * reference the user supplied; trimmed the standalone SpeedButtonGroup
 * variant and demo track list (unused here — add back if a consumer needs
 * them). Each `<AudioPlayerProvider>` instance is independently scoped (one
 * per expanded row), not a single app-wide player.
 */

const ReadyState = { HAVE_NOTHING: 0, HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3, HAVE_ENOUGH_DATA: 4 };
const NetworkState = { NETWORK_EMPTY: 0, NETWORK_IDLE: 1, NETWORK_LOADING: 2, NETWORK_NO_SOURCE: 3 };

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const mm = mins < 10 ? `0${mins}` : mins;
  const ss = secs < 10 ? `0${secs}` : secs;
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mins}:${ss}`;
}

const AudioPlayerContext = createContext(null);

export function useAudioPlayer() {
  const api = useContext(AudioPlayerContext);
  if (!api) throw new Error('useAudioPlayer must be used inside AudioPlayerProvider');
  return api;
}

const AudioPlayerTimeContext = createContext(null);

function useAudioPlayerTime() {
  const time = useContext(AudioPlayerTimeContext);
  if (time === null) throw new Error('useAudioPlayerTime must be used inside AudioPlayerProvider');
  return time;
}

function useAnimationFrame(callback) {
  const requestRef = useRef(null);
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; }, [callback]);
  useEffect(() => {
    const animate = () => {
      callbackRef.current();
      requestRef.current = requestAnimationFrame(animate);
    };
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, []);
}

/** A single `<audio src>` for the whole subtree — pass `src` once; children
 * (Button/Progress/Time/Duration/Speed) read/drive it via context. */
export function AudioPlayerProvider({ src, onEnded, onError, autoPlay, children }) {
  const audioRef = useRef(null);
  const playPromiseRef = useRef(null);
  const [readyState, setReadyState] = useState(0);
  const [networkState, setNetworkState] = useState(0);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(undefined);
  const [paused, setPaused] = useState(true);
  const [playbackRate, setPlaybackRateState] = useState(1);

  const play = useCallback(async () => {
    if (!audioRef.current) return;
    if (playPromiseRef.current) {
      try { await playPromiseRef.current; } catch { /* superseded by a newer play() call */ }
    }
    // Caught here, not left to the caller: a rejected play() (autoplay policy,
    // an expired presigned URL, an unsupported codec) must never become an
    // unhandled rejection — the app's global handler turns those into a
    // scary, unrelated-looking "Something went wrong" toast. play() should
    // always return a Promise per spec, but jsdom's test-environment stub
    // returns undefined — guard rather than assume.
    const maybePromise = audioRef.current.play();
    const playPromise = maybePromise?.catch
      ? maybePromise.catch((e) => { console.error('[AudioPlayer] play() failed:', e); })
      : Promise.resolve(maybePromise);
    playPromiseRef.current = playPromise;
    return playPromise;
  }, []);

  const pause = useCallback(async () => {
    if (!audioRef.current) return;
    if (playPromiseRef.current) {
      try { await playPromiseRef.current; } catch { /* ignore — pausing regardless */ }
    }
    audioRef.current.pause();
    playPromiseRef.current = null;
  }, []);

  const seek = useCallback((t) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = t;
  }, []);

  const setPlaybackRate = useCallback((rate) => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = rate;
    setPlaybackRateState(rate);
  }, []);

  useAnimationFrame(() => {
    const a = audioRef.current;
    if (!a) return;
    setReadyState(a.readyState);
    setNetworkState(a.networkState);
    setTime(a.currentTime);
    setDuration(a.duration);
    setPaused(a.paused);
  });

  useEffect(() => {
    if (autoPlay) play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPlaying = !paused;
  const isBuffering = readyState < ReadyState.HAVE_FUTURE_DATA && networkState === NetworkState.NETWORK_LOADING;

  const api = useMemo(() => ({
    ref: audioRef, duration, isPlaying, isBuffering, playbackRate, play, pause, seek, setPlaybackRate,
  }), [duration, isPlaying, isBuffering, playbackRate, play, pause, seek, setPlaybackRate]);

  return (
    <AudioPlayerContext.Provider value={api}>
      <AudioPlayerTimeContext.Provider value={time}>
        {/* No crossOrigin attribute: this app doesn't need Web Audio API access
            (no waveform analysis), and requesting CORS mode against recording
            URLs that don't send CORS headers (e.g. presigned S3 URLs) trips
            Chrome's Opaque Response Blocking — the audio fails to load with
            net::ERR_BLOCKED_BY_ORB even though a plain <audio src> would play
            it fine. Live-verified against staging 2026-09-01. */}
        <audio ref={audioRef} src={src} preload="metadata" className="hidden"
          onEnded={() => { pause(); onEnded?.(); }}
          onError={() => onError?.()} />
        {children}
      </AudioPlayerTimeContext.Provider>
    </AudioPlayerContext.Provider>
  );
}

export function AudioPlayerProgress({ className, ...props }) {
  const player = useAudioPlayer();
  const time = useAudioPlayerTime();
  const wasPlayingRef = useRef(false);

  return (
    <SliderPrimitive.Root
      {...props}
      value={[time]}
      onValueChange={(vals) => player.seek(vals[0])}
      min={0}
      // Before metadata loads, duration is NaN and time is still 0 — a
      // literal max={0} makes Radix's percentage math 0/0 (NaN), which it
      // embeds into an inline calc(NaN% + ...) style. max={1} keeps the
      // range non-degenerate (0/1 = 0%) until the real duration arrives.
      max={player.duration || 1}
      step={0.25}
      onPointerDown={() => { wasPlayingRef.current = player.isPlaying; player.pause(); }}
      onPointerUp={() => { if (wasPlayingRef.current) player.play(); }}
      disabled={!Number.isFinite(player.duration)}
      className={cn(
        'group/player relative flex h-4 w-full touch-none items-center select-none data-[disabled]:opacity-50',
        className,
      )}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-slate-200">
        <SliderPrimitive.Range className="absolute h-full bg-indigo-600" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-3 rounded-full bg-indigo-600 opacity-0 shadow transition-opacity group-hover/player:opacity-100 focus-visible:opacity-100 focus-visible:outline-none disabled:pointer-events-none" />
    </SliderPrimitive.Root>
  );
}

export function AudioPlayerTime({ className }) {
  const time = useAudioPlayerTime();
  return <span className={cn('text-xs tabular-nums text-slate-500', className)}>{formatTime(time)}</span>;
}

export function AudioPlayerDuration({ className }) {
  const player = useAudioPlayer();
  return <span className={cn('text-xs tabular-nums text-slate-500', className)}>{formatTime(player.duration)}</span>;
}

export function AudioPlayerButton({ className, ...props }) {
  const player = useAudioPlayer();
  const loading = player.isBuffering && player.isPlaying;
  return (
    <Button
      {...props}
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => (player.isPlaying ? player.pause() : player.play())}
      aria-label={player.isPlaying ? 'Pause' : 'Play'}
      className={cn('relative !rounded-full !p-0 h-8 w-8', className)}
    >
      {player.isPlaying
        ? <PauseIcon size={14} className={loading ? 'opacity-0' : ''} />
        : <PlayIcon size={14} className={loading ? 'opacity-0' : ''} />}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-white/60">
          <Spinner size={14} />
        </div>
      )}
    </Button>
  );
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function AudioPlayerSpeed({ speeds = PLAYBACK_SPEEDS, className }) {
  const player = useAudioPlayer();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="Playback speed" className={cn('!p-1.5 !rounded-lg text-slate-400 hover:text-slate-600', className)}>
          <Settings size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[120px]">
        {speeds.map((speed) => (
          <DropdownMenuItem key={speed} onClick={() => player.setPlaybackRate(speed)} className="flex items-center justify-between">
            <span>{speed === 1 ? 'Normal' : `${speed}x`}</span>
            {player.playbackRate === speed && <Check size={14} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Batteries-included row: Play button, progress slider, elapsed/duration, speed menu. */
export function AudioPlayer({ src, onEnded, onError, autoPlay = true, className }) {
  return (
    <AudioPlayerProvider src={src} onEnded={onEnded} onError={onError} autoPlay={autoPlay}>
      <div className={cn('flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2', className)}>
        <AudioPlayerButton />
        <AudioPlayerTime />
        <AudioPlayerProgress className="flex-1" />
        <AudioPlayerDuration />
        <AudioPlayerSpeed />
      </div>
    </AudioPlayerProvider>
  );
}
