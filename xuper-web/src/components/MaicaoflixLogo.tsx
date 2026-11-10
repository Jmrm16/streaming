import React from 'react';

interface MaicaoflixLogoProps {
  className?: string;
  width?: number | string;
  height?: number | string;
}

export const MaicaoflixLogo: React.FC<MaicaoflixLogoProps> = ({
  className = '',
  width = 150,
  height = 32,
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 250 42"
      width={width}
      height={height}
      className={`shrink-0 select-none ${className}`}
      aria-label="MAICAOFLIX"
      role="img"
    >
      <defs>
        <linearGradient id="mcf-red" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#e50914" />
          <stop offset="100%" stopColor="#b80710" />
        </linearGradient>
      </defs>
      <text
        x="2"
        y="32"
        fill="url(#mcf-red)"
        fontFamily="'Arial Black', 'Impact', 'Netflix Sans', sans-serif"
        fontWeight="900"
        fontSize="31"
        letterSpacing="-1.3px"
        style={{
          filter: 'drop-shadow(0 2px 8px rgba(229, 9, 20, 0.45))',
        }}
      >
        MAICAO<tspan fill="#ffffff">FLIX</tspan>
      </text>
    </svg>
  );
};

export default MaicaoflixLogo;
