import React from "react";
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

// Generic icons come from lucide-react. Baseball-specific glyphs
// (HomePlate, Jersey, Bat, Glove, Pitch) stay as inline SVGs because
// lucide does not ship equivalents.
const baseballSvgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const Icons = {
  HomePlate: (p) => (
    <svg {...baseballSvgProps} {...p}>
      <path d="M5 3h14v9L12 21 5 12V3z" fill="currentColor" fillOpacity="0.15" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  Jersey: (p) => (
    <svg {...baseballSvgProps} {...p}>
      <path d="M8 3h8l4 4-3 3v11H7V10L4 7l4-4z" fill="currentColor" fillOpacity="0.15" />
      <path d="M12 3v6" />
    </svg>
  ),
  Bat: (p) => (
    <svg {...baseballSvgProps} {...p}>
      <path d="M18 3l3 3-13 13H5v-3L18 3z" fill="currentColor" fillOpacity="0.15" />
      <path d="M15 6l3 3M7 14l3 3" />
    </svg>
  ),
  Glove: (p) => (
    <svg {...baseballSvgProps} {...p}>
      <path
        d="M12 20a8 8 0 0 1-8-8c0-3.5 1.5-6.5 4-8l2 6 2-5 2 5 2-6c2.5 1.5 4 4.5 4 8a8 8 0 0 1-8 8z"
        fill="currentColor"
        fillOpacity="0.15"
      />
      <path d="M8 12s2 2 4 2 4-2 4-2" />
    </svg>
  ),
  Pitch: (p) => (
    <svg {...baseballSvgProps} {...p}>
      <circle cx="16" cy="12" r="5" fill="currentColor" fillOpacity="0.15" />
      <path d="M2 12h7M4 8h5M4 16h5M14 9a3 3 0 010 6M18 9a3 3 0 000 6" />
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
