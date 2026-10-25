import React, { useRef, useState } from 'react';

/**
 * 21st.dev-inspired Mouse-Tracking Radial Spotlight Surface + Traveling Border Beam.
 * Automatically adapts to Matinée Light Mode and Nocturne Dark Mode.
 */
interface SpotlightSurfaceProps {
  children: React.ReactNode;
  className?: string;
  spotlightColor?: string;
  withBorderBeam?: boolean;
}

export const SpotlightSurface: React.FC<SpotlightSurfaceProps> = ({
  children,
  className = '',
  spotlightColor,
  withBorderBeam = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 240, y: 120 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const activeSpotlight = spotlightColor || 'var(--spotlight-tint)';

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative overflow-hidden animate-folio-enter ${className}`}
    >
      {/* Optional 21st.dev Traveling Border Beam */}
      {withBorderBeam && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] p-[1.5px] overflow-hidden"
        >
          <div
            className="absolute -inset-[100%] border-beam-glow opacity-65"
            style={{
              background:
                'conic-gradient(from 0deg at 50% 50%, transparent 0deg, transparent 270deg, var(--accent-gold) 320deg, var(--accent-crimson) 360deg)',
            }}
          />
          <div
            className="absolute inset-[1.5px] rounded-[inherit]"
            style={{ backgroundColor: 'var(--bg-surface)' }}
          />
        </div>
      )}

      {/* Mouse-Following Radial Spotlight Overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: isHovered ? 1 : 0.25,
          background: `radial-gradient(580px circle at ${mousePos.x}px ${mousePos.y}px, ${activeSpotlight}, transparent 45%)`,
        }}
      />

      <div className="relative z-10">{children}</div>
    </div>
  );
};

/**
 * 21st.dev-inspired Staggered Word Blur-to-Crisp Editorial Reveal.
 */
interface BlurTextRevealProps {
  text: string;
  className?: string;
  delayOffset?: number;
}

export const BlurTextReveal: React.FC<BlurTextRevealProps> = ({
  text,
  className = '',
  delayOffset = 0,
}) => {
  const words = text.split(' ');
  return (
    <span className={`inline-block ${className}`}>
      {words.map((word, idx) => (
        <span
          key={`${word}-${idx}`}
          style={{
            animationDelay: `${delayOffset + idx * 0.045}s`,
          }}
          className="animate-blur-word mr-[0.26em]"
        >
          {word}
        </span>
      ))}
    </span>
  );
};

/**
 * 21st.dev-inspired Magnetic Interactive Button with Spring Physics.
 */
interface MagneticButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  title?: string;
}

export const MagneticButton: React.FC<MagneticButtonProps> = ({
  children,
  onClick,
  disabled = false,
  className = '',
  type = 'button',
  title,
}) => {
  const ref = useRef<HTMLButtonElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Mouse only: a touch tap also fires a synthetic mousemove, which would leave the button nudged off-grid until the next tap elsewhere.
  const handleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!ref.current || disabled || e.pointerType !== 'mouse') return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    setOffset({
      x: (e.clientX - centerX) * 0.14,
      y: (e.clientY - centerY) * 0.18,
    });
  };

  return (
    <button
      ref={ref}
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      onPointerMove={handleMove}
      onPointerLeave={() => setOffset({ x: 0, y: 0 })}
      style={{
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
        transition:
          'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease',
      }}
      className={className}
    >
      {children}
    </button>
  );
};

/**
 * 21st.dev-inspired Kinetic Architectural Telemetry Ribbon.
 */
interface KineticTelemetryRibbonProps {
  items: { label: string; value: string; accent?: string }[];
}

export const KineticTelemetryRibbon: React.FC<KineticTelemetryRibbonProps> = ({ items }) => {
  const doubled = [...items, ...items];
  return (
    <div
      className="sv-ribbon w-full border-b overflow-hidden py-1.5 select-none transition-colors"
      style={{
        backgroundColor: 'var(--bg-subtle)',
        borderColor: 'var(--border-hairline)',
      }}
    >
      <div
        className="animate-sottovoce-marquee items-center gap-8 text-[11px] font-mono tracking-wider"
        style={{ color: 'var(--text-secondary)' }}
      >
        {doubled.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2.5 shrink-0 px-4">
            <span className="uppercase" style={{ color: 'var(--text-muted)' }}>
              {item.label}
            </span>
            <span className={`font-medium ${item.accent || ''}`}>{item.value}</span>
            <span className="ml-3 opacity-50" style={{ color: 'var(--accent-crimson)' }}>
              /
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
