// ============================================================
// Client-side password hashing using Web Crypto API (SHA-256).
// Passwords are hashed before leaving the browser so they
// never appear as plaintext in network requests.
// ============================================================

export async function sha256(plaintext: string): Promise<string> {
  const encoded = new TextEncoder().encode(plaintext);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
