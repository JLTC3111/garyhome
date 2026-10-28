"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Film, LoaderCircle, Maximize, Minimize, Pause, Play, RefreshCw, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { useSite } from "./site-context";
import { HELP_BUCKET, type HelpFile } from "@/lib/portal-help";
import { request } from "@/lib/requests";

export function videoTime(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PortalManual({ file }: { file: HelpFile }) {
  const { client, user, sessionPhase, t } = useSite(), userId = user?.id;
  const [source, setSource] = useState<{ url: string; revision: number } | null>(null);
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
  const alive = useRef(true), generation = useRef(0), opened = useRef(false), titleId = useId();
  const read = useCallback(async () => {
    if (!client || !userId) return;
    const current = ++generation.current;
    setLoading(true); setFailed(false);
    try {
      // A ready session already exists. Signing must not invoke accountTask and
      // send the help page back through session restoration on every render.
      const result = await request(async signal => {
        const { data, error } = await client.storage.from(HELP_BUCKET).createSignedUrl(file.storage_path, 900);
        signal.throwIfAborted();
        if (error || !data?.signedUrl) throw new Error("manual_access");
        return data.signedUrl;
      });
      if (alive.current && current === generation.current) setSource({ url: result, revision: current });
    } catch { if (alive.current && current === generation.current) setFailed(true); }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  }, [client, file.storage_path, userId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (sessionPhase !== "ready" || opened.current) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { opened.current = true; void read(); } });
    return () => { cancelled = true; };
  }, [read, sessionPhase]);

  return <section className="portal-manual" aria-labelledby={titleId}>
    <header className="portal-manual-heading"><div><span className="portal-manual-eyebrow"><Film size={16}/>{t("THE WEBSITE WALKTHROUGH", "VIDEO HƯỚNG DẪN SỬ DỤNG")}</span><h2 id={titleId}>{t("Watch. Explore. Make yourself at home.", "Xem hướng dẫn. Khám phá. Tự tin sử dụng.")}</h2><p>{t("A full tour of Gary Home, ready whenever you need a little guidance.", "Khám phá toàn bộ Gary Home qua video, xem lại bất cứ khi nào bạn cần.")}</p></div><span className="portal-manual-badge"><Play size={14}/>{t("Video guide", "Hướng dẫn bằng video")}</span></header>
    {source ? <PortalVideoPlayer src={source.url} revision={source.revision} title={t("Gary Home website manual", "Video hướng dẫn sử dụng Gary Home")} refreshing={loading} accessFailed={failed} refresh={() => void read()}/> : <div className="manual-video-placeholder" role="status"><Film size={44} strokeWidth={1.3}/><strong>{loading ? t("Preparing your video…", "Đang chuẩn bị video…") : t("The video could not be opened.", "Chưa mở được video.")}</strong>{loading ? <LoaderCircle size={22} className="spin"/> : <button className="button button-outline" type="button" onClick={() => void read()}><RefreshCw size={16}/>{t("Try again", "Thử lại")}</button>}</div>}
    <footer className="portal-manual-caption"><span>{t("Pause, rewind or change speed to follow at your own pace.", "Tạm dừng, tua lại hoặc đổi tốc độ để xem theo nhịp của bạn.")}</span><small>{t("Original-language video · Bilingual written guides below", "Video giữ nguyên ngôn ngữ gốc · Hướng dẫn chữ song ngữ ở bên dưới")}</small></footer>
  </section>;
}

type SafariVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

export function PortalVideoPlayer({ src, revision, title, refreshing, accessFailed, refresh }: {
  src: string; revision: number; title: string; refreshing: boolean; accessFailed: boolean; refresh: () => void;
}) {
  const { t } = useSite(), video = useRef<HTMLVideoElement>(null), frame = useRef<HTMLDivElement>(null), hint = useId();
  const [playing, setPlaying] = useState(false), [position, setPosition] = useState(0), [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false), [volume, setVolume] = useState(1), [speed, setSpeed] = useState(1);
  const [buffering, setBuffering] = useState(false), [fullscreen, setFullscreen] = useState(false), [error, setError] = useState<"" | "media" | "play" | "fullscreen">("");
  const resume = useRef(0), attempt = useRef(0), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", update);
    return () => { document.removeEventListener("fullscreenchange", update); };
  }, []);
  const disabled = refreshing || error === "media";
  async function togglePlay() {
    const node = video.current; if (!node || disabled) return;
    const current = ++attempt.current;
    if (!node.paused && !node.ended) { node.pause(); return; }
    setError("");
    try { await node.play(); }
    catch { if (active.current && current === attempt.current && node === video.current) { setError("play"); setPlaying(false); setBuffering(false); } }
  }
  function seek(value: number) {
    const node = video.current; if (!node || !duration || disabled || !Number.isFinite(value)) return;
    const next = Math.min(duration, Math.max(0, value)); node.currentTime = next; resume.current = next; setPosition(next);
  }
  function toggleMute() { const node = video.current; if (node) { if (node.muted || !node.volume) { if (!node.volume) { node.volume = 1; setVolume(1); } node.muted = false; } else node.muted = true; setMuted(node.muted); } }
  function changeVolume(value: number) { const node = video.current; if (node) { node.volume = value; node.muted = value === 0; setVolume(value); setMuted(node.muted); } }
  function changeSpeed() { const rates = [0.75, 1, 1.25, 1.5, 2], next = rates[(rates.indexOf(speed) + 1) % rates.length]; if (video.current) video.current.playbackRate = next; setSpeed(next); }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === frame.current) await document.exitFullscreen();
      else if (frame.current?.requestFullscreen) await frame.current.requestFullscreen();
      else if ((video.current as SafariVideo | null)?.webkitEnterFullscreen) (video.current as SafariVideo).webkitEnterFullscreen?.();
      else setError("fullscreen");
    } catch { if (active.current) setError("fullscreen"); }
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest?.("input,button,a,select,textarea")) return;
    const key = event.key.toLowerCase();
    if ([" ", "k", "arrowleft", "arrowright", "m", "f"].includes(key)) event.preventDefault(); else return;
    if (key === " " || key === "k") void togglePlay();
    else if (key === "arrowleft") seek((video.current?.currentTime || 0) - 10);
    else if (key === "arrowright") seek((video.current?.currentTime || 0) + 10);
    else if (key === "m") toggleMute(); else void toggleFullscreen();
  }
  function refreshAccess() { resume.current = video.current?.currentTime || position; attempt.current++; video.current?.pause(); refresh(); }
  const progress = duration ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  return <div className="manual-video-player" ref={frame} role="region" aria-label={title} aria-describedby={hint} tabIndex={0} onKeyDown={keys}>
    <div className="manual-video-stage">
      <video key={`${src}-${revision}`} ref={video} src={src} playsInline preload="metadata" aria-label={title} onLoadStart={event => { attempt.current++; setError(""); setPlaying(!event.currentTarget.paused); setBuffering(false); }} onLoadedMetadata={event => {
        const node = event.currentTarget, length = Number.isFinite(node.duration) ? node.duration : 0;
        setError(""); setPlaying(!node.paused && !node.ended); setBuffering(false); setDuration(length); node.currentTime = Math.min(resume.current, length); setPosition(node.currentTime); node.volume = volume; node.muted = muted; node.playbackRate = speed;
      }} onDurationChange={event => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }} onTimeUpdate={event => { resume.current = event.currentTarget.currentTime; setPosition(resume.current); }} onPlay={() => { setPlaying(true); setError(""); }} onPause={() => { setPlaying(false); setBuffering(false); }} onEnded={() => { setPlaying(false); setBuffering(false); }} onWaiting={() => setBuffering(true)} onPlaying={() => { setPlaying(true); setBuffering(false); }} onCanPlay={() => setBuffering(false)} onError={() => { setError("media"); setPlaying(false); setBuffering(false); }} onVolumeChange={event => { setMuted(event.currentTarget.muted); setVolume(event.currentTarget.volume); }} onRateChange={event => setSpeed(event.currentTarget.playbackRate)}/>
      {error !== "media" && <button type="button" className={`manual-video-overlay ${playing && !buffering && !refreshing ? "is-playing" : ""}`} aria-label={playing ? t("Pause video", "Tạm dừng video") : t("Play video", "Phát video")} disabled={refreshing} onClick={() => void togglePlay()}><span>{buffering || refreshing ? <LoaderCircle size={32} className="spin"/> : playing ? <Pause size={30} fill="currentColor"/> : <Play size={32} fill="currentColor"/>}</span>{!playing && <strong>{t("Play walkthrough", "Xem video hướng dẫn")}</strong>}</button>}
      {error === "media" && <div className="manual-video-access" role="alert"><Film size={34}/><p>{t("Video unavailable? Refresh its secure link and continue from where you paused.", "Video chưa phát được? Làm mới liên kết bảo mật rồi tiếp tục từ vị trí đã dừng.")}</p><button className="button" type="button" disabled={refreshing} onClick={refreshAccess}><RefreshCw size={16} className={refreshing ? "spin" : ""}/>{t("Reload video", "Tải lại video")}</button></div>}
    </div>
    <div className="manual-video-controls">
      <label className="manual-video-timeline"><span className="sr-only">{t("Video progress", "Tiến trình video")}</span><input type="range" min={0} max={duration || 0} step={0.1} value={Math.min(position, duration)} disabled={!duration || disabled} aria-valuetext={`${videoTime(position)} / ${videoTime(duration)}`} onChange={event => seek(Number(event.target.value))} style={{ "--video-progress": `${progress}%` } as CSSProperties}/></label>
      <div className="manual-video-control-row"><button type="button" className="manual-video-icon" aria-label={playing ? t("Pause", "Tạm dừng") : t("Play", "Phát")} disabled={disabled} onClick={() => void togglePlay()}>{playing ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor"/>}</button><button type="button" className="manual-video-icon manual-video-skip" aria-label={t("Back 10 seconds", "Lùi 10 giây")} disabled={!duration || disabled} onClick={() => seek((video.current?.currentTime || 0) - 10)}><RotateCcw size={19}/><small>10</small></button><button type="button" className="manual-video-icon manual-video-skip" aria-label={t("Forward 10 seconds", "Tới 10 giây")} disabled={!duration || disabled} onClick={() => seek((video.current?.currentTime || 0) + 10)}><RotateCw size={19}/><small>10</small></button><span className="manual-video-time">{videoTime(position)}<span> / {videoTime(duration)}</span></span><div className="manual-video-volume"><button type="button" className="manual-video-icon" aria-label={muted || !volume ? t("Unmute", "Bật tiếng") : t("Mute", "Tắt tiếng")} onClick={toggleMute}>{muted || !volume ? <VolumeX size={20}/> : <Volume2 size={20}/>}</button><label><span className="sr-only">{t("Volume", "Âm lượng")}</span><input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={event => changeVolume(Number(event.target.value))}/></label></div><button type="button" className="manual-video-speed" onClick={changeSpeed} aria-label={t(`Playback speed: ${speed}×. Change speed`, `Tốc độ phát: ${speed}×. Đổi tốc độ`)}>{speed}×</button><button type="button" className="manual-video-icon" aria-label={fullscreen ? t("Exit fullscreen", "Thoát toàn màn hình") : t("Enter fullscreen", "Xem toàn màn hình")} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={20}/> : <Maximize size={20}/>}</button></div>
    </div>
    {accessFailed && <p className="manual-video-error" role="alert">{t("Couldn’t refresh video access. Check your connection and try again.", "Chưa làm mới được quyền xem video. Kiểm tra kết nối rồi thử lại.")} <button type="button" disabled={refreshing} onClick={refreshAccess}>{t("Retry", "Thử lại")}</button></p>}
    {error === "play" && <p className="manual-video-error" role="alert">{t("Playback didn’t start. Press Play again, or reload the video.", "Video chưa bắt đầu phát. Nhấn Phát lần nữa hoặc tải lại video.")} <button type="button" disabled={refreshing} onClick={refreshAccess}>{t("Reload video", "Tải lại video")}</button></p>}
    {error === "fullscreen" && <p className="manual-video-error" role="status">{t("Fullscreen isn’t available in this browser. You can keep watching here.", "Trình duyệt chưa hỗ trợ toàn màn hình. Bạn vẫn có thể xem tại đây.")}</p>}
    <span className="sr-only" id={hint}>{t("Keyboard: Space or K to play and pause, arrows to skip ten seconds, M to mute, F for fullscreen.", "Bàn phím: Space hoặc K để phát và tạm dừng, phím mũi tên để tua mười giây, M bật hoặc tắt tiếng, F xem toàn màn hình.")}</span>
  </div>;
}
