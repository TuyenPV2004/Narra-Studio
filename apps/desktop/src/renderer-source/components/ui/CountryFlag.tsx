import type { HTMLAttributes } from "react";

export interface CountryFlagProps extends HTMLAttributes<HTMLSpanElement> {
  code: string;
  height?: number;
  size?: number;
  width?: number;
}

export function CountryFlag({
  code,
  size,
  width = size ? Math.round((size * 3) / 2) : 21,
  height = size ? size : 14,
  className = "",
  ...props
}: CountryFlagProps) {
  const normalized = code.toLowerCase().trim();

  return (
    <span
      className={`source-country-flag ${className}`.trim()}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        minWidth: `${width}px`,
        minHeight: `${height}px`,
      }}
      aria-hidden="true"
      {...props}
    >
      <svg
        viewBox="0 0 24 16"
        width={width}
        height={height}
        style={{
          borderRadius: "2px",
          display: "block",
          boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.12)",
        }}
      >
        <clipPath id={`flag-rect-clip-${normalized}`}>
          <rect width="24" height="16" rx="2" />
        </clipPath>
        <g clipPath={`url(#flag-rect-clip-${normalized})`}>
          {renderFlagPaths(normalized)}
        </g>
      </svg>
    </span>
  );
}

function renderFlagPaths(code: string) {
  switch (code) {
    // 1. Tiếng Anh (English - US Flag)
    case "en":
      return (
        <g>
          <rect width="24" height="16" fill="#b22234" />
          <path
            d="M0 2.46h24M0 4.92h24M0 7.38h24M0 9.85h24M0 12.31h24M0 14.77h24"
            stroke="#ffffff"
            strokeWidth="1.23"
          />
          <rect width="9.6" height="8.62" fill="#3c3b6e" />
          <circle cx="2" cy="1.8" r="0.6" fill="#ffffff" />
          <circle cx="4.8" cy="1.8" r="0.6" fill="#ffffff" />
          <circle cx="7.6" cy="1.8" r="0.6" fill="#ffffff" />
          <circle cx="3.4" cy="3.5" r="0.6" fill="#ffffff" />
          <circle cx="6.2" cy="3.5" r="0.6" fill="#ffffff" />
          <circle cx="2" cy="5.2" r="0.6" fill="#ffffff" />
          <circle cx="4.8" cy="5.2" r="0.6" fill="#ffffff" />
          <circle cx="7.6" cy="5.2" r="0.6" fill="#ffffff" />
          <circle cx="3.4" cy="6.9" r="0.6" fill="#ffffff" />
          <circle cx="6.2" cy="6.9" r="0.6" fill="#ffffff" />
        </g>
      );

    // 2. Tiếng Nhật (Japanese - JP)
    case "ja":
      return (
        <g>
          <rect width="24" height="16" fill="#ffffff" />
          <circle cx="12" cy="8" r="4.8" fill="#bc002d" />
        </g>
      );

    // 3. Tiếng Hàn (Korean - KR)
    case "ko":
      return (
        <g>
          <rect width="24" height="16" fill="#ffffff" />
          {/* Taegeuk Yin-Yang */}
          <path
            d="M 8.4 8 A 3.6 3.6 0 0 1 15.6 8 A 1.8 1.8 0 0 1 12 8 A 1.8 1.8 0 0 0 8.4 8 Z"
            fill="#cd2e3a"
          />
          <path
            d="M 8.4 8 A 3.6 3.6 0 0 0 15.6 8 A 1.8 1.8 0 0 1 12 8 A 1.8 1.8 0 0 0 8.4 8 Z"
            fill="#0047a0"
          />
          {/* 4 Trigrams */}
          {/* Top-Left: Geon (3 solid bars) */}
          <g transform="translate(4.2, 3.2) rotate(34)">
            <line
              x1="-2"
              y1="-1"
              x2="2"
              y2="-1"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="-2"
              y1="0"
              x2="2"
              y2="0"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="-2"
              y1="1"
              x2="2"
              y2="1"
              stroke="#000000"
              strokeWidth="0.6"
            />
          </g>
          {/* Bottom-Right: Gon (3 broken bars) */}
          <g transform="translate(19.8, 12.8) rotate(34)">
            <line
              x1="-2"
              y1="-1"
              x2="-0.3"
              y2="-1"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="0.3"
              y1="-1"
              x2="2"
              y2="-1"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="-2"
              y1="0"
              x2="-0.3"
              y2="0"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="0.3"
              y1="0"
              x2="2"
              y2="0"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="-2"
              y1="1"
              x2="-0.3"
              y2="1"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="0.3"
              y1="1"
              x2="2"
              y2="1"
              stroke="#000000"
              strokeWidth="0.6"
            />
          </g>
          {/* Top-Right: Gam (broken, solid, broken) */}
          <g transform="translate(19.8, 3.2) rotate(-34)">
            <line
              x1="-2"
              y1="-1"
              x2="-0.3"
              y2="-1"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="0.3"
              y1="-1"
              x2="2"
              y2="-1"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="-2"
              y1="0"
              x2="2"
              y2="0"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="-2"
              y1="1"
              x2="-0.3"
              y2="1"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="0.3"
              y1="1"
              x2="2"
              y2="1"
              stroke="#000000"
              strokeWidth="0.6"
            />
          </g>
          {/* Bottom-Left: Ri (solid, broken, solid) */}
          <g transform="translate(4.2, 12.8) rotate(-34)">
            <line
              x1="-2"
              y1="-1"
              x2="2"
              y2="-1"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="-2"
              y1="0"
              x2="-0.3"
              y2="0"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="0.3"
              y1="0"
              x2="2"
              y2="0"
              stroke="#000000"
              strokeWidth="0.6"
            />
            <line
              x1="-2"
              y1="1"
              x2="2"
              y2="1"
              stroke="#000000"
              strokeWidth="0.6"
            />
          </g>
        </g>
      );

    // 4. Tiếng Tây Ban Nha (Spanish - ES)
    case "es":
      return (
        <g>
          <rect width="24" height="4" fill="#aa151b" />
          <rect y="4" width="24" height="8" fill="#f1bf00" />
          <rect y="12" width="24" height="4" fill="#aa151b" />
          <circle cx="6" cy="8" r="2.2" fill="#aa151b" />
          <circle cx="6" cy="8" r="1.4" fill="#f1bf00" />
        </g>
      );

    // 5. Tiếng Pháp (French - FR)
    case "fr":
      return (
        <g>
          <rect width="8" height="16" fill="#002654" />
          <rect x="8" width="8" height="16" fill="#ffffff" />
          <rect x="16" width="8" height="16" fill="#ce1126" />
        </g>
      );

    // 6. Tiếng Đức (German - DE)
    case "de":
      return (
        <g>
          <rect width="24" height="5.33" fill="#000000" />
          <rect y="5.33" width="24" height="5.33" fill="#dd0000" />
          <rect y="10.67" width="24" height="5.33" fill="#ffce00" />
        </g>
      );

    // 7. Tiếng Ý (Italian - IT)
    case "it":
      return (
        <g>
          <rect width="8" height="16" fill="#009246" />
          <rect x="8" width="8" height="16" fill="#ffffff" />
          <rect x="16" width="8" height="16" fill="#ce2b37" />
        </g>
      );

    // 8. Tiếng Bồ Đào Nha (Portuguese - PT)
    case "pt":
      return (
        <g>
          <rect width="9.6" height="16" fill="#046a38" />
          <rect x="9.6" width="14.4" height="16" fill="#da291c" />
          <circle cx="9.6" cy="8" r="3.2" fill="#ffce00" />
          <circle cx="9.6" cy="8" r="2" fill="#da291c" />
          <rect x="9" y="7" width="1.2" height="2" fill="#ffffff" />
        </g>
      );

    // 9. Tiếng Ba Lan (Polish - PL)
    case "pl":
      return (
        <g>
          <rect width="24" height="8" fill="#ffffff" />
          <rect y="8" width="24" height="8" fill="#dc143c" />
        </g>
      );

    // 10. Tiếng Thổ Nhĩ Kỳ (Turkish - TR)
    case "tr":
      return (
        <g>
          <rect width="24" height="16" fill="#e30a17" />
          <circle cx="10" cy="8" r="4.2" fill="#ffffff" />
          <circle cx="11.2" cy="8" r="3.4" fill="#e30a17" />
          <polygon
            points="14,6.2 14.8,7.4 16.2,7.4 15.1,8.2 15.5,9.6 14.4,8.8 13.3,9.6 13.7,8.2 12.6,7.4 14,7.4"
            fill="#ffffff"
          />
        </g>
      );

    // 11. Tiếng Nga (Russian - RU)
    case "ru":
      return (
        <g>
          <rect width="24" height="5.33" fill="#ffffff" />
          <rect y="5.33" width="24" height="5.33" fill="#0039a6" />
          <rect y="10.67" width="24" height="5.33" fill="#d52b1e" />
        </g>
      );

    // 12. Tiếng Hà Lan (Dutch - NL)
    case "nl":
      return (
        <g>
          <rect width="24" height="5.33" fill="#ae1c28" />
          <rect y="5.33" width="24" height="5.33" fill="#ffffff" />
          <rect y="10.67" width="24" height="5.33" fill="#21468b" />
        </g>
      );

    // 13. Tiếng Séc (Czech - CS)
    case "cs":
      return (
        <g>
          <rect width="24" height="8" fill="#ffffff" />
          <rect y="8" width="24" height="8" fill="#d7141a" />
          <polygon points="0,0 12,8 0,16" fill="#11457e" />
        </g>
      );

    // 14. Tiếng Ả Rập (Arabic - AR)
    case "ar":
      return (
        <g>
          <rect width="24" height="16" fill="#006c35" />
          <path
            d="M5 9h14M7 7h10M10 5h4"
            stroke="#ffffff"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path d="M5 12h11l2-1-2-1H5v2z" fill="#ffffff" />
        </g>
      );

    // 15. Tiếng Trung giản thể (Chinese - ZH / ZH-CN)
    case "zh":
    case "zh-cn":
      return (
        <g>
          <rect width="24" height="16" fill="#de2910" />
          {/* Main big star */}
          <polygon
            points="5,2.5 5.8,5.1 8.5,5.1 6.3,6.7 7.1,9.3 5,7.7 2.9,9.3 3.7,6.7 1.5,5.1 4.2,5.1"
            fill="#ffde00"
          />
          {/* 4 small stars */}
          <circle cx="10" cy="2.5" r="0.75" fill="#ffde00" />
          <circle cx="11.5" cy="4.5" r="0.75" fill="#ffde00" />
          <circle cx="11.5" cy="7.2" r="0.75" fill="#ffde00" />
          <circle cx="10" cy="9.2" r="0.75" fill="#ffde00" />
        </g>
      );

    // 16. Tiếng Hungary (Hungarian - HU)
    case "hu":
      return (
        <g>
          <rect width="24" height="5.33" fill="#ce2939" />
          <rect y="5.33" width="24" height="5.33" fill="#ffffff" />
          <rect y="10.67" width="24" height="5.33" fill="#477050" />
        </g>
      );

    // 17. Tiếng Hindi (Hindi - HI)
    case "hi":
      return (
        <g>
          <rect width="24" height="5.33" fill="#ff9933" />
          <rect y="5.33" width="24" height="5.33" fill="#ffffff" />
          <rect y="10.67" width="24" height="5.33" fill="#128807" />
          <circle
            cx="12"
            cy="8"
            r="2.2"
            fill="none"
            stroke="#000080"
            strokeWidth="0.5"
          />
          <circle cx="12" cy="8" r="0.5" fill="#000080" />
          <line
            x1="12"
            y1="6"
            x2="12"
            y2="10"
            stroke="#000080"
            strokeWidth="0.4"
          />
          <line
            x1="10"
            y1="8"
            x2="14"
            y2="8"
            stroke="#000080"
            strokeWidth="0.4"
          />
          <line
            x1="10.6"
            y1="6.6"
            x2="13.4"
            y2="9.4"
            stroke="#000080"
            strokeWidth="0.4"
          />
          <line
            x1="10.6"
            y1="9.4"
            x2="13.4"
            y2="6.6"
            stroke="#000080"
            strokeWidth="0.4"
          />
        </g>
      );

    default:
      return (
        <g>
          <rect width="24" height="16" fill="#71667e" />
          <text
            x="12"
            y="11"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="7"
            fontWeight="bold"
          >
            {code.slice(0, 2).toUpperCase()}
          </text>
        </g>
      );
  }
}
