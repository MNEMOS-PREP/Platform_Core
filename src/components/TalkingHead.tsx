/**
 * An interviewer's face that talks (v0.27.0, 2026-10-08).
 *
 * A 3D head made from one AI-generated portrait (M11 `scripts/make_faces.py`:
 * LAM lifts the portrait into ~20,000 Gaussians bound to a FLAME head), drawn
 * in the browser by myned-ai's gsplat-flame-avatar-renderer (MIT). While the
 * interviewer speaks, every frame shows the 52 ARKit blendshapes of the
 * sentence being heard, at its audio's own time (`voice.expression`) — lip
 * sync made from the voice itself, not guessed from the text.
 *
 * v0.28.0: everything else the face does is `faceDriver`'s (face.ts): all 52
 * channels every frame, so a mouth cut off mid-word settles shut instead of
 * staying open; blinks; a nod into stressed words; a listener's nods. The
 * body is the rig's idle clip, looped on each head's own mixer — the
 * renderer's speak/listen state machine keeps its state on the class, shared
 * by every head on the page, so at a hand-over one head's cross-fade could
 * start from another head's clip.
 *
 * The renderer (three.js and a WebGL Gaussian sorter, about 2 MB) loads only
 * when a face is shown. Until the head is ready — and for good, if WebGL is
 * missing or the head cannot load — the `fallback` (the drawn face) stands
 * in, so a room never waits on a face.
 *
 * Every head is labelled as AI (spec §15.6): its portrait was generated,
 * never a real person's.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { faceDriver, type Expression, type HeadPose } from "../voice/face";

export interface TalkingHeadProps {
  /** M06's persona id; the head is M11's `/v1/voice/faces/{persona}.zip`. */
  persona: string;
  /** The interviewer's name, for the label a screen reader hears. */
  name: string;
  /** This person is speaking right now — the room knows who. */
  speaking: boolean;
  /** The expression for this frame while they speak (`voice.expression`). */
  expression: () => Expression | null;
  /** The student is talking to this person: the head listens (nods now and
   *  then) rather than idles. */
  listening?: boolean;
  /** Shown until the head is ready, and instead of it if it cannot be. */
  fallback: ReactNode;
  className?: string;
  /** "AI" in the corner (spec §15.6). On unless the page labels it itself. */
  label?: boolean;
}

/** Where the renderer's own camera sits (a metre back, looking down): moved
 *  in to a face-to-face distance, level with the eyes. FLAME's head sits at
 *  1.67 m in the rig (LAM's template), its eyes a few centimetres above. */
const CAMERA = { position: [0, 1.708, 0.46] as const, target: [0, 1.69, 0.04] as const };

type Renderer = {
  dispose(): void;
  /** The rig's clips, and one played alone on this head (the state machine
   *  set aside). Both in the renderer since 1.4; absent, the default runs. */
  listClips?(): { name: string; duration: number }[];
  playClip?(name: string, loop?: boolean): number | null;
  viewer?: {
    /** The next frame the renderer's own loop asked for. */
    requestFrameId?: number;
    camera?: { position: { set(x: number, y: number, z: number): void }; lookAt(x: number, y: number, z: number): void };
    controls?: { target: { set(x: number, y: number, z: number): void } };
  };
};
type RendererClass = {
  create(container: HTMLElement, assetPath: string, options: Record<string, unknown>): Promise<Renderer>;
};

let loading: Promise<RendererClass> | null = null;

/** The renderer module, once for the page however many faces it shows. */
function loadRenderer(): Promise<RendererClass> {
  loading ??= import("@myned-ai/gsplat-flame-avatar-renderer").then(
    (module) => (module as unknown as { GaussianSplatRenderer: RendererClass }).GaussianSplatRenderer,
  );
  return loading;
}

function webglAvailable(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

/** The first background behind `element` that can be seen, as the renderer
 *  wants it ("0xRRGGBB"). The theme's colours are oklch, which reading the
 *  numbers out of the CSS turned into seven hex digits — the renderer
 *  refused every head (2026-10-08) — so a canvas does the conversion: it
 *  takes any colour CSS does, and hands back RGB. */
function backgroundOf(element: HTMLElement): string {
  const fallback = "0x101114";
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) return fallback;
  for (let at: HTMLElement | null = element; at; at = at.parentElement) {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000000";
    context.fillStyle = getComputedStyle(at).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
    if (alpha === 0) continue; // transparent: the colour is further out
    const hex = [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    return `0x${hex}`;
  }
  return fallback;
}

export function TalkingHead({
  persona,
  name,
  speaking,
  expression,
  listening = false,
  fallback,
  className = "",
  label = true,
}: TalkingHeadProps) {
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">(() =>
    typeof document !== "undefined" && webglAvailable() ? "loading" : "failed",
  );
  // Read by the renderer every frame: refs, so no re-render per frame.
  const speakingRef = useRef(speaking);
  const listeningRef = useRef(listening);
  const expressionRef = useRef(expression);
  speakingRef.current = speaking;
  listeningRef.current = listening;
  expressionRef.current = expression;

  useEffect(() => {
    const element = holder.current;
    if (!element || !webglAvailable()) {
      setState("failed");
      return;
    }
    let disposed = false;
    let renderer: Renderer | null = null;
    // Each mount draws into its own element, removed with its renderer: in
    // React's development double-mount the first renderer is disposed while
    // the second shares the holder, and disposing took the second's canvas.
    const mount = document.createElement("div");
    mount.style.cssText = "position:absolute;inset:0";
    // The renderer removes its canvas twice when disposed (its own dispose,
    // then its viewer's): the second finds it gone and throws. Gone is fine.
    const removeChild = mount.removeChild.bind(mount);
    mount.removeChild = <T extends Node>(child: T): T =>
      child.parentNode === mount ? removeChild(child) : child;
    element.appendChild(mount);
    const release = (made: Renderer | null) => {
      // The renderer's dispose leaves its frame loop running, and the next
      // frame throws on a viewer that is gone: stop the loop first.
      const frame = made?.viewer?.requestFrameId;
      if (frame) cancelAnimationFrame(frame);
      try {
        made?.dispose();
      } catch {
        // Already torn down: nothing left to release.
      }
      mount.remove();
    };
    // This head's face, frame by frame: the renderer asks for the
    // expression, then (after its clip has moved the bones) the head pose.
    const face = faceDriver(persona);
    setState("loading");
    loadRenderer()
      .then((GaussianSplatRenderer) =>
        GaussianSplatRenderer.create(mount, `/v1/voice/faces/${encodeURIComponent(persona)}.zip`, {
          getChatState: () => "Idle",
          getExpressionData: () =>
            face.frame(
              performance.now() / 1000,
              speakingRef.current ? expressionRef.current() : null,
              listeningRef.current,
            ),
          getNeckPose: (): HeadPose | null => face.pose(),
          // The tile's colour: the holder itself is transparent.
          backgroundColor: backgroundOf(element),
        }),
      )
      .then((made) => {
        if (disposed) {
          release(made);
          return;
        }
        renderer = made;
        const camera = made.viewer?.camera;
        if (camera) {
          camera.position.set(...CAMERA.position);
          made.viewer?.controls?.target.set(...CAMERA.target);
          camera.lookAt(...CAMERA.target);
        }
        // The idle clip, looped on this head alone (see the top).
        const clips = made.listClips?.() ?? [];
        const idle = clips.find((clip) => /idle/i.test(clip.name)) ?? clips[0];
        if (idle) made.playClip?.(idle.name, true);
        // `create` has started the renderer's own frame loop already.
        setState("ready");
      })
      .catch(() => {
        if (!disposed) setState("failed");
      });
    return () => {
      disposed = true;
      release(renderer);
    };
  }, [persona]);

  return (
    <div
      className={`relative overflow-hidden bg-surface-sunken ${className}`}
      role="img"
      aria-label={`${name}, an AI-generated interviewer${speaking ? ", speaking" : ""}`}
    >
      <div ref={holder} className={`absolute inset-0 ${state === "ready" ? "" : "opacity-0"}`} />
      {state !== "ready" && <div className="absolute inset-0 grid place-items-center">{fallback}</div>}
      {label && state === "ready" && (
        <span
          className="absolute top-1.5 right-1.5 rounded bg-black/55 px-1.5 py-px text-[0.625rem] font-semibold tracking-wide text-white"
          title="An AI-generated face: never a real person's"
        >
          AI
        </span>
      )}
    </div>
  );
}
