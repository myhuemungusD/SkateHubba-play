import { useRef, useEffect, useCallback } from "react";
import { logger } from "../services/logger";

/* ────────────────────────────────────────────
 * WebGL barrel-distortion (fisheye) renderer
 *
 * Reads frames from a source <video>, applies a
 * GPU-accelerated barrel-distortion fragment shader,
 * and renders to a <canvas>.  The canvas can also
 * supply a captureStream() for MediaRecorder so the
 * fisheye bakes into the recorded file.
 * ──────────────────────────────────────────── */

const VERTEX_SRC = `
  attribute vec2 a_position;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    // Map clip-space [-1,1] to texture-space [0,1] (flip Y for video)
    v_texCoord = vec2((a_position.x + 1.0) / 2.0, 1.0 - (a_position.y + 1.0) / 2.0);
  }
`;

const FRAGMENT_SRC = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_texture;
  uniform float u_strength;

  void main() {
    // Centre coordinates in [-1, 1]
    vec2 uv = v_texCoord * 2.0 - 1.0;
    float r = length(uv);
    float theta = atan(r * u_strength) / atan(u_strength);
    vec2 distorted = uv * (theta / max(r, 0.001));
    // Back to [0, 1]
    distorted = distorted * 0.5 + 0.5;

    // Vignette: darken edges for authentic skate-cam feel
    float vignette = 1.0 - smoothstep(0.4, 1.0, r);

    // Black outside the circle
    if (distorted.x < 0.0 || distorted.x > 1.0 || distorted.y < 0.0 || distorted.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
      vec4 color = texture2D(u_texture, distorted);
      gl_FragColor = vec4(color.rgb * vignette, 1.0);
    }
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  /* v8 ignore start */
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    logger.warn("shader_compile_error", { info: gl.getShaderInfoLog(shader) ?? "" });
    gl.deleteShader(shader);
    return null;
  }
  /* v8 ignore stop */
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  /* v8 ignore start */
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    logger.warn("program_link_error", { info: gl.getProgramInfoLog(program) ?? "" });
    gl.deleteProgram(program);
    return null;
  }
  /* v8 ignore stop */

  return program;
}

interface FisheyeRendererProps {
  /** The source <video> element to read frames from. */
  videoEl: HTMLVideoElement | null;
  /** Whether the fisheye effect is active. */
  active: boolean;
  /** Distortion strength (1.0 = mild, 3.0 = heavy). Default 2.0. */
  strength?: number;
  /** Expose the canvas element for captureStream(). */
  onCanvas?: (canvas: HTMLCanvasElement | null) => void;
  className?: string;
}

/**
 * Renders a live video feed through a WebGL barrel-distortion shader.
 * When `active` is false, the canvas is hidden and no GPU work is done.
 */
export function FisheyeRenderer({ videoEl, active, strength = 2.0, onCanvas, className }: FisheyeRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const textureRef = useRef<WebGLTexture | null>(null);
  const rafRef = useRef(0);

  // Expose canvas to parent
  useEffect(() => {
    onCanvas?.(active ? canvasRef.current : null);
    return () => onCanvas?.(null);
  }, [active, onCanvas]);

  const initGL = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return false;

    // Size canvas to match video
    if (videoEl) {
      canvas.width = videoEl.videoWidth || 720;
      canvas.height = videoEl.videoHeight || 1280;
    }

    const gl = canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return false;

    const program = createProgram(gl);
    if (!program) return false;

    gl.useProgram(program);

    // Full-screen quad
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    // prettier-ignore
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1,
    ]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    glRef.current = gl;
    programRef.current = program;
    textureRef.current = texture;

    return true;
  }, [videoEl]);

  useEffect(() => {
    if (!active || !videoEl) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    let initialized = false;

    const render = () => {
      if (!active) return;

      if (!initialized) {
        initialized = initGL();
        if (!initialized) {
          // Retry next frame (video dimensions may not be ready yet)
          rafRef.current = requestAnimationFrame(render);
          return;
        }
      }

      const gl = glRef.current;
      const program = programRef.current;
      if (!gl || !program) return;

      // Resize if needed
      const canvas = canvasRef.current;
      if (canvas && videoEl.videoWidth && canvas.width !== videoEl.videoWidth) {
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      // Upload current video frame as texture
      gl.bindTexture(gl.TEXTURE_2D, textureRef.current);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoEl);

      // Set strength uniform
      const uStrength = gl.getUniformLocation(program, "u_strength");
      gl.uniform1f(uStrength, strength);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, videoEl, strength, initGL]);

  // Cleanup GL resources on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      const gl = glRef.current;
      if (gl) {
        if (textureRef.current) gl.deleteTexture(textureRef.current);
        if (programRef.current) gl.deleteProgram(programRef.current);
      }
    };
  }, []);

  if (!active) return null;

  return <canvas ref={canvasRef} className={className} aria-label="Fisheye camera preview" />;
}
