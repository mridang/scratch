// Google OAuth 2.0 / OpenID Connect — authorization-code flow, no deps.
const ID = () => process.env.GOOGLE_CLIENT_ID || '';
const SECRET = () => process.env.GOOGLE_CLIENT_SECRET || '';
export const oauthConfigured = () => !!(ID() && SECRET());

export function authUrl(redirectUri, state) {
  const p = new URLSearchParams({
    client_id: ID(), redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid email profile', state, access_type: 'online', prompt: 'select_account',
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}

export async function exchange(code, redirectUri) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: ID(), client_secret: SECRET(),
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }).toString(),
  });
  const j = await r.json();
  if (!j.id_token) throw new Error('token exchange failed: ' + JSON.stringify(j));
  // id_token comes straight from Google over TLS; decode the claims.
  const payload = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64url').toString('utf8'));
  return { sub: payload.sub, email: payload.email, name: payload.name || payload.email, picture: payload.picture || '' };
}
