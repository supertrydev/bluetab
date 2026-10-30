/**
 * @module utils/focus-domain
 *
 * WHY:  The Focus blocklist stores bare domains ("example.com"). Both the
 *       Focus settings form and the AI chat `block_site` tool accept loose
 *       user input ("https://www.example.com/path"), so they share one
 *       normalizer instead of each keeping a private copy.
 *
 * WHAT: Strips protocol, credentials, "www.", path, query, hash and port.
 *       Returns null when the result does not look like a domain.
 */

export function normalizeFocusDomain(input: string): string | null {
  let domain = input.trim().toLowerCase();
  // Strip protocol
  domain = domain.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  // Strip credentials
  domain = domain.replace(/^[^@/]*@/, '');
  // Strip www.
  domain = domain.replace(/^www\./, '');
  // Strip path / query / hash / trailing slash
  domain = domain.split(/[/?#]/)[0];
  // Strip port
  domain = domain.split(':')[0];
  // Strip trailing dot (FQDN form)
  domain = domain.replace(/\.$/, '');
  // Basic domain format check: at least one dot, only host characters
  if (!domain || !domain.includes('.') || !/^[a-z0-9.-]+$/.test(domain) || domain.startsWith('.')) {
    return null;
  }
  return domain;
}
