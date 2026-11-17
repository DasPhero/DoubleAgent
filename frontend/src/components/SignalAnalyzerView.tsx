import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CyberIcon } from './CyberIcon';

export interface DecodedByte {
  byte: number;
  timeMs: number;
  channel: 'rx' | 'tx';
}

export interface PinTransition {
  pin: 'dtr' | 'rts';
  state: boolean;
  timeMs: number;
}

export interface SignalAnalyzerProps {
  sessionId: string;
  port: string;
  baudRate: number;
  dtr: boolean;
  rts: boolean;
  rxDataFeed?: string;
  txDataFeed?: string;
  onClose: () => void;
}

const MAX_PACKETS = 2000;
const CHANNEL_HEIGHT = 58;
const LABEL_WIDTH = 90;

export function SignalAnalyzerView({
  port,
  baudRate,
  dtr,
  rts,
  rxDataFeed,
  txDataFeed,
  onClose,
}: SignalAnalyzerProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Capture buffer state
  const bytesRef = useRef<DecodedByte[]>([]);
  const pinEventsRef = useRef<PinTransition[]>([]);
  const startTimeRef = useRef<number>(Date.now());

  // Interactive controls
  const [isLive, setIsLive] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1.0); // 0.2x to 5.0x
  const [scrollOffsetMs, setScrollOffsetMs] = useState<number>(0);
  const [enabledChannels, setEnabledChannels] = useState<{
    rx: boolean;
    tx: boolean;
    dtr: boolean;
    rts: boolean;
  }>({
    rx: true,
    tx: true,
    dtr: true,
    rts: true,
  });

  const [packetCount, setPacketCount] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartXRef = useRef<number>(0);
  const dragStartOffsetRef = useRef<number>(0);

  // Ingest incoming RX data feed
  useEffect(() => {
    if (!rxDataFeed) return;
    const now = Date.now() - startTimeRef.current;
    const newBytes: DecodedByte[] = [];
    const bitPeriodMs = (1000 / (baudRate || 115200)) * 10; // 10 bits per byte (8N1)
    for (let i = 0; i < rxDataFeed.length; i++) {
      newBytes.push({
        byte: rxDataFeed.charCodeAt(i),
        timeMs: now + i * bitPeriodMs,
        channel: 'rx',
      });
    }
    bytesRef.current = [...bytesRef.current, ...newBytes].slice(-MAX_PACKETS);
    setPacketCount(bytesRef.current.length);
  }, [rxDataFeed, baudRate]);

  // Ingest incoming TX data feed
  useEffect(() => {
    if (!txDataFeed) return;
    const now = Date.now() - startTimeRef.current;
    const newBytes: DecodedByte[] = [];
    const bitPeriodMs = (1000 / (baudRate || 115200)) * 10;
    for (let i = 0; i < txDataFeed.length; i++) {
      newBytes.push({
        byte: txDataFeed.charCodeAt(i),
        timeMs: now + i * bitPeriodMs,
        channel: 'tx',
      });
    }
    bytesRef.current = [...bytesRef.current, ...newBytes].slice(-MAX_PACKETS);
    setPacketCount(bytesRef.current.length);
  }, [txDataFeed, baudRate]);

  // Record DTR changes
  useEffect(() => {
    const now = Date.now() - startTimeRef.current;
    pinEventsRef.current.push({ pin: 'dtr', state: dtr, timeMs: now });
  }, [dtr]);

  // Record RTS changes
  useEffect(() => {
    const now = Date.now() - startTimeRef.current;
    pinEventsRef.current.push({ pin: 'rts', state: rts, timeMs: now });
  }, [rts]);

  // Main Canvas Rendering Loop
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Background
    ctx.fillStyle = '#090d14';
    ctx.fillRect(0, 0, width, height);

    const plotWidth = width - LABEL_WIDTH;
    const bitDurationMs = 1000 / (baudRate || 115200);
    const frameDurationMs = bitDurationMs * 10; // 8N1 frame

    // Pixels per millisecond
    const pxPerMs = (plotWidth / 200) * zoom; // default 200ms window at zoom 1.0

    const now = Date.now() - startTimeRef.current;
    const visibleDurationMs = plotWidth / pxPerMs;

    let startMs = isLive ? Math.max(0, now - visibleDurationMs) : scrollOffsetMs;
    if (isLive) {
      startMs = Math.max(0, now - visibleDurationMs);
    }
    const endMs = startMs + visibleDurationMs;

    // Draw Grid & Timing Ticks
    const tickIntervalMs = Math.pow(10, Math.floor(Math.log10(visibleDurationMs / 5))) || 10;
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
    ctx.lineWidth = 1;
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#64748b';

    const firstTick = Math.ceil(startMs / tickIntervalMs) * tickIntervalMs;
    for (let t = firstTick; t <= endMs; t += tickIntervalMs) {
      const x = LABEL_WIDTH + (t - startMs) * pxPerMs;
      ctx.beginPath();
      ctx.setLineDash([2, 4]);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(`${t.toFixed(0)}ms`, x + 3, 12);
    }

    // Active channels config
    const channels = [
      { id: 'rx', label: 'CH 0: RX', color: '#10b981', enabled: enabledChannels.rx },
      { id: 'tx', label: 'CH 1: TX', color: '#f59e0b', enabled: enabledChannels.tx },
      { id: 'dtr', label: 'CH 2: DTR', color: '#8b5cf6', enabled: enabledChannels.dtr },
      { id: 'rts', label: 'CH 3: RTS', color: 'var(--accent-bright)', enabled: enabledChannels.rts },
    ];

    let currentY = 22;

    channels.forEach((ch) => {
      if (!ch.enabled) return;

      const topY = currentY;
      const bottomY = currentY + CHANNEL_HEIGHT - 12;
      const midY = (topY + bottomY) / 2;

      // Channel divider line
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, bottomY + 8);
      ctx.lineTo(width, bottomY + 8);
      ctx.stroke();

      // Channel label badge on left
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(0, topY - 4, LABEL_WIDTH - 8, CHANNEL_HEIGHT);
      ctx.fillStyle = ch.color;
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.fillText(ch.label, 8, midY + 4);

      // Draw Channel Digital Waveform
      if (ch.id === 'rx' || ch.id === 'tx') {
        const packets = bytesRef.current.filter(
          (b) => b.channel === ch.id && b.timeMs + frameDurationMs >= startMs && b.timeMs <= endMs
        );

        // Draw idle baseline (HIGH = 1 for idle UART)
        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, topY);
        ctx.lineTo(width, topY);
        ctx.stroke();

        // Draw UART frames and packet bubbles
        packets.forEach((pkt) => {
          const frameStartMs = pkt.timeMs;
          const byteVal = pkt.byte;

          // Bits in frame: Start(0), D0..D7, Stop(1)
          const bits: number[] = [0]; // Start bit
          for (let i = 0; i < 8; i++) {
            bits.push((byteVal >> i) & 1);
          }
          bits.push(1); // Stop bit

          const frameStartX = LABEL_WIDTH + (frameStartMs - startMs) * pxPerMs;
          const frameWidth = frameDurationMs * pxPerMs;

          // Draw digital square waveform for this packet
          ctx.beginPath();
          ctx.strokeStyle = ch.color;
          ctx.lineWidth = 1.5;

          let lastLevel = 1;
          for (let bitIdx = 0; bitIdx < bits.length; bitIdx++) {
            const bitLevel = bits[bitIdx];
            const bitStartX = frameStartX + bitIdx * bitDurationMs * pxPerMs;
            const bitEndX = bitStartX + bitDurationMs * pxPerMs;
            const y = bitLevel === 1 ? topY : bottomY;

            if (bitLevel !== lastLevel) {
              ctx.lineTo(bitStartX, y);
            }
            ctx.lineTo(bitEndX, y);
            lastLevel = bitLevel;
          }
          ctx.stroke();

          // Saleae Decoded Bubble Overlay
          if (frameStartX + frameWidth > LABEL_WIDTH && frameStartX < width) {
            const bubbleX = Math.max(LABEL_WIDTH + 2, frameStartX);
            const bubbleWidth = Math.min(frameWidth - 2, 80);
            const bubbleY = topY - 14;

            // Decoded text: printable ASCII or Hex
            const isPrintable = byteVal >= 32 && byteVal <= 126;
            const charStr = isPrintable ? `'${String.fromCharCode(byteVal)}'` : 'HEX';
            const hexStr = `0x${byteVal.toString(16).toUpperCase().padStart(2, '0')}`;
            const labelStr = `${charStr} ${hexStr}`;

            ctx.fillStyle = ch.id === 'rx' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)';
            ctx.strokeStyle = ch.color;
            ctx.lineWidth = 1;

            // Hexagon/rounded bubble
            ctx.beginPath();
            ctx.roundRect(bubbleX, bubbleY, Math.max(bubbleWidth, 68), 14, 3);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#f8fafc';
            ctx.font = '9px Consolas, monospace';
            ctx.fillText(labelStr, bubbleX + 4, bubbleY + 10);
          }
        });
      } else {
        // DTR or RTS static pin status line
        const pinState = ch.id === 'dtr' ? dtr : rts;
        const pinY = pinState ? topY : bottomY;

        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, pinY);
        ctx.lineTo(width, pinY);
        ctx.stroke();

        ctx.fillStyle = ch.color;
        ctx.font = '10px Consolas, monospace';
        ctx.fillText(pinState ? 'HIGH (1)' : 'LOW (0)', LABEL_WIDTH + 6, pinY - 4);
      }

      currentY += CHANNEL_HEIGHT + 14;
    });
  }, [baudRate, dtr, rts, enabledChannels, zoom, scrollOffsetMs, isLive]);

  // Handle Resize & Animation Frame Loop
  useEffect(() => {
    let animId: number;
    const update = () => {
      renderCanvas();
      if (isLive) {
        animId = requestAnimationFrame(update);
      }
    };
    update();
    return () => cancelAnimationFrame(animId);
  }, [renderCanvas, isLive]);

  // Resize canvas when container size changes
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = Math.max(260, containerRef.current.clientHeight - 40);
        renderCanvas();
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderCanvas]);

  // Mouse pan / drag handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setIsLive(false);
    dragStartXRef.current = e.clientX;
    dragStartOffsetRef.current = scrollOffsetMs;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !canvasRef.current) return;
    const deltaX = e.clientX - dragStartXRef.current;
    const plotWidth = canvasRef.current.width - LABEL_WIDTH;
    const pxPerMs = (plotWidth / 200) * zoom;
    const deltaMs = deltaX / pxPerMs;
    setScrollOffsetMs(Math.max(0, dragStartOffsetRef.current - deltaMs));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const bitPeriodMicroSec = (1000000 / (baudRate || 115200)).toFixed(2);

  return (
    <div
      className="signal-analyzer-container"
      ref={containerRef}
      role="region"
      aria-label="Signal Analyzer"
    >
      <div className="signal-analyzer-header">
        <div className="analyzer-title-group">
          <span className="analyzer-badge"><CyberIcon name="chart" size={14} /> LOGIC ANALYZER</span>
          <span className="analyzer-port-info">
            {port} @ {baudRate} baud ({bitPeriodMicroSec} µs/bit)
          </span>
          <span className="analyzer-stats">Captured: {packetCount} pkts</span>
        </div>

        <div className="analyzer-channel-selectors">
          <label className="analyzer-ch-label ch-rx">
            <input
              type="checkbox"
              checked={enabledChannels.rx}
              onChange={(e) =>
                setEnabledChannels((prev) => ({ ...prev, rx: e.target.checked }))
              }
            />
            RX
          </label>
          <label className="analyzer-ch-label ch-tx">
            <input
              type="checkbox"
              checked={enabledChannels.tx}
              onChange={(e) =>
                setEnabledChannels((prev) => ({ ...prev, tx: e.target.checked }))
              }
            />
            TX
          </label>
          <label className="analyzer-ch-label ch-dtr">
            <input
              type="checkbox"
              checked={enabledChannels.dtr}
              onChange={(e) =>
                setEnabledChannels((prev) => ({ ...prev, dtr: e.target.checked }))
              }
            />
            DTR
          </label>
          <label className="analyzer-ch-label ch-rts">
            <input
              type="checkbox"
              checked={enabledChannels.rts}
              onChange={(e) =>
                setEnabledChannels((prev) => ({ ...prev, rts: e.target.checked }))
              }
            />
            RTS
          </label>
        </div>

        <div className="analyzer-controls">
          <button
            type="button"
            className={`analyzer-btn ${isLive ? 'active-live' : ''}`}
            onClick={() => setIsLive((prev) => !prev)}
            title={isLive ? 'Pause capture' : 'Resume live stream'}
          >
            {isLive ? <><CyberIcon name="stop" size={14} /> Pause</> : <><CyberIcon name="play" size={14} /> Live</>}
          </button>
          <button
            type="button"
            className="analyzer-btn"
            onClick={() => setZoom((prev) => Math.min(5.0, prev * 1.3))}
            title="Zoom In"
          >
            + Zoom
          </button>
          <button
            type="button"
            className="analyzer-btn"
            onClick={() => setZoom((prev) => Math.max(0.2, prev / 1.3))}
            title="Zoom Out"
          >
            - Zoom
          </button>
          <button
            type="button"
            className="analyzer-btn"
            onClick={() => {
              setZoom(1.0);
              setIsLive(true);
            }}
            title="Reset Zoom & Live View"
          >
            Reset
          </button>
          <button
            type="button"
            className="analyzer-btn"
            onClick={() => {
              bytesRef.current = [];
              setPacketCount(0);
              startTimeRef.current = Date.now();
            }}
            title="Clear capture buffer"
          >
            Clear
          </button>
          <button
            type="button"
            className="analyzer-close-btn"
            onClick={onClose}
            title="Close Signal Analyzer"
            aria-label="Close Signal Analyzer"
          >
            ×
          </button>
        </div>
      </div>

      <div className="signal-analyzer-canvas-wrap">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          title="Drag to scroll waveform timeline horizontally"
        />
      </div>
    </div>
  );
}
