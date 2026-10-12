import { CanvasTexture, MeshLambertMaterial, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

function paintTexture(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paint(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function speck(ctx: CanvasRenderingContext2D, count: number, color: string, size: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i += 1) {
    const x = Math.random() * ctx.canvas.width;
    const y = Math.random() * ctx.canvas.height;
    ctx.fillRect(x, y, size, size);
  }
}

let concreteTex: Texture | null | undefined;
let metalTex: Texture | null | undefined;
let gripTex: Texture | null | undefined;

function concreteTexture(): Texture | null {
  if (concreteTex !== undefined) return concreteTex;
  concreteTex = paintTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#7c776f";
    ctx.fillRect(0, 0, 256, 256);
    speck(ctx, 900, "rgba(40,36,32,0.35)", 2);
    speck(ctx, 400, "rgba(230,224,214,0.18)", 1);
    ctx.strokeStyle = "rgba(50,46,42,0.45)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i += 1) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 256, Math.random() * 256);
      ctx.lineTo(Math.random() * 256, Math.random() * 256);
      ctx.stroke();
    }
  });
  if (concreteTex) concreteTex.repeat.set(2, 6);
  return concreteTex;
}

function metalTexture(): Texture | null {
  if (metalTex !== undefined) return metalTex;
  metalTex = paintTexture(128, 64, (ctx) => {
    ctx.fillStyle = "#8b98a1";
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let y = 0; y < 64; y += 3) ctx.fillRect(0, y, 128, 1);
    ctx.fillStyle = "rgba(90,62,40,0.55)";
    for (let i = 0; i < 8; i += 1) {
      ctx.fillRect(Math.random() * 120, Math.random() * 56, 10 + Math.random() * 18, 2);
    }
    ctx.fillStyle = "rgba(20,24,28,0.35)";
    ctx.fillRect(0, 0, 128, 3);
  });
  if (metalTex) metalTex.repeat.set(1, 3);
  return metalTex;
}

function gripTexture(): Texture | null {
  if (gripTex !== undefined) return gripTex;
  gripTex = paintTexture(128, 128, (ctx) => {
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, 128, 128);
    speck(ctx, 700, "rgba(70,70,70,0.9)", 1);
    speck(ctx, 200, "rgba(20,20,20,0.8)", 2);
  });
  return gripTex;
}

function lambert(color: string, map: Texture | null, emissive?: string): MeshLambertMaterial {
  return new MeshLambertMaterial({
    color,
    map: map ?? undefined,
    emissive: emissive ?? "#000000",
  });
}

let road: MeshLambertMaterial | null = null;
let sidewalk: MeshLambertMaterial | null = null;
let metal: MeshLambertMaterial | null = null;
let grip: MeshLambertMaterial | null = null;
let wax: MeshLambertMaterial | null = null;

export function roadMaterial(): MeshLambertMaterial {
  road ??= lambert("#ffffff", concreteTexture());
  return road;
}

export function sidewalkMaterial(): MeshLambertMaterial {
  sidewalk ??= lambert("#c9c2b6", concreteTexture());
  return sidewalk;
}

export function metalMaterial(): MeshLambertMaterial {
  metal ??= lambert("#ffffff", metalTexture(), "#1a2228");
  return metal;
}

export function gripMaterial(): MeshLambertMaterial {
  grip ??= lambert("#ffffff", gripTexture());
  return grip;
}

export function waxMaterial(): MeshLambertMaterial {
  wax ??= new MeshLambertMaterial({ color: "#e6d3a1", emissive: "#3a2e14" });
  return wax;
}

export function flatMaterial(color: string, emissive?: string): MeshLambertMaterial {
  return new MeshLambertMaterial({ color, emissive: emissive ?? "#000000" });
}
