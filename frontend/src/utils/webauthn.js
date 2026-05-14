export const BIOMETRIC_CREDENTIAL_KEY = 'studentBiometricCredentialId';

const toBase64url = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64url = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
};

export const isWebAuthnSupported = () => (
  typeof window !== 'undefined' &&
  Boolean(window.PublicKeyCredential) &&
  window.isSecureContext
);

export const prepareCreationOptions = (options) => ({
  ...options,
  challenge: fromBase64url(options.challenge),
  user: {
    ...options.user,
    id: fromBase64url(options.user.id)
  },
  excludeCredentials: (options.excludeCredentials || []).map(item => ({
    ...item,
    id: fromBase64url(item.id)
  }))
});

export const prepareRequestOptions = (options) => ({
  ...options,
  challenge: fromBase64url(options.challenge),
  allowCredentials: (options.allowCredentials || []).map(item => ({
    ...item,
    id: fromBase64url(item.id)
  }))
});

export const serializeRegistrationCredential = (credential) => ({
  id: credential.id,
  rawId: toBase64url(credential.rawId),
  type: credential.type,
  response: {
    clientDataJSON: toBase64url(credential.response.clientDataJSON),
    attestationObject: toBase64url(credential.response.attestationObject),
    transports: credential.response.getTransports?.() || ['internal']
  }
});

export const serializeAssertionCredential = (credential) => ({
  id: credential.id,
  rawId: toBase64url(credential.rawId),
  type: credential.type,
  response: {
    clientDataJSON: toBase64url(credential.response.clientDataJSON),
    authenticatorData: toBase64url(credential.response.authenticatorData),
    signature: toBase64url(credential.response.signature),
    userHandle: credential.response.userHandle ? toBase64url(credential.response.userHandle) : null
  }
});
