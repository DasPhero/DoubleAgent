import React, { useEffect, useMemo, useRef } from 'react';

export type TerminalBgTreatment = 'none' | 'minimal' | 'grid' | 'pulse' | 'watermark' | 'matrix';

interface Props {
  treatment: TerminalBgTreatment;
  animate: boolean;
  colorTheme: string;
}

/**
 * Shared HUD-art layer rendered ONCE behind the whole terminal space (not per pane).
 * Colors come from the active theme's CSS custom properties, so it re-tints automatically.
 * Each xterm pane is translucent (allowTransparency), so this art shows through.
 */
export const TerminalBackground: React.FC<Props> = ({ treatment, animate, colorTheme }) => {
  if (!treatment || treatment === 'none') {
    return null;
  }
  return (
    <div className={`terminal-bg-art tbg-${treatment}${animate ? '' : ' tbg-noanim'}`} aria-hidden="true">
      {treatment === 'minimal' && <div className="tbg-glow" />}
      {treatment === 'grid' && <div className="tbg-glow tbg-grid-layer" />}
      {treatment === 'pulse' && <PulseArt />}
      {treatment === 'watermark' && <WatermarkArt />}
      {treatment === 'matrix' && <MatrixArt colorTheme={colorTheme} animate={animate} />}
    </div>
  );
};

/* ---- Pulse: fine soundwave radiating from the center, mirrored top/bottom ---- */
const PULSE_W = 600;
const PULSE_H = 300;
const PulseArt: React.FC = () => {
  const bars = useMemo(() => {
    const n = 104;
    const cy = PULSE_H / 2;
    return Array.from({ length: n }, (_, i) => {
      const x = (i + 0.5) * (PULSE_W / n);
      const pos = i / (n - 1);
      const env = Math.pow(Math.sin(Math.PI * pos), 0.9);
      const h = Math.max(2, env * (0.4 + 0.6 * Math.random()) * 130);
      return { x: +(x - 1).toFixed(1), y: +(cy - h / 2).toFixed(1), h: +h.toFixed(1), delay: +(-i * 0.5).toFixed(2) };
    });
  }, []);
  const rings = useMemo(() => {
    const out: number[] = [];
    for (let r = 44; r <= 272; r += 26) out.push(r);
    return out;
  }, []);
  return (
    <>
      <div className="tbg-glow" />
      <svg className="tbg-eq" viewBox={`0 0 ${PULSE_W} ${PULSE_H}`} preserveAspectRatio="xMidYMid meet">
        {rings.map((r) => (
          <circle key={r} cx={300} cy={PULSE_H / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} strokeDasharray="1 9" />
        ))}
        {bars.map((b, i) => (
          <rect key={i} className="tbg-bar" x={b.x} y={b.y} width={2} height={b.h} rx={1} fill="currentColor" fillOpacity={0.55} style={{ animationDelay: `${b.delay}s` }} />
        ))}
      </svg>
    </>
  );
};

/* ---- Watermark: targeting reticle with a slowly spinning dotted inner ring ---- */
const WatermarkArt: React.FC = () => (
  <>
    <div className="tbg-glow tbg-reticle-glow" />
    <svg className="tbg-reticle" viewBox="0 0 600 460" preserveAspectRatio="xMidYMid meet">
      <g fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={2} transform="translate(300 230)">
        <circle r={150} />
        <circle r={62} />
        <path d="M0 -190 V-120 M0 120 V190 M-190 0 H-120 M120 0 H190" />
        <path d="M-110 -110 L-78 -78 M110 -110 L78 -78 M-110 110 L-78 78 M110 110 L78 78" />
        <path d="M-16 0 H16 M0 -16 V16" />
      </g>
      <g className="tbg-spin">
        <circle cx={300} cy={230} r={108} fill="none" stroke="currentColor" strokeOpacity={0.36} strokeWidth={2} strokeDasharray="3 15" />
        <circle cx={300} cy={230} r={128} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={1} strokeDasharray="2 22" />
      </g>
    </svg>
  </>
);

/* ---- Matrix: faint, very slow cipher rain on a canvas ---- */
const MatrixArt: React.FC<{ colorTheme: string; animate: boolean }> = ({ colorTheme, animate }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) {
      return;
    }
    const parent = cv.parentElement;
    const ctx = cv.getContext('2d');
    if (!ctx || !parent) {
      return;
    }
    const cs = getComputedStyle(parent);
    const accent = (cs.getPropertyValue('--accent-bright').trim() || '#2f9bff').slice(0, 7);
    const accent2 = (cs.getPropertyValue('--accent-text').trim() || '#5eead4').slice(0, 7);
    const fs = 14;
    const CH = '01=/\\<>[]{}#$%&ABCDEF0123456789abcdef';
    let cols = 0;
    let drops: number[] = [];
    let W = 0;
    let H = 0;
    const size = () => {
      W = cv.width = parent.clientWidth || 1;
      H = cv.height = parent.clientHeight || 1;
      cols = Math.floor(W / fs);
      drops = Array(cols).fill(0).map(() => (Math.random() * -H) / fs);
    };
    size();

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = 0;
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      if (ts - last < 200) {
        return;
      }
      last = ts;
      ctx.fillStyle = 'rgba(0,0,0,0.055)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = `${fs}px monospace`;
      for (let i = 0; i < cols; i++) {
        const ch = CH[Math.floor(Math.random() * CH.length)];
        ctx.fillStyle = Math.random() < 0.04 ? `${accent2}55` : `${accent}2e`;
        ctx.fillText(ch, i * fs, drops[i] * fs);
        if (drops[i] * fs > H && Math.random() > 0.975) {
          drops[i] = 0;
        } else {
          drops[i] += 1;
        }
      }
    };

    const ro = new ResizeObserver(() => size());
    ro.observe(parent);
    if (animate && !reduce) {
      raf = requestAnimationFrame(frame);
    } else {
      // static single frame so it still reads as "decrypting"
      ctx.font = `${fs}px monospace`;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < H / fs; j += 2) {
          ctx.fillStyle = `${accent}22`;
          ctx.fillText(CH[Math.floor(Math.random() * CH.length)], i * fs, j * fs);
        }
      }
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [colorTheme, animate]);
  return (
    <>
      <div className="tbg-glow tbg-matrix-glow" />
      <canvas ref={ref} className="tbg-canvas" />
    </>
  );
};
