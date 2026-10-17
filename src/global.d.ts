// Global augmentation for Three.js JSX elements in React Three Fiber
// Manually defined to avoid import/augmentation issues with skipLibCheck

/* eslint-disable @typescript-eslint/no-explicit-any */
declare namespace JSX {
  interface IntrinsicElements {
    // Three.js object types used in runner
    group: any;
    mesh: any;
    instancedMesh: any;
    // Geometry
    planeGeometry: any;
    boxGeometry: any;
    circleGeometry: any;
    // Materials
    meshStandardMaterial: any;
    meshBasicMaterial: any;
    // Lights
    ambientLight: any;
    directionalLight: any;
    hemisphereLight: any;
    // Effects
    fog: any;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
