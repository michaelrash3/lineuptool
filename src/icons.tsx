import React, { ComponentType, SVGProps } from "react";
import {
  Calendar,
  Clipboard,
  Settings,
  Users,
  UserPlus,
  User,
  Upload,
  Download,
  Save,
  Edit,
  Trash2,
  Plus,
  Minus,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Cloud,
  FileText,
  Lock,
  Unlock,
  RefreshCw,
  Printer,
  AlertTriangle,
  Forward,
  Link,
} from "lucide-react";

type IconProps = SVGProps<SVGSVGElement>;
// Lucide icons are forwardRef components; widen to any-prop component so call
// sites can pass className/size without fighting LucideProps vs SVGProps.
type IconComponent = ComponentType<any>;

// Generic icons come from lucide-react. Baseball-specific glyphs
// (HomePlate, Jersey, Bat, Glove, Pitch) are inline SVGs sourced from the
// Coach's Card Design System handoff at
// design_handoff/design_handoff_coachs_card/assets/iconography/*.svg.
const baseballSvgProps: IconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const Icons: Record<string, IconComponent> = {
  HomePlate: (p: IconProps) => (
    <svg {...baseballSvgProps} {...p}>
      <path d="M3.5 5h17v8l-8.5 6.5L3.5 13Z" fill="currentColor" fillOpacity="0.12" />
    </svg>
  ),
  Jersey: (p: IconProps) => (
    <svg {...baseballSvgProps} {...p}>
      <path
        d="M9 3.5 L 12 6.5 L 15 3.5 L 20.5 5.5 L 18 11.5 L 17 11.2 L 17 20.5 L 7 20.5 L 7 11.2 L 6 11.5 L 3.5 5.5 Z"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <path d="M9 3.5 Q 12 8.5 15 3.5" />
    </svg>
  ),
  Bat: (p: IconProps) => (
    <svg {...baseballSvgProps} {...p}>
      <g transform="rotate(-40 12 12)">
        <path
          d="M3 11.5 Q3 11.5 3 12 Q3 12.5 3 12.5 L9 12.5 Q11 12.6 11.5 13 Q12.5 13.8 14 14 L18.5 14 Q21 14 21 12 Q21 10 18.5 10 L14 10 Q12.5 10.2 11.5 11 Q11 11.4 9 11.5 Z"
          fill="currentColor"
          fillOpacity="0.16"
        />
        <circle cx="3" cy="12" r="1.4" fill="currentColor" fillOpacity="0.28" />
        <path d="M5 11.5v1" strokeWidth="1" />
        <path d="M6.5 11.5v1" strokeWidth="1" />
        <path d="M8 11.5v1" strokeWidth="1" />
      </g>
    </svg>
  ),
  Glove: (p: IconProps) => (
    <svg {...baseballSvgProps} {...p}>
      <path
        d="M3.5 13 Q3.5 7 7.5 5.8 Q11 5 13 7.2 Q14 5.2 16.5 5.6 Q19.5 6.2 20.3 9.2 Q20.7 11.5 19 13 Q17.8 13.9 16.2 13.7 Q15 13.5 14 13 L14 17 Q14 20.5 11 20.5 L7.8 20.5 Q3.5 20.5 3.5 17 Z"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <path d="M14.5 7.8 L17.2 7.2" strokeWidth="1.1" />
      <path d="M14.5 9.4 L17.4 9" strokeWidth="1.1" />
      <path d="M14.8 11 L17 11" strokeWidth="1.1" />
      <circle cx="8.8" cy="13" r="2.6" fill="currentColor" fillOpacity="0.25" />
      <path d="M6.6 12.4 q2.2 0.7 4.4 0" strokeWidth="1.1" />
      <path d="M6.6 13.6 q2.2 -0.7 4.4 0" strokeWidth="1.1" />
    </svg>
  ),
  Pitch: (p: IconProps) => (
    <svg {...baseballSvgProps} {...p}>
      <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.08" />
      <path d="M7 5.8c1.6 1.7 2.4 3.7 2.4 6.2s-.8 4.5-2.4 6.2" />
      <path d="M17 5.8c-1.6 1.7-2.4 3.7-2.4 6.2s.8 4.5 2.4 6.2" />
      <g strokeWidth="1.2" strokeLinecap="round">
        <path d="M8.3 7.7l-1.6-.6" />
        <path d="M9 9.6l-1.7-.3" />
        <path d="M9.4 11.4l-1.7 0" />
        <path d="M9.4 13l-1.7 0" />
        <path d="M9 14.8l-1.7.3" />
        <path d="M8.3 16.7l-1.6.6" />
        <path d="M15.7 7.7l1.6-.6" />
        <path d="M15 9.6l1.7-.3" />
        <path d="M14.6 11.4l1.7 0" />
        <path d="M14.6 13l1.7 0" />
        <path d="M15 14.8l1.7.3" />
        <path d="M15.7 16.7l1.6.6" />
      </g>
    </svg>
  ),

  Calendar,
  Clipboard,
  Settings,
  Users,
  UserPlus,
  User,
  Upload,
  Download,
  Save,
  Edit,
  Trash: Trash2,
  Plus,
  Minus,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Cloud,
  FileText,
  Lock,
  Unlock,
  Refresh: RefreshCw,
  Printer,
  Alert: AlertTriangle,
  Forward,
  Link,
};
