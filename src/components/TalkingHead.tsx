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
 * missing or the head cannot load — the `fallback` stands in (the room passes
 * the interviewer's photo, `InterviewerPhoto`), and the head fades in over it,
 * so a room never waits on a face and never shows a drawn one.
 *
 * Every head is labelled as AI (spec §15.6): its portrait was generated,
 * never a real person's.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { faceDriver, type Expression, type HeadPose } from "../voice/face";
import { officeBackdropImage, useOfficeBackdrop } from "./officeBackdrop";

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
  /** This person is working out what to say (v0.29.0): the head glances
   *  down and aside until they speak. */
  thinking?: boolean;
  /** Shown until the head is ready, and instead of it if it cannot be: the
   *  interviewer's photo (`InterviewerPhoto` with `fill`). */
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
  /** One frame of the renderer's own loop; it asks for the next itself. */
  render?(): void;
  /** The rig's clips, and one played alone on this head (the state machine
   *  set aside). Both in the renderer since 1.4; absent, the default runs. */
  listClips?(): { name: string; duration: number }[];
  playClip?(name: string, loop?: boolean): number | null;
  viewer?: {
    /** The next frame the renderer's own loop asked for. */
    requestFrameId?: number;
    camera?: { position: { set(x: number, y: number, z: number): void }; lookAt(x: number, y: number, z: number): void };
    controls?: { target: { set(x: number, y: number, z: number): void } };
    /** What the viewer draws before the head: a background set on it shows
     *  behind the splats. It is drawn only while it has a visible child. */
    threeScene?: { background: unknown; add(child: unknown): void };
  };
};
/**
 * Frames a head draws a second (2026-10-12). The renderer draws at the
 * display's rate: two heads at 60 took ~1.9 cores, and with the integrated
 * GPU's share of the laptop's power, live speech was made at 2.2x real time
 * against 1.0x with photos (Voice_Engine research/listening/heads_cpu.md).
 * Lip sync is 30 frames a second (wav2arkit's), and a head that is listening
 * only blinks and nods.
 */
export const SPEAKING_FPS = 30;
export const IDLE_FPS = 15;

/** The renderer's loop, drawing at most `SPEAKING_FPS` while this head speaks
 *  and `IDLE_FPS` otherwise. Its frame asks for the next through `render`, so
 *  the pace holds; skipped ticks keep `requestFrameId` current for dispose. */
function pace(renderer: Renderer, speaking: { current: boolean }): void {
  const own = renderer.render?.bind(renderer);
  const viewer = renderer.viewer;
  if (!own || !viewer) return;
  let last = 0;
  const step = (): void => {
    const now = performance.now();
    if (now - last >= 1000 / (speaking.current ? SPEAKING_FPS : IDLE_FPS) - 4) {
      last = now;
      own();
    } else {
      viewer.requestFrameId = requestAnimationFrame(step);
    }
  };
  renderer.render = step;
}

type RendererClass = {
  create(container: HTMLElement, assetPath: string, options: Record<string, unknown>): Promise<Renderer>;
};

/** The three things of `three` the office backdrop uses. Declared here, not
 *  imported: an app that installs Core gets `three` but not `@types/three`. */
type ThreeBits = {
  CanvasTexture: new (canvas: HTMLCanvasElement) => { colorSpace: unknown; dispose(): void };
  SRGBColorSpace: unknown;
  Object3D: new () => unknown;
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
  thinking = false,
  fallback,
  className = "",
  label = true,
}: TalkingHeadProps) {
  const holder = useRef<HTMLDivElement>(null);
  // The room behind the tile while the head loads, the same photograph the
  // head's scene is given (v0.39.0).
  const room = useOfficeBackdrop(persona);
  const [state, setState] = useState<"loading" | "ready" | "failed">(() =>
    typeof document !== "undefined" && webglAvailable() ? "loading" : "failed",
  );
  // Read by the renderer every frame: refs, so no re-render per frame.
  const speakingRef = useRef(speaking);
  const listeningRef = useRef(listening);
  const thinkingRef = useRef(thinking);
  const expressionRef = useRef(expression);
  speakingRef.current = speaking;
  listeningRef.current = listening;
  thinkingRef.current = thinking;
  expressionRef.current = expression;

  useEffect(() => {
    const element = holder.current;
    if (!element || !webglAvailable()) {
      setState("failed");
      return;
    }
    let disposed = false;
    let renderer: Renderer | null = null;
    let backdrop: { dispose(): void } | null = null;
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
      backdrop?.dispose();
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
              thinkingRef.current,
            ),
          getNeckPose: (): HeadPose | null => face.pose(),
          // The tile's colour: the holder itself is transparent.
          backgroundColor: backgroundOf(element),
        }),
      )
      .then(async (made) => {
        if (disposed) {
          release(made);
          return;
        }
        renderer = made;
        // The office behind the head (2026-10-13): the renderer clears to a
        // flat colour on a canvas with no alpha, so the room is the scene's
        // own background instead. The viewer draws its scene only when it
        // has something visible in it, hence the empty object. `three` is
        // the renderer's own copy (a shared dependency), loaded with it.
        try {
          const room = await officeBackdropImage(persona);
          const scene = made.viewer?.threeScene;
          if (room && scene) {
            // The app that shows the head may not carry three's types.
            // @ts-ignore
            const three = (await import("three")) as unknown as ThreeBits;
            if (!disposed) {
              const texture = new three.CanvasTexture(room);
              texture.colorSpace = three.SRGBColorSpace;
              scene.background = texture;
              scene.add(new three.Object3D());
              backdrop = texture;
            }
          }
        } catch {
          // No room: the head keeps the tile's own colour.
        }
        // Disposed during the import: the cleanup has released `made`.
        if (disposed) return;
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
        pace(made, speakingRef);
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
      className={`relative overflow-hidden bg-surface-sunken bg-cover bg-center ${className}`}
      style={{ backgroundImage: room || undefined }}
      role="img"
      aria-label={`${name}, an AI-generated interviewer${speaking ? ", speaking" : ""}`}
    >
      {/* The photo under the head: the head fades in over it (0.6 s), so the
          person is there from the first frame and only comes to life. */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${state === "ready" ? "opacity-0" : "opacity-100"}`}
        aria-hidden={state === "ready"}
      >
        {fallback}
      </div>
      <div
        ref={holder}
        className={`absolute inset-0 transition-opacity duration-[600ms] ${state === "ready" ? "opacity-100" : "opacity-0"}`}
      />
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
