/**
 * `@types/three` re-exports MeshoptDecoder from the `meshoptimizer` package.
 * That package is not installed. The runtime decoder is the module three
 * already ships, and it loads only when a board URL is set.
 */
declare module "meshoptimizer/decoder" {
  interface MeshoptDecoderInstance {
    ready: Promise<void>;
    supported: boolean;
  }

  export const MeshoptDecoder: MeshoptDecoderInstance;
}
