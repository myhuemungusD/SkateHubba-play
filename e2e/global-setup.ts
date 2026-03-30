/**
 * Playwright global setup — verifies Firebase emulators are accessible
 * before any tests run.  Logs diagnostics to stdout for CI debugging.
 */
export default async function globalSetup() {
  const AUTH = "http://localhost:9099";
  const FS = "http://localhost:8080";

  console.log("[e2e global-setup] Checking emulator connectivity...");

  // Check Auth emulator
  try {
    const authRes = await fetch(`${AUTH}/`);
    console.log(`[e2e global-setup] Auth emulator: ${authRes.status} ${authRes.statusText}`);
  } catch (err) {
    console.error(`[e2e global-setup] Auth emulator NOT REACHABLE: ${err}`);
    throw new Error("Auth emulator not reachable at " + AUTH);
  }

  // Check Firestore emulator
  try {
    const fsRes = await fetch(`${FS}/`);
    console.log(`[e2e global-setup] Firestore emulator: ${fsRes.status} ${fsRes.statusText}`);
  } catch (err) {
    console.error(`[e2e global-setup] Firestore emulator NOT REACHABLE: ${err}`);
    throw new Error("Firestore emulator not reachable at " + FS);
  }

  // Test creating a user to verify Auth emulator works
  try {
    const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "setup-test@test.com",
        password: "password123",
        returnSecureToken: true,
      }),
    });
    const data = await res.json();
    console.log(
      `[e2e global-setup] Auth test user creation: ${res.status} uid=${(data as Record<string, string>).localId ?? "NONE"}`,
    );
  } catch (err) {
    console.error(`[e2e global-setup] Auth test user creation failed: ${err}`);
  }

  // Clear the test data
  try {
    await fetch(`${AUTH}/emulator/v1/projects/demo-skatehubba/accounts`, {
      method: "DELETE",
    });
    await fetch(`${FS}/emulator/v1/projects/demo-skatehubba/databases/skatehubba/documents`, { method: "DELETE" });
    console.log("[e2e global-setup] Cleared emulator state");
  } catch (err) {
    console.error(`[e2e global-setup] Clear failed: ${err}`);
  }

  // Check Vite dev server
  try {
    const viteRes = await fetch("http://localhost:5173/");
    console.log(
      `[e2e global-setup] Vite dev server: ${viteRes.status} content-length=${viteRes.headers.get("content-length") ?? "unknown"}`,
    );
  } catch (err) {
    console.error(`[e2e global-setup] Vite dev server NOT REACHABLE: ${err}`);
  }

  console.log("[e2e global-setup] Done.");
}
