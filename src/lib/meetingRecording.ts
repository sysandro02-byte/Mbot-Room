type RecordingSource = {
  stream: MediaStream | null;
  label: string;
};

export type CompositeRecordingSession = {
  stream: MediaStream;
  stop: () => Promise<void>;
};

const createVideoElement = async (stream: MediaStream) => {
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  return video;
};

const drawLabel = (ctx: CanvasRenderingContext2D, label: string, x: number, y: number, width: number, height: number) => {
  ctx.font = '600 22px system-ui, sans-serif';
  const padding = 10;
  const metrics = ctx.measureText(label);
  const boxWidth = Math.min(width - 16, metrics.width + padding * 2);
  ctx.fillStyle = 'rgba(0,0,0,.58)';
  ctx.fillRect(x + 8, y + height - 46, boxWidth, 34);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, x + 8 + padding, y + height - 22);
};

export async function createCompositeMeetingRecording(sources: RecordingSource[]): Promise<CompositeRecordingSession> {
  const active = sources.filter((source) => source.stream?.getTracks().some((track) => track.readyState === 'live'));
  if (!active.length) throw new Error('Aucun flux média disponible pour l’enregistrement.');

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Composition vidéo indisponible.');

  const videoEntries = await Promise.all(active.map(async (source) => ({
    ...source,
    video: source.stream?.getVideoTracks().some((track) => track.readyState === 'live')
      ? await createVideoElement(source.stream!)
      : null,
  })));

  let animationFrame = 0;
  let stopped = false;
  const render = () => {
    if (stopped) return;
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const count = Math.max(1, videoEntries.length);
    const columns = count === 1 ? 1 : count <= 4 ? 2 : 3;
    const rows = Math.ceil(count / columns);
    const cellWidth = canvas.width / columns;
    const cellHeight = canvas.height / rows;

    videoEntries.forEach((entry, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = col * cellWidth;
      const y = row * cellHeight;
      const video = entry.video;
      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        const scale = Math.max(cellWidth / video.videoWidth, cellHeight / video.videoHeight);
        const width = video.videoWidth * scale;
        const height = video.videoHeight * scale;
        const dx = x + (cellWidth - width) / 2;
        const dy = y + (cellHeight - height) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellWidth, cellHeight);
        ctx.clip();
        ctx.drawImage(video, dx, dy, width, height);
        ctx.restore();
      } else {
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(x, y, cellWidth, cellHeight);
        ctx.fillStyle = '#e5e7eb';
        ctx.font = '700 44px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(entry.label.slice(0, 2).toUpperCase(), x + cellWidth / 2, y + cellHeight / 2);
        ctx.textAlign = 'start';
      }
      drawLabel(ctx, entry.label, x, y, cellWidth, cellHeight);
    });
    animationFrame = requestAnimationFrame(render);
  };
  render();

  const canvasStream = canvas.captureStream(24);
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  const audioNodes: MediaStreamAudioSourceNode[] = [];
  for (const source of active) {
    if (!source.stream?.getAudioTracks().some((track) => track.readyState === 'live')) continue;
    try {
      const node = audioContext.createMediaStreamSource(source.stream);
      node.connect(destination);
      audioNodes.push(node);
    } catch {
      // One invalid/ended source should not cancel the full recording.
    }
  }

  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);

  return {
    stream: combined,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(animationFrame);
      videoEntries.forEach((entry) => {
        entry.video?.pause();
        if (entry.video) entry.video.srcObject = null;
      });
      audioNodes.forEach((node) => node.disconnect());
      canvasStream.getTracks().forEach((track) => track.stop());
      combined.getTracks().forEach((track) => track.stop());
      await audioContext.close().catch(() => undefined);
    },
  };
}
