import dns from 'node:dns/promises'
import ipaddr from 'ipaddr.js'

/**
 * SSRF guard : n'autorise que des URLs http(s) dont TOUTES les IP résolues
 * sont publiques (unicast). Throw sur toute IP privée/loopback/link-local/
 * reserved/metadata (169.254.169.254). À ré-appeler avant CHAQUE fetch,
 * y compris à chaque hop de redirection.
 */
function isPublicAddress(addr: string): boolean {
  let ip
  try {
    ip = ipaddr.parse(addr)
  } catch {
    return false
  }
  if (ip.kind() === 'ipv6') {
    const v6 = ip as ipaddr.IPv6
    if (v6.isIPv4MappedAddress()) ip = v6.toIPv4Address()
  }
  return ip.range() === 'unicast'
}

export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    throw new Error('ssrf: invalid url')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('ssrf: disallowed scheme')
  }
  const records = await dns.lookup(u.hostname, { all: true })
  if (records.length === 0) throw new Error('ssrf: dns resolution empty')
  for (const r of records) {
    if (!isPublicAddress(r.address)) {
      throw new Error('ssrf: non-public address blocked')
    }
  }
}
