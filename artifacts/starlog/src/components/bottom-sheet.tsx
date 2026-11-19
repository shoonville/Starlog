import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

export type SheetHeight = "half" | "full";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Height of the on-screen keyboard (or anything else covering the bottom of the layout
 * viewport), so sheets and their inputs can sit above it.
 */
export function useKeyboardInset() {
  const [state, setState] = useState({ inset: 0, visible: typeof window !== "undefined" ? window.innerHeight : 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setState({ inset: inset > 60 ? inset : 0, visible: Math.round(vv.height) });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return state;
}

/**
 * Drag-handle behavior for a bottom sheet: the sheet follows the finger, then snaps to
 * half or full height, or closes when pulled well down.
 */
export function useSheetDrag(height: SheetHeight, onHeightChange: (h: SheetHeight) => void, onClose: () => void) {
  const drag = useRef<{ y0: number; h0: number; t0: number; el: HTMLElement; id: number } | null>(null);
  const reset = (el: HTMLElement) => {
    el.style.height = "";
    el.style.transform = "";
    el.style.transition = "";
  };
  return {
    onSheetHandleDown(e: React.PointerEvent<HTMLElement>) {
      const el = e.currentTarget.closest<HTMLElement>("[data-sheet]");
      if (!el) return;
      drag.current = { y0: e.clientY, h0: el.getBoundingClientRect().height, t0: performance.now(), el, id: e.pointerId };
      el.style.transition = "none";
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onSheetHandleMove(e: React.PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dy = e.clientY - d.y0;
      const max = (window.visualViewport?.height ?? window.innerHeight) - 12;
      const h = Math.min(max, d.h0 - dy);
      if (h >= 160) {
        d.el.style.height = `${h}px`;
        d.el.style.transform = "";
      } else {
        d.el.style.height = "160px";
        d.el.style.transform = `translateY(${160 - h}px)`;
      }
    },
    onSheetHandleUp(e: React.PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      const dy = e.clientY - d.y0;
      const v = dy / Math.max(1, performance.now() - d.t0); // px per ms
      const H = window.innerHeight;
      const end = d.h0 - dy;
      reset(d.el);
      if (Math.abs(dy) < 6) {
        // A tap on the handle toggles between the two heights.
        onHeightChange(height === "full" ? "half" : "full");
        return;
      }
      if (end < H * 0.3 || (v > 0.9 && height === "half")) onClose();
      else if (v < -0.5 || end > H * 0.74) onHeightChange("full");
      else onHeightChange("half");
    },
    onSheetHandleCancel() {
      if (drag.current) reset(drag.current.el);
      drag.current = null;
    },
  };
}

/**
 * Phone bottom sheet that stays above the keyboard. "half" is about two-thirds of the screen and
 * "full" nearly all of it; a `tall` sheet (the star card) is 90% when full, leaving a sliver of sky, and 50% when half.
 */
export function BottomSheet({ height, children, testId, z = 30, tall = false }: { height: SheetHeight; children: React.ReactNode; testId?: string; z?: number; tall?: boolean }) {
  const { inset, visible } = useKeyboardInset();
  return (
    <motion.div
      data-sheet
      initial={{ y: "100%", opacity: 0.6 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "100%", opacity: 0.4 }}
      transition={{ duration: 0.55, ease: EASE }}
      className={`fixed inset-x-0 transition-[height,bottom] duration-300 soft-ease ${tall ? (height === "full" ? "h-[90dvh]" : "h-[50dvh]") : height === "full" ? "h-[calc(100dvh-14px)]" : "h-[64dvh]"}`}
      style={{ bottom: inset, maxHeight: visible - 8, zIndex: z }}
      data-testid={testId}
    >
      {children}
    </motion.div>
  );
}
