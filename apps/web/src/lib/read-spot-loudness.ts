export type LoudnessSample = {
  loudness: number;
  samples: number[];
};

function dbfsToRelative(dbfs: number): number {
  const clamped = Math.max(-80, Math.min(-10, dbfs));
  return Math.round(((clamped + 80) / 70) * 100);
}

export async function requestMicrophonePermission(): Promise<
  "granted" | "denied" | "unsupported"
> {
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch {
    return "denied";
  }
}

export async function measureRelativeLoudness(
  seconds = 10,
  onTick?: (remainingSeconds: number, level: number) => void,
): Promise<LoudnessSample> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone not supported on this device.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    },
  });
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextConstructor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Audio measurement is not supported here.");
  }
  const context = new AudioContextConstructor();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const readings: number[] = [];
  const started = Date.now();
  try {
    while (Date.now() - started < seconds * 1_000) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
      );
      const dbfs = Math.max(
        -100,
        Math.min(0, 20 * Math.log10(Math.max(rms, 0.00001))),
      );
      const relative = dbfsToRelative(dbfs);
      readings.push(relative);
      const remaining = Math.max(
        0,
        Math.ceil(seconds - (Date.now() - started) / 1_000),
      );
      onTick?.(remaining, relative);
    }
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
  }
  const loudness = Math.round(
    readings.reduce((sum, value) => sum + value, 0) / Math.max(1, readings.length),
  );
  return { loudness, samples: readings };
}
