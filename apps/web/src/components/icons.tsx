import type { ReactNode, SVGProps } from "react";

/**
 * Line icons drawn for Palisec: 24-unit grid, 1.6 stroke, round caps, currentColor.
 * Decorative by default (aria-hidden); the button that holds one carries the accessible name.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17.2v.1" />
  </Icon>
);

/** Clockwise arrow: fetch again. */
export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </Icon>
);

/** Counter-clockwise arrow: back to the start. */
export const ResetIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v4h4" />
  </Icon>
);

export const ReplayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v4h4" />
    <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" stroke="none" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 7h15M9.5 7V5h5v2" />
    <path d="M6.5 7l1 12.5h9l1-12.5" />
    <path d="M10.5 11v5M13.5 11v5" />
  </Icon>
);

export const SignOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
    <path d="M11 12h9M17 8.5l3.5 3.5-3.5 3.5" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />
  </Icon>
);

/* ---------- Concept icons: one per idea, reused wherever that idea appears ---------- */

const mk = (body: ReactNode) => {
  const C = (p: IconProps) => <Icon {...p}>{body}</Icon>;
  return C;
};

export const ArrowRightIcon = mk(<path d="M5 12h14M13 6l6 6-6 6" />);
export const ExternalIcon = mk(<><path d="M14 4.5h5.5V10" /><path d="M19.5 4.5L11 13" /><path d="M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10" /></>);
export const ShieldIcon = mk(<path d="M12 3.5l7 2.8v5.2c0 4.4-2.9 8-7 9.5-4.1-1.5-7-5.1-7-9.5V6.3z" />);
export const ShieldCheckIcon = mk(<><path d="M12 3.5l7 2.8v5.2c0 4.4-2.9 8-7 9.5-4.1-1.5-7-5.1-7-9.5V6.3z" /><path d="M9 12l2.2 2.2L15.5 10" /></>);
export const CodeIcon = mk(<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14" />);
export const TerminalIcon = mk(<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M7.5 9.5l3 2.5-3 2.5M13 15h3.5" /></>);
export const AgentIcon = mk(<><rect x="4.5" y="8" width="15" height="11.5" rx="3" /><path d="M12 8V4.5M10 4.5h4" /><path d="M9.5 13v1.2M14.5 13v1.2" /><path d="M2.5 12.5v3M21.5 12.5v3" /></>);
export const KeyIcon = mk(<><circle cx="8" cy="15" r="3.8" /><path d="M10.8 12.3L19.5 3.6M16.5 6.6l2.5 2.5M14.3 8.8l1.8 1.8" /></>);
export const PlugIcon = mk(<><path d="M9 3v5M15 3v5" /><path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0z" /><path d="M12 16.5V21" /></>);
export const BellIcon = mk(<><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>);
export const BookIcon = mk(<><path d="M4.5 5.5a2 2 0 0 1 2-2h13v14h-13a2 2 0 0 0-2 2z" /><path d="M4.5 19.5a2 2 0 0 0 2 2h13v-4" /><path d="M9 8h6.5" /></>);
export const LayersIcon = mk(<><path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" /><path d="M3.5 12.5l8.5 4.5 8.5-4.5" /><path d="M3.5 16.5L12 21l8.5-4.5" /></>);
export const CpuIcon = mk(<><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /><rect x="9.5" y="9.5" width="5" height="5" /><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" /></>);
export const LockIcon = mk(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /><path d="M12 14.5v2" /></>);
export const EyeIcon = mk(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>);
export const ClockIcon = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const UserCheckIcon = mk(<><circle cx="9.5" cy="8" r="3.8" /><path d="M2.5 20.5a7 7 0 0 1 14 0" /><path d="M16 11.5l2 2 4-4" /></>);
export const ActivityIcon = mk(<path d="M3 12h4l2.5-6.5 5 13L17 12h4" />);
export const FileCheckIcon = mk(<><path d="M14 3.5H6.5a1.5 1.5 0 0 0-1.5 1.5v14a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V8.5z" /><path d="M14 3.5v5h5" /><path d="M9 14l2 2 4-4" /></>);
export const DatabaseIcon = mk(<><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" /><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" /><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></>);
export const ZapIcon = mk(<path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z" />);
export const BanIcon = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>);
export const CheckCircleIcon = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M8.2 12.3l2.6 2.6 5-5.3" /></>);
export const HandIcon = mk(<><path d="M8 12.5V5.8a1.5 1.5 0 0 1 3 0v5.7" /><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" /><path d="M14 11V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7c-2.4 0-3.8-1-5.2-3l-2.2-3.2a1.5 1.5 0 0 1 2.4-1.8L8 15" /></>);
export const StopIcon = mk(<><path d="M8.3 3.5h7.4l5.2 5.2v7.4l-5.2 5.2H8.3l-5.2-5.2V8.7z" /><path d="M9 12h6" /></>);
export const LinkIcon = mk(<><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" /></>);
export const GlobeIcon = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5z" /></>);
export const ServerIcon = mk(<><rect x="3.5" y="4" width="17" height="7" rx="1.5" /><rect x="3.5" y="13" width="17" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></>);
export const PlayIcon = mk(<path d="M7.5 5v14l11-7z" />);
export const SearchIcon = mk(<><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5" /></>);
export const WalletIcon = mk(<><path d="M18.5 7.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A2 2 0 0 0 3.5 6v12a2 2 0 0 0 2 2h13.5a1.5 1.5 0 0 0 1.5-1.5v-9.5a1.5 1.5 0 0 0-1.5-1.5H5.5A2 2 0 0 1 3.5 6" /><path d="M16.5 14h.01" /></>);
export const GaugeIcon = mk(<><path d="M4 17a8.5 8.5 0 1 1 16 0" /><path d="M12 13.5l4-4.5" /><circle cx="12" cy="14" r="1.2" /></>);
export const RepeatIcon = mk(<><path d="M17 3.5l3 3-3 3" /><path d="M4 11.5v-1a4 4 0 0 1 4-4h12" /><path d="M7 20.5l-3-3 3-3" /><path d="M20 12.5v1a4 4 0 0 1-4 4H4" /></>);
export const ChainIcon = mk(<><rect x="3" y="9" width="8" height="6" rx="3" /><rect x="13" y="9" width="8" height="6" rx="3" /><path d="M9 12h6" /></>);
export const GitBranchIcon = mk(<><circle cx="6.5" cy="5.5" r="2" /><circle cx="6.5" cy="18.5" r="2" /><circle cx="17.5" cy="7.5" r="2" /><path d="M6.5 7.5v9M17.5 9.5c0 4-5 4-9.5 7" /></>);
export const SlidersIcon = mk(<><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>);
