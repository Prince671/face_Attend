const crypto = require('crypto');

const LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const configuredOrigins = () => [
  process.env.WEBAUTHN_ORIGIN,
  process.env.FRONTEND_URL,
  ...LOCAL_ORIGINS
]
  .filter(Boolean)
  .flatMap(value => String(value).split(','))
  .map(value => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const normalizeOrigin = (origin) => {
  if (!origin) return '';
  try {
    const parsed = new URL(origin);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
};

const isPrivateLanHostname = (hostname) => /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/.test(hostname);

const isAllowedOrigin = (origin) => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (configuredOrigins().includes(normalized)) return true;

  if (process.env.NODE_ENV !== 'production') {
    try {
      const { hostname, protocol } = new URL(normalized);
      return ['http:', 'https:'].includes(protocol) && isPrivateLanHostname(hostname);
    } catch {
      return false;
    }
  }

  return false;
};

const requestOrigin = (req) => {
  const headerOrigin = normalizeOrigin(req?.get?.('origin'));
  if (headerOrigin) return headerOrigin;

  const refererOrigin = normalizeOrigin(req?.get?.('referer'));
  if (refererOrigin) return refererOrigin;

  return normalizeOrigin(process.env.WEBAUTHN_ORIGIN || process.env.FRONTEND_URL || LOCAL_ORIGINS[0]);
};

const assertTrustedOrigin = (origin) => {
  const normalized = normalizeOrigin(origin);
  if (!isAllowedOrigin(normalized)) {
    throw new Error('This app domain is not allowed for biometric login. Set FRONTEND_URL or WEBAUTHN_ORIGIN to your deployed frontend URL.');
  }
  return normalized;
};

const rpIdFromOrigin = (origin) => new URL(assertTrustedOrigin(origin)).hostname;

const rpIdMatchesOrigin = (rpId, origin) => {
  const hostname = new URL(assertTrustedOrigin(origin)).hostname;
  return hostname === rpId || hostname.endsWith(`.${rpId}`);
};

const expectedOrigin = (req) => assertTrustedOrigin(requestOrigin(req));

const expectedRpId = (req) => {
  const origin = expectedOrigin(req);
  const configuredRpId = String(process.env.WEBAUTHN_RP_ID || '').trim();
  if (configuredRpId && rpIdMatchesOrigin(configuredRpId, origin)) return configuredRpId;
  return rpIdFromOrigin(origin);
};

const base64url = (input) => Buffer.from(input)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

const fromBase64url = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64');
};

const randomChallenge = () => base64url(crypto.randomBytes(32));

class CborReader {
  constructor(buffer) {
    this.buffer = Buffer.from(buffer);
    this.offset = 0;
  }

  read() {
    const initial = this.buffer[this.offset++];
    const major = initial >> 5;
    const additional = initial & 0x1f;
    const length = this.readLength(additional);

    if (major === 0) return length;
    if (major === 1) return -1 - length;
    if (major === 2) return this.readBytes(length);
    if (major === 3) return this.readBytes(length).toString('utf8');
    if (major === 4) {
      const items = [];
      for (let index = 0; index < length; index += 1) items.push(this.read());
      return items;
    }
    if (major === 5) {
      const map = new Map();
      for (let index = 0; index < length; index += 1) map.set(this.read(), this.read());
      return map;
    }
    if (major === 7) return length === 20 ? false : length === 21 ? true : null;
    throw new Error('Unsupported CBOR value');
  }

  readLength(additional) {
    if (additional < 24) return additional;
    if (additional === 24) return this.buffer[this.offset++];
    if (additional === 25) {
      const value = this.buffer.readUInt16BE(this.offset);
      this.offset += 2;
      return value;
    }
    if (additional === 26) {
      const value = this.buffer.readUInt32BE(this.offset);
      this.offset += 4;
      return value;
    }
    throw new Error('Unsupported CBOR length');
  }

  readBytes(length) {
    const bytes = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }
}

const parseAttestationObject = (attestationObject) => {
  const decoded = new CborReader(attestationObject).read();
  const authData = decoded.get('authData');
  if (!Buffer.isBuffer(authData)) throw new Error('Invalid attestation authData');

  const flags = authData[32];
  const userPresent = Boolean(flags & 0x01);
  const userVerified = Boolean(flags & 0x04);
  const attestedCredentialData = Boolean(flags & 0x40);
  if (!userPresent || !attestedCredentialData) throw new Error('Passkey registration was not confirmed by the device');

  const counter = authData.readUInt32BE(33);
  let offset = 37 + 16;
  const credentialIdLength = authData.readUInt16BE(offset);
  offset += 2;
  const credentialId = authData.subarray(offset, offset + credentialIdLength);
  offset += credentialIdLength;
  const coseKey = new CborReader(authData.subarray(offset)).read();

  if (coseKey.get(3) !== -7 || coseKey.get(1) !== 2 || coseKey.get(-1) !== 1) {
    throw new Error('Only ES256 platform passkeys are supported');
  }

  return {
    credentialId: base64url(credentialId),
    publicKeyJwk: {
      kty: 'EC',
      crv: 'P-256',
      x: base64url(coseKey.get(-2)),
      y: base64url(coseKey.get(-3)),
      ext: true
    },
    counter,
    userVerified
  };
};

const parseClientData = (clientDataJSON) => JSON.parse(Buffer.from(clientDataJSON).toString('utf8'));

const verifyClientData = ({ clientDataJSON, challenge, type, req }) => {
  const clientData = parseClientData(clientDataJSON);
  if (clientData.type !== type) throw new Error('Invalid biometric response type');
  if (clientData.challenge !== challenge) throw new Error('Invalid biometric challenge');
  if (!isAllowedOrigin(clientData.origin)) throw new Error('Invalid biometric origin');
  if (req && normalizeOrigin(clientData.origin) !== expectedOrigin(req)) throw new Error('Invalid biometric origin');
  return clientData;
};

const verifyAssertion = ({ credential, storedCredential, challenge, req }) => {
  const response = credential.response || {};
  const authenticatorData = fromBase64url(response.authenticatorData);
  const clientDataJSON = fromBase64url(response.clientDataJSON);
  const signature = fromBase64url(response.signature);
  const clientData = verifyClientData({ clientDataJSON, challenge, type: 'webauthn.get', req });

  const rpIdHash = authenticatorData.subarray(0, 32);
  const expectedHash = crypto.createHash('sha256').update(expectedRpId(req || { get: () => clientData.origin })).digest();
  if (!crypto.timingSafeEqual(rpIdHash, expectedHash)) throw new Error('Invalid biometric relying party');

  const flags = authenticatorData[32];
  if (!(flags & 0x01)) throw new Error('Biometric login was not confirmed by the device');
  if (!(flags & 0x04)) throw new Error('Use fingerprint, face unlock, or screen lock to continue');

  const clientHash = crypto.createHash('sha256').update(clientDataJSON).digest();
  const signedData = Buffer.concat([authenticatorData, clientHash]);
  const key = crypto.createPublicKey({ key: storedCredential.publicKeyJwk, format: 'jwk' });
  const verified = crypto.verify('sha256', signedData, key, signature);
  if (!verified) throw new Error('Biometric signature verification failed');

  return { counter: authenticatorData.readUInt32BE(33) };
};

module.exports = {
  base64url,
  fromBase64url,
  randomChallenge,
  expectedRpId,
  expectedOrigin,
  isAllowedOrigin,
  parseAttestationObject,
  verifyClientData,
  verifyAssertion
};
