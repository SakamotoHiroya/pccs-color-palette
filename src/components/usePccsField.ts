"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldRequest, FieldResponse } from "@/lib/pccs.worker";

/**
 * Computes the PCCS (l, s) field of the HSB square in a Web Worker.
 * While a computation is running, only the latest requested hue is queued.
 */
export function usePccsField(hue: number, n: number): FieldResponse | null {
  const [field, setField] = useState<FieldResponse | null>(null);
  const postRef = useRef<((h: number) => void) | null>(null);
  const busyRef = useRef(false);
  const pendingRef = useRef<number | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../lib/pccs.worker.ts", import.meta.url));
    let id = 0;
    const post = (h: number) => {
      busyRef.current = true;
      const req: FieldRequest = { id: ++id, hue: h, n };
      worker.postMessage(req);
    };
    worker.onmessage = (e: MessageEvent<FieldResponse>) => {
      setField(e.data);
      busyRef.current = false;
      const next = pendingRef.current;
      if (next !== null) {
        pendingRef.current = null;
        post(next);
      }
    };
    postRef.current = post;
    return () => {
      worker.terminate();
      postRef.current = null;
      busyRef.current = false;
      pendingRef.current = null;
    };
  }, [n]);

  useEffect(() => {
    const post = postRef.current;
    if (!post) return;
    if (busyRef.current) pendingRef.current = hue;
    else post(hue);
  }, [hue, n]);

  return field;
}
