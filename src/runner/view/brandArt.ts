import { CanvasTexture, MeshStandardMaterial, SRGBColorSpace, TextureLoader, type Texture } from "three";
import graffUrl from "../assets/graff-wall.webp";
import hubbaUrl from "../assets/hubba-graff.webp";
import logoUrl from "../assets/board-logo.webp";

/**
 * SkateHubba brand art owned by Design Mainline LLC. Loaded with the lazy
 * runner route. Wall posters and the shop sign share materials so the three
 * recycled street slabs do not each decode a copy.
 */

function poster(emissiveIntensity: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: "#f3efe6",
    roughness: 0.72,
    metalness: 0,
    emissive: "#000000",
    emissiveIntensity,
    envMapIntensity: 0.15,
  });
}

const logo = poster(0);
const graff = poster(0);
const hubba = poster(0);

let shop: MeshStandardMaterial | null = null;
let artPromise: Promise<void> | null = null;

function paint(material: MeshStandardMaterial, texture: Texture, glow: number): void {
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  material.map = texture;
  material.emissive.set("#ffffff");
  material.emissiveMap = texture;
  material.emissiveIntensity = glow;
  material.color.set("#ffffff");
  material.needsUpdate = true;
}

function drawShopSign(): Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#14382c";
  ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = "#f2c14a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const line = (text: string, y: number, start: number): void => {
    let size = start;
    ctx.font = `${size}px "Bebas Neue", sans-serif`;
    while (size > 28 && ctx.measureText(text).width > 470) {
      size -= 2;
      ctx.font = `${size}px "Bebas Neue", sans-serif`;
    }
    ctx.fillText(text, 256, y);
  };
  line("THE HUBBASPOT", 70, 84);
  line("SKATESHOP", 136, 52);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

async function paintShopSign(): Promise<void> {
  const material = shopSignMaterial();
  try {
    await document.fonts.ready;
    await document.fonts.load("80px 'Bebas Neue'");
  } catch (error: unknown) {
    console.warn("Runner sign font failed", error);
  }
  const texture = drawShopSign();
  if (!texture) return;
  paint(material, texture, 0.5);
}

export function shopSignMaterial(): MeshStandardMaterial {
  shop ??= new MeshStandardMaterial({
    color: "#14382c",
    roughness: 0.62,
    metalness: 0,
    emissive: "#14382c",
    emissiveIntensity: 0.15,
  });
  return shop;
}

export function logoPosterMaterial(): MeshStandardMaterial {
  return logo;
}

export function graffPosterMaterial(): MeshStandardMaterial {
  return graff;
}

export function hubbaPosterMaterial(): MeshStandardMaterial {
  return hubba;
}

export function ensureBrandArt(): Promise<void> {
  artPromise ??= (async () => {
    const loader = new TextureLoader();
    const [logoMap, graffMap, hubbaMap] = await Promise.all([
      loader.loadAsync(logoUrl),
      loader.loadAsync(graffUrl),
      loader.loadAsync(hubbaUrl),
      paintShopSign(),
    ]);
    paint(logo, logoMap, 0.28);
    paint(graff, graffMap, 0.12);
    paint(hubba, hubbaMap, 0.12);
  })().catch((error: unknown) => {
    artPromise = null;
    throw error;
  });
  return artPromise;
}
