import React from "react";
import {
  LazyMotion,
  domAnimation,
  m,
  MotionConfig,
  AnimatePresence as FMAnimatePresence,
  useSpring,
  useTransform,
} from "framer-motion";
import type { AnimatePresenceProps } from "framer-motion";

// The app's framer-motion surface. Everything imports `m` from here (never
// `motion` from framer-motion directly) — LazyMotion's strict mode throws on
// stray `motion.` usage, which keeps the full-size bundle from sneaking in.
export { m };

// framer-motion types AnimatePresence as returning `Element | undefined`,
// which TS 4.9's JSX checker rejects; re-type it as a plain FC.
export const AnimatePresence = FMAnimatePresence as unknown as React.FC<
  React.PropsWithChildren<AnimatePresenceProps>
>;

// Root provider: loads the domAnimation feature set lazily and honors the
// user's prefers-reduced-motion setting for every animation below it.
export const AppMotionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <LazyMotion features={domAnimation} strict>
    <MotionConfig reducedMotion="user">{children}</MotionConfig>
  </LazyMotion>
);

// Entrance-only content reveal for tab/page bodies. Keyed by the caller
// (e.g. route pathname) so it replays on navigation.
export const FadeSlideIn = ({
  children,
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & Record<string, any>) => (
  <m.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.18, ease: "easeOut" }}
    className={className}
    {...rest}
  >
    {children}
  </m.div>
);

// Modal panel pop — shared by Modal and A11yDialog (entrance only; exits
// would need AnimatePresence at every conditional call site).
export const SCALE_IN = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;

// Staggered card/list reveal: wrap the grid in StaggerList and each card in
// StaggerItem.
export const StaggerList = ({
  children,
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & Record<string, any>) => (
  <m.div
    className={className}
    initial="hidden"
    animate="show"
    variants={{
      hidden: {},
      show: { transition: { staggerChildren: 0.04 } },
    }}
    {...rest}
  >
    {children}
  </m.div>
);

export const StaggerItem = ({
  children,
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & Record<string, any>) => (
  <m.div
    className={className}
    variants={{
      hidden: { opacity: 0, y: 10 },
      show: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.22, ease: "easeOut" },
      },
    }}
    {...rest}
  >
    {children}
  </m.div>
);

// Number that springs to new values (record tiles, balance hero). Starts at
// the real value — no count-up from zero on mount, so initial paint (and
// jsdom text assertions) always show the true number; subsequent data
// changes animate.
export const AnimatedNumber = ({
  value,
  format,
  className = "",
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) => {
  const spring = useSpring(value, { stiffness: 90, damping: 18 });
  React.useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  const text = useTransform(spring, (v) =>
    format ? format(v) : Math.round(v).toLocaleString(),
  );
  return <m.span className={className}>{text}</m.span>;
};
