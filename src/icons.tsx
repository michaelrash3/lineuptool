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
// (HomePlate, Jersey, Bat, Glove, Pitch) stay as inline SVGs because
// lucide does not ship equivalents.
const baseballSvgProps: IconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const Icons: Record<string, IconComponent> = {
  HomePlate: (p: IconProps) => (
    <svg {...baseballSvgProps} {...p}>
      <path d="M5 3h14v9L12 21 5 12V3z" fill="currentColor" fillOpacity="0.15" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  Jersey: (p: IconProps) => (
    <svg {...baseballSvgProps} {...p}>
      <path d="M8 3h8l4 4-3 3v11H7V10L4 7l4-4z" fill="currentColor" fillOpacity="0.15" />
      <path d="M12 3v6" />
    </svg>
  ),
  Bat: (p: IconProps) => (
    <svg {...baseballSvgProps} {...p}>
      <g transform="rotate(-45 12 12)">
        <rect x="3" y="9.5" width="18" height="5" rx="2.5" fill="currentColor" fillOpacity="0.15" />
        <circle cx="4" cy="12" r="2" fill="currentColor" fillOpacity="0.25" />
      </g>
    </svg>
  ),
  Glove: (p: IconProps) => (
    <svg {...baseballSvgProps} {...p}>
      <path
        d="M5 11c0-3 2-5 7-5s7 2 7 5v6c0 2-1 3-3 3H8c-2 0-3-1-3-3v-6z"
        fill="currentColor"
        fillOpacity="0.15"
      />
      <path d="M9 6.5v4M12 6v4M15 6.5v4" />
      <path
        d="M5 14c-2 0-3-1-3-2.5S3 10 5 11"
        fill="currentColor"
        fillOpacity="0.15"
      />
    </svg>
  ),
  Pitch: (p: IconProps) => (
    <svg {...baseballSvgProps} {...p}>
      <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.15" />
      <path d="M5.5 7c1.2 1.5 1.8 3.2 1.8 5s-.6 3.5-1.8 5" />
      <path d="M18.5 7c-1.2 1.5-1.8 3.2-1.8 5s.6 3.5 1.8 5" />
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
