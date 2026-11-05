---
name: export-video
description: Export high-quality video in the browser through one MediaBunny pipeline, covering canvas, ImageData, or raw RGBA frames to MP4 (H.264 via WebCodecs) or ProRes .mov (via prores-wasm-encoder), including transparency, audio, long exports streamed to disk, and Web Workers. Use when adding video export to a web app or creative coding sketch, recording canvas/WebGL/WebGPU/2D animations, replacing MediaRecorder capture, or when the user asks for .mp4/.mov export, transparent video, or “save this animation as a video”.
---

# Export video

Export video from anything that renders frames in the browser, creative coding sketches first. Every export goes through [MediaBunny](https://mediabunny.dev): one pipeline and one render loop. MP4 and MOV differ only in their settings.

## Export frame by frame, never in real time

Don't record the screen, `MediaRecorder`, or a live `requestAnimationFrame` loop. Real-time capture drops frames, drifts in duration, and differs between runs. Step a fixed timestep instead: draw frame `n` at time `n / fps`, hand it to the encoder, await, repeat. The export takes as long as it takes. The video is always exactly `totalFrames / fps` seconds with every frame present.

## Install

```sh
npm install mediabunny@^1.61 prores-wasm-encoder@^1.0.3
```

Skip `prores-wasm-encoder` if the project never exports `.mov`. Upgrade older installs rather than adapting the code.

## The pipeline

```js
import { Output, Mp4OutputFormat, MovOutputFormat, BufferTarget, CanvasSource, Quality } from 'mediabunny';
import { registerProResEncoder } from 'prores-wasm-encoder/mediabunny';

registerProResEncoder(); // once per page; enables codec 'prores'

// Safari 27.0–27.0.1 hangs on H.264 unless latencyMode is 'realtime'. Other browsers must keep the default.
const isWebKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent);

const FORMATS = {
  mp4: {
    format: () => new Mp4OutputFormat(),
    video: { codec: 'avc', quality: new Quality({ bitrate: 12e6 }), ...(isWebKit && { latencyMode: 'realtime' }) },
    mime: 'video/mp4',
  },
  mov: {
    format: () => new MovOutputFormat(),
    video: { codec: 'prores', fullCodecString: 'apch', quality: new Quality({ bitrate: 220e6 }) },
    mime: 'video/quicktime',
  },
};

async function exportVideo(canvas, drawFrame, { type = 'mp4', fps = 30, totalFrames }) {
  const { format, video, mime } = FORMATS[type];
  const output = new Output({ format: format(), target: new BufferTarget() });
  const source = new CanvasSource(canvas, video);
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  for (let frame = 0; frame < totalFrames; frame++) {
    await drawFrame(frame / fps);           // fixed timestep, never performance.now()
    await source.add(frame / fps, 1 / fps); // timestamp, duration in seconds
  }

  await output.finalize();
  downloadBlob(output.target.buffer, mime, `export.${type}`);
}

function downloadBlob(data, type, filename) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
```

Use only the options shown here or in MediaBunny's and prores-wasm-encoder's type declarations. Don't invent options from memory. Ask the user for the choices below (format, bitrate, profile, frame rate). If you can't ask, use the defaults and say which ones you picked.

## MP4 settings (H.264)

For sharing and posting, with or without audio.

- **Always set an explicit bitrate** with `new Quality({ bitrate })`. Don't use the qualitative levels (`new Quality('high')`, `QUALITY_HIGH`): they're far slower and make much bigger files. Rule of thumb: `width × height × fps × 0.1–0.2` bits/s, low end for flat colors and gentle motion, high end for noisy or fast content.

  | Resolution | Bitrate |
  | --- | --- |
  | 1280×720 @ 30 | 6–10 Mbps |
  | 1920×1080 @ 30 | 10–16 Mbps |
  | 1920×1080 @ 60 | 16–25 Mbps |
  | 3840×2160 @ 30 | 35–50 Mbps |

- **Keep the Safari guard**, and only on WebKit: `realtime` slows Chrome down and throws in Firefox. Leave `hardwareAcceleration` and `fullCodecString` at their defaults.
- **Width and height must be even.** Round odd canvas sizes.
- To check support for a size first: `await canEncodeVideo('avc', { width, height, quality })`. If it returns false, lower the resolution or tell the user.
- Other codecs: `'hevc'`, `'vp9'` or `'av1'` (with `WebMOutputFormat` for WebM). Check what the browser can encode with `getFirstEncodableVideoCodec`.

## MOV settings (ProRes)

For editing, compositing and mastering, and the only way to get alpha. Files are big: HQ at 1080p30 is about 1.5 GB per minute, so warn the user and stream long exports to disk (below).

The profile is the `fullCodecString` fourcc (default HQ):

| Profile | Fourcc | `quality` bitrate | Use |
| --- | --- | --- | --- |
| Proxy | `apco` | 45e6 | editing proxies |
| LT | `apcs` | 102e6 | smaller files |
| Standard | `apcn` | 147e6 | |
| HQ | `apch` | 220e6 | default |
| 4444 | `ap4h` | 330e6 | transparency |
| 4444 XQ | `ap4x` | 500e6 | only when asked for maximum quality |

- **Always set `fullCodecString`.** Without it, MediaBunny guesses the profile from the bitrate and can silently pick a lower one.
- **`quality` is required by MediaBunny but has no effect** once the fourcc is set. Use the profile's bitrate from the table.
- **Transparency:** `fullCodecString: 'ap4h'`, add `alpha: 'keep'`, and clear the canvas to transparent every frame (`ctx.clearRect`, or a WebGL context with `alpha: true` and a transparent clear color). MP4/H.264 can't carry alpha.
- Encoding runs in a pool of Web Workers, so the page stays responsive. No COOP/COEP headers are needed; a CSP must allow `worker-src blob:`.

## Capture rules

- `CanvasSource` takes an `HTMLCanvasElement` or `OffscreenCanvas` (2D, WebGL, WebGL2 or WebGPU). It captures at `add()` time, so draw and `add()` in the same task. Otherwise WebGL without `preserveDrawingBuffer` and WebGPU give blank frames.
- **Always `await source.add()`.** That's the backpressure. Never buffer rendered frames in an array.
- The video size is the canvas backing store (`canvas.width`/`height`), not the CSS size. Set it to the export resolution while exporting.
- Use one `fps` for the draw time, the `add()` timestamps and `frameRate`. For 23.976/29.97 use exact fractions (`24000 / 1001`, `30000 / 1001`).
- The whole pipeline runs unchanged in a Web Worker with an `OffscreenCanvas`.

## Long exports

`BufferTarget` holds the whole file in memory; fine up to a few hundred MB. Past that, or for any ProRes export longer than a few seconds, write to disk instead:

```js
import { StreamTarget } from 'mediabunny';

// Chromium: the user picks the file (call this first in the click handler; it needs a user gesture).
// Elsewhere: a private OPFS file, handed to the user when done.
const picker = 'showSaveFilePicker' in window;
const handle = picker
  ? await window.showSaveFilePicker({ suggestedName: `export.${type}` })
  : await (await navigator.storage.getDirectory()).getFileHandle(`export.${type}`, { create: true });
const target = new StreamTarget(await handle.createWritable(), { chunked: true });

// ...use `target` instead of new BufferTarget(), run the loop, finalize, then:
if (!picker) downloadBlob(await handle.getFile(), mime, `export.${type}`);
```

Memory stays flat regardless of length.

## Other frame sources

For `ImageData` or raw RGBA bytes, use `VideoSampleSource` with the same `video` settings, and wrap each frame:

```js
import { VideoSampleSource, VideoSample } from 'mediabunny';

const source = new VideoSampleSource(video);
// ...addVideoTrack, start, then per frame:
const sample = new VideoSample(rgba, { // Uint8Array/Uint8ClampedArray (e.g. imageData.data)
  format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: frame / fps, duration: 1 / fps,
});
await source.add(sample);
sample.close();
```

## Audio

Add a track with `AudioBufferSource` (`{ codec: 'aac', bitrate: 128e3 }`) or `MediaStreamAudioTrackSource`. Interleave the data: one second of audio, then that second's frames. Follow [MediaBunny's media sources guide](https://mediabunny.dev/guide/media-sources) rather than improvising the API.

## Animation libraries

Pause the library's clock and seek it to `frame / fps` before each draw. Restart playback after the export.

- **GSAP:** `timeline.pause()`, then `timeline.seek(t)`.
- **Theatre.js:** `sheet.sequence.pause()`, then `sheet.sequence.position = t % length`. `sheetObject.value` updates synchronously.
- **Web Animations / CSS:** `animation.pause()`, then `animation.currentTime = t * 1000`.
- **p5.js:** `noLoop()`, then set your time variable and `await p.redraw()`.

## Vite

If the export code is imported lazily, Vite's dev server re-bundles on the first export and reloads the page mid-export. Pre-bundle at startup:

```js
// vite.config.js
export default {
  optimizeDeps: { include: ['mediabunny', 'prores-wasm-encoder/mediabunny'] },
};
```

## Checklist

- [ ] Frame-by-frame loop with a fixed timestep; no `MediaRecorder`, no wall-clock time.
- [ ] `await source.add()` every frame, drawn in the same task.
- [ ] MP4: explicit bitrate, even dimensions, Safari guard on WebKit only.
- [ ] MOV: `fullCodecString` set; `ap4h` + `alpha: 'keep'` for transparency.
- [ ] Canvas backing store at the export resolution.
- [ ] `StreamTarget` for long exports.
- [ ] No ffmpeg.wasm, other encoders, or hand-rolled `VideoEncoder` + muxer: this pipeline covers them.
- [ ] Verify the file, not only the UI. `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=codec_name,width,height,nb_read_frames export.mov` reports the expected frame count and size.
