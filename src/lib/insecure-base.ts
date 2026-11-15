const PRIVATE_TLDS = /\.(local|lan|home|internal|corp|intranet|localdomain)$|\.home\.arpa$/;

export function hostOf(base: string): string {
  const authority = base.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  const host = authority.startsWith('[') ? authority.slice(1, authority.indexOf(']')) : authority.split(':')[0];
  return host.toLowerCase();
}

function isLocalIpv6(h: string): boolean {
  return h === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h);
}

export function isLocalHost(h: string): boolean {
  if (h.includes(':')) return isLocalIpv6(h);
  return (
    h === 'localhost' ||
    !h.includes('.') ||
    PRIVATE_TLDS.test(h) ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export function isInsecureBase(base: string): boolean {
  return base.startsWith('http://') && !isLocalHost(hostOf(base));
}
