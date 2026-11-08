import type { SVGProps } from "react";

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
