/** A tiny in-page event bus between the board, the background effects and the panels. */
import type { StreamBuy } from "../api-types";

export interface BusEvents {
  /** A purchase arrived from the stream. */
  buy: StreamBuy;
  /** The lot under the pointer (null when off the board). */
  hover: { lx: number; ly: number } | null;
  /** Screen position of something the eyes should look at. */
  look: { x: number; y: number };
}

type Handler<T> = (v: T) => void;

class Bus {
  private handlers = new Map<keyof BusEvents, Set<Handler<unknown>>>();
  on<K extends keyof BusEvents>(k: K, fn: Handler<BusEvents[K]>): () => void {
    let set = this.handlers.get(k);
    if (!set) this.handlers.set(k, (set = new Set()));
    set.add(fn as Handler<unknown>);
    return () => set!.delete(fn as Handler<unknown>);
  }
  emit<K extends keyof BusEvents>(k: K, v: BusEvents[K]): void {
    this.handlers.get(k)?.forEach((fn) => fn(v));
  }
}

export const bus = new Bus();

/** Where the board is on screen, so effects can start from a lot. Set by the board view. */
export const boardGeometry: { lotToScreen: ((lx: number, ly: number) => { x: number; y: number } | null) | null } = {
  lotToScreen: null,
};
