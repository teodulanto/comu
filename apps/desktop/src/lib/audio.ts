export type Microphone = {
  id: string;
  label: string;
};

export type Recording = {
  audio: Float32Array;
  durationMs: number;
};

export type ActiveRecording = {
  stop: () => Promise<Recording>;
  cancel: () => void;
  getLevel: () => number;
};

export async function listMicrophones(): Promise<Microphone[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || "Micrófono " + (index + 1)
    }));
}

export async function checkMicrophone(deviceId?: string): Promise<void> {
  const recording = await startRecording(deviceId);
  await new Promise((resolve) => window.setTimeout(resolve, 220));
  await recording.stop();
}

export async function startRecording(deviceId?: string): Promise<ActiveRecording> {
  try {
    return await startBrowserRecording(deviceId);
  } catch (error) {
    if (!deviceId) {
      throw error;
    }
    return startBrowserRecording();
  }
}

async function startBrowserRecording(deviceId?: string): Promise<ActiveRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId
      ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  const levelBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
  source.connect(analyser);
  const startedAt = performance.now();

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });
  recorder.start();
  let finished = false;

  const releaseAudio = () => {
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
  };

  return {
    getLevel: () => {
      analyser.getByteTimeDomainData(levelBuffer);
      let sumSquares = 0;
      for (const sample of levelBuffer) {
        const normalized = (sample - 128) / 128;
        sumSquares += normalized * normalized;
      }
      return Math.min(1, Math.sqrt(sumSquares / levelBuffer.length) * 8);
    },
    cancel: () => {
      if (finished) {
        return;
      }
      finished = true;
      releaseAudio();
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    },
    stop: () => new Promise<Recording>((resolve, reject) => {
      if (finished) {
        reject(new Error("La grabación ya terminó."));
        return;
      }
      finished = true;
      recorder.addEventListener("stop", () => {
        releaseAudio();
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        void recordingToMono16kHz(blob)
          .then((audio) => resolve({
            audio,
            durationMs: Math.round(performance.now() - startedAt)
          }))
          .catch(reject);
      });
      recorder.addEventListener("error", () => reject(new Error("La grabación de audio falló.")));
      recorder.stop();
    })
  };
}

async function recordingToMono16kHz(blob: Blob): Promise<Float32Array> {
  const encodedAudio = await blob.arrayBuffer();
  const decoder = new AudioContext();
  const decoded = await decoder.decodeAudioData(encodedAudio);
  await decoder.close();

  const frameCount = Math.max(1, Math.ceil(decoded.duration * 16_000));
  const offline = new OfflineAudioContext(1, frameCount, 16_000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

export function hasUsableAudio(audio: Float32Array): boolean {
  if (audio.length === 0) {
    return false;
  }

  let sumSquares = 0;
  let peak = 0;
  for (const sample of audio) {
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  const rms = Math.sqrt(sumSquares / audio.length);
  return rms >= 0.002 || peak >= 0.02;
}
