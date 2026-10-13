/* ============================================================
   demo.js — 内置示范曲生成器
   纯程序合成（正弦 + 包络 + 混响尾），无版权风险、无需联网
   用于首次打开时填充曲库，保证完整流程可走通
   ============================================================ */
const Demo = (() => {

  // 简易混响（指数衰减噪声脉冲响应）
  function makeIR(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /**
   * 合成一首曲子
   * spec: { bpm, bars, chords:[[freq,...]], lead: fn(bar,beat)->freq|null, wave, name }
   */
  async function render(spec) {
    const sr = 44100;
    const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, sr * 60, sr);

    const bpm = spec.bpm || 76;
    const beat = 60 / bpm;
    const bars = spec.bars || 8;
    const total = bars * 4 * beat;

    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.gain.linearRampToValueAtTime(0.9, 0.05);
    master.gain.setValueAtTime(0.9, total - 0.9);
    master.gain.linearRampToValueAtTime(0.0001, total);
    master.connect(ctx.destination);

    // 混响
    const conv = ctx.createConvolver();
    conv.buffer = makeIR(ctx, 2.6, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    conv.connect(wet); wet.connect(master);

    const dry = ctx.createGain();
    dry.gain.value = 0.75;
    dry.connect(master);

    // 简易滤波（用低通铺底）
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = spec.filter || 2600;
    filt.Q.value = 0.6;
    filt.connect(dry); filt.connect(conv);

    const partials = spec.partials || [
      { mul: 1, gain: 1.0, type: 'sine' },
      { mul: 2, gain: 0.28, type: 'sine' },
      { mul: 3, gain: 0.10, type: 'sine' }
    ];

    function voice(freq, t0, dur, gainScale, type) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const atk = 0.012, rel = Math.min(0.6, dur * 0.42);
      g.gain.linearRampToValueAtTime(gainScale, t0 + atk);
      g.gain.setValueAtTime(gainScale, t0 + dur - rel);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);

      const p = partials.map(pp => {
        const o = ctx.createOscillator();
        o.type = type || pp.type;
        o.frequency.value = freq * pp.mul;
        const og = ctx.createGain();
        og.gain.value = pp.gain;
        o.connect(og); og.connect(g);
        o.start(t0); o.stop(t0 + dur + 0.02);
        return o;
      });

      // 轻微 detune 增加宽度
      if (spec.width) {
        const o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = freq * 1.004;
        const g2 = ctx.createGain(); g2.gain.value = 0.3 * gainScale;
        o2.connect(g2); g2.connect(g);
        o2.start(t0); o2.stop(t0 + dur + 0.02);
      }
      g.connect(filt);
      return g;
    }

    // 铺底和弦
    (spec.chords || []).forEach((chord, ci) => {
      const t0 = ci * 4 * beat;
      chord.forEach((f, i) => {
        voice(f, t0, 4 * beat * 0.98, (spec.padGain || 0.16) * (i === 0 ? 1 : 0.82));
      });
    });

    // 主旋律
    if (spec.lead) {
      for (let bar = 0; bar < bars; bar++) {
        for (let b = 0; b < 4; b++) {
          const f = spec.lead(bar, b);
          if (!f) continue;
          const t0 = (bar * 4 + b) * beat;
          voice(f, t0, beat * (spec.legato || 0.9), spec.leadGain || 0.2, spec.leadWave || 'triangle');
        }
      }
    }

    // 低音
    (spec.bass || []).forEach((f, i) => {
      if (!f) return;
      const t0 = i * 2 * beat;
      voice(f, t0, 2 * beat * 0.9, spec.bassGain || 0.26, 'sine');
    });

    const buf = await ctx.startRendering();
    return encodeWAV(buf);
  }

  function encodeWAV(buf) {
    const numCh = buf.numberOfChannels;
    const sr = buf.sampleRate;
    const len = buf.length;
    const bytes = 44 + len * numCh * 2;
    const ab = new ArrayBuffer(bytes);
    const dv = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };

    ws(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); ws(8, 'WAVE');
    ws(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, numCh, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * numCh * 2, true);
    dv.setUint16(32, numCh * 2, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, len * numCh * 2, true);

    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, chans[c][i]));
        dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  /* ---------- 曲目谱面 ---------- */

  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

  const TRACKS = [
    {
      key: 'aurora',
      title: '极光之海',
      artist: 'Aurora 合成乐团',
      bpm: 72, bars: 8, filter: 2400, padGain: 0.17, leadGain: 0.19, bassGain: 0.24,
      chords: [
        [NOTE(50), NOTE(57), NOTE(62)],  // Dm
        [NOTE(50), NOTE(57), NOTE(62)],
        [NOTE(53), NOTE(60), NOTE(65)],  // F
        [NOTE(53), NOTE(60), NOTE(65)],
        [NOTE(48), NOTE(55), NOTE(60)],  // C
        [NOTE(48), NOTE(55), NOTE(60)],
        [NOTE(55), NOTE(62), NOTE(67)],  // G
        [NOTE(50), NOTE(57), NOTE(62)]
      ],
      lead: (bar, b) => {
        const seq = [[74, 76, 77, 76], [74, 76, 74, 72], [72, 74, 77, 74], [72, 69, 72, 74],
                     [72, 74, 76, 79], [74, 72, 69, 72], [71, 74, 77, 81], [74, 76, 74, 69]];
        const n = seq[bar % 8][b];
        return b === 3 && bar % 2 === 1 ? null : NOTE(n);
      },
      bass: [NOTE(38), 0, NOTE(38), 0, NOTE(41), 0, NOTE(36), 0, NOTE(36), 0, NOTE(43), 0, NOTE(38), 0, NOTE(38), 0]
    },
    {
      key: 'rainy',
      title: '雨后街角',
      artist: 'Lo-fi 合成器',
      bpm: 84, bars: 8, filter: 1750, padGain: 0.14, leadGain: 0.16, legato: 0.6,
      partials: [{ mul: 1, gain: 1, type: 'triangle' }, { mul: 2, gain: 0.16, type: 'sine' }],
      chords: [
        [NOTE(45), NOTE(52), NOTE(57)],  // Am
        [NOTE(41), NOTE(48), NOTE(53)],  // F
        [NOTE(43), NOTE(50), NOTE(55)],  // G
        [NOTE(45), NOTE(52), NOTE(57)],
        [NOTE(41), NOTE(48), NOTE(53)],
        [NOTE(43), NOTE(50), NOTE(55)],
        [NOTE(45), NOTE(52), NOTE(57)],
        [NOTE(48), NOTE(55), NOTE(60)]
      ],
      lead: (bar, b) => {
        const seq = [[69, null, 72, 71], [69, null, 67, null], [67, null, 71, 74], [72, null, 71, null],
                     [69, null, 65, 67], [65, null, 64, null], [69, null, 72, 74], [76, null, 74, null]];
        const n = seq[bar % 8][b];
        return n == null ? null : NOTE(n);
      },
      bass: [NOTE(33), 0, 0, 0, NOTE(29), 0, 0, 0, NOTE(31), 0, 0, 0, NOTE(28), 0, 0, 0]
    },
    {
      key: 'solar',
      title: '午后阳光',
      artist: 'Marimba Lab',
      bpm: 96, bars: 8, filter: 4200, width: true,
      partials: [{ mul: 1, gain: 1, type: 'sine' }, { mul: 4, gain: 0.30, type: 'sine' }, { mul: 2, gain: 0.12, type: 'sine' }],
      padGain: 0.11, leadGain: 0.24, bassGain: 0.2,
      chords: [
        [NOTE(52), NOTE(59), NOTE(64)],
        [NOTE(52), NOTE(59), NOTE(64)],
        [NOTE(54), NOTE(61), NOTE(66)],
        [NOTE(54), NOTE(61), NOTE(66)],
        [NOTE(49), NOTE(56), NOTE(61)],
        [NOTE(49), NOTE(56), NOTE(61)],
        [NOTE(51), NOTE(58), NOTE(63)],
        [NOTE(56), NOTE(63), NOTE(68)]
      ],
      lead: (bar, b) => {
        const seq = [[76, 79, 81, 79], [76, 74, 76, 72], [78, 81, 85, 81], [78, 76, 74, 72],
                     [74, 76, 79, 83], [81, 79, 76, 74], [79, 76, 74, 72], [80, 83, 86, 88]];
        return NOTE(seq[bar % 8][b]);
      },
      bass: [NOTE(40), 0, NOTE(40), 0, NOTE(42), 0, 0, 0, NOTE(37), 0, 0, 0, NOTE(39), 0, 0, 0]
    }
  ];

  /** 逐条生成，入库 */
  async function seed(onProgress) {
    for (let i = 0; i < TRACKS.length; i++) {
      const spec = TRACKS[i];
      const wav = await render(spec);
      const peaks = await peaksFromBlob(wav, 96);
      const blob = await Cover.generate(peaks, spec.key, spec.title, spec.artist);
      const id = 'demo-' + spec.key;
      const dur = await durationOf(wav);
      await DB.putAudio(id, wav);
      await DB.putCover(id, blob);
      await DB.addTrack({
        id,
        title: spec.title,
        artist: spec.artist,
        kind: 'demo',
        mime: 'audio/wav',
        ext: 'wav',
        duration: dur,
        size: wav.size,
        createdAt: Date.now() + i,
        peaks,
        license: '程序合成 · 无版权',
        licenseShort: '原创',
        source: '内置示范曲'
      });
      if (onProgress) onProgress(i + 1, TRACKS.length, spec.title);
    }
    return TRACKS.length;
  }

  function durationOf(blob) {
    return new Promise(res => {
      const a = new Audio();
      a.onloadedmetadata = () => { res(a.duration || 0); a.src = ''; };
      a.onerror = () => res(0);
      a.src = URL.createObjectURL(blob);
    });
  }

  async function peaksFromBlob(blob, n) {
    try {
      const ab = await blob.arrayBuffer();
      const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
      const buf = await ctx.decodeAudioData(ab);
      const d = buf.getChannelData(0);
      const out = [];
      const step = Math.floor(d.length / n) || 1;
      for (let i = 0; i < n; i++) {
        let mx = 0;
        const s = i * step;
        for (let j = 0; j < step && s + j < d.length; j += 12) {
          const v = Math.abs(d[s + j]);
          if (v > mx) mx = v;
        }
        out.push(mx);
      }
      const max = Math.max(0.01, ...out);
      return out.map(v => Math.min(1, v / max));
    } catch { return []; }
  }

  return { seed, peaksFromBlob, durationOf, TRACKS };
})();