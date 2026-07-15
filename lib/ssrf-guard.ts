import dns from 'node:dns/promises'
import nodeDns from 'node:dns'
import { Agent } from 'undici'
import ipaddr from 'ipaddr.js'

/**
 * SSRF guard, deux couches :
 *  1. assertPublicUrl() : check de scheme + rejet pré-résolution (erreurs propres).
 *  2. ssrfDispatcher : Agent undici dont connect.lookup résout UNE fois, valide
 *     chaque adresse retournée, et pin l'IP validée à la connexion réelle —
 *     ferme la fenêtre DNS-rebinding / TOCTOU (pas de 2e résolution indépendante).
 * À utiliser avec le fetch undici { dispatcher: ssrfDispatcher } + ré-appeler
 * assertPublicUrl avant chaque hop.
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

/**
 * Dispatcher undici qui valide ET pin les IPs connectées.
 * undici appelle lookup(hostname, { all: true }, cb) : on résout tout, on rejette
 * si UNE adresse est non-publique, puis on renvoie le TABLEAU validé complet.
 * Pas de seconde résolution indépendante => TOCTOU fermé. undici pioche dans la
 * liste fournie, sans redemander au DNS.
 */
export const ssrfDispatcher = new Agent({
  connect: {
    lookup: (hostname, _options, callback) => {
      nodeDns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err) return callback(err, '', 0)
        const list = Array.isArray(addresses) ? addresses : []
        if (list.length === 0) {
          return callback(new Error('ssrf: dns resolution empty'), '', 0)
        }
        for (const a of list) {
          if (!isPublicAddress(a.address)) {
            return callback(new Error('ssrf: non-public address blocked'), '', 0)
          }
        }
        callback(null, list, 0)
      })
    },
  },
})
