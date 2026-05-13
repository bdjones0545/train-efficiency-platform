import { useEffect } from "react";

const OPEN_EVENT = "command-palette:open";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function useCommandPaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    const handleEvent = () => onOpen();
    window.addEventListener("keydown", handleKey);
    window.addEventListener(OPEN_EVENT, handleEvent);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(OPEN_EVENT, handleEvent);
    };
  }, [onOpen]);
}
