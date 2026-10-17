/* Verify the server-to-server proxy token without a string timing comparison.
 * Keep this module independent of Deno so its rejection paths can be tested. */
export async function verifyProxyToken(candidate, expected) {
  if (typeof expected !== 'string' || expected.length < 32 ||
      typeof candidate !== 'string' || candidate.length < 32 || candidate.length > 512) return false;
  const encoder = new TextEncoder();
  const algorithm = {name:'HMAC', hash:'SHA-256'};
  const expectedKey = await crypto.subtle.importKey('raw', encoder.encode(expected), algorithm, false, ['sign']);
  const candidateKey = await crypto.subtle.importKey('raw', encoder.encode(candidate), algorithm, false, ['verify']);
  const message = encoder.encode('alldeputations-public-proxy-v1');
  const signature = await crypto.subtle.sign('HMAC', expectedKey, message);
  return crypto.subtle.verify('HMAC', candidateKey, signature, message);
}
