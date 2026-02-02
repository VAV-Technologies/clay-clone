/**
 * Ninja Email Finder - Core functions for finding emails using MailTester Ninja API
 *
 * MailTester Ninja API Documentation:
 * - Tests multiple email format variations (john@, john.smith@, jsmith@, etc.)
 * - Returns verification status for each tested email
 * - Rate limit: ~6 requests/second (170ms between requests)
 */

// Email verification result from the API
export interface VerificationResult {
  email: string;
  status: 'accepted' | 'limited' | 'catch-all' | 'rejected' | 'no mx' | 'mx error' | 'timeout' | 'spam';
  isCatchAll?: boolean;
}

// Result from findEmail function
export interface NinjaEmailResult {
  success: boolean;
  email?: string;
  status?: string;
  confidence?: 'high' | 'medium' | 'low';
  allTested?: VerificationResult[];
  error?: string;
}

// Name prefixes to remove (titles, honorifics, etc.)
const NAME_PREFIXES = [
  // Professional titles
  'dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'miss', 'prof', 'prof.',
  'professor', 'sir', 'madam', 'dame', 'lord', 'lady', 'rev', 'rev.', 'reverend',
  'fr', 'fr.', 'father', 'pastor', 'rabbi', 'imam', 'bishop', 'archbishop',
  // Military ranks
  'gen', 'gen.', 'general', 'col', 'col.', 'colonel', 'maj', 'maj.', 'major',
  'capt', 'capt.', 'captain', 'lt', 'lt.', 'lieutenant', 'sgt', 'sgt.', 'sergeant',
  'cpl', 'cpl.', 'corporal', 'pvt', 'pvt.', 'private', 'admiral', 'commander',
  // Business titles
  'ceo', 'cfo', 'cto', 'coo', 'cmo', 'cio', 'vp', 'evp', 'svp', 'avp', 'president',
  'chairman', 'chairwoman', 'chairperson', 'director', 'manager', 'lead', 'head',
];

// Name suffixes to remove (degrees, generational, professional)
const NAME_SUFFIXES = [
  // Generational
  'jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v', '2nd', '3rd', '4th', '5th',
  // Academic degrees
  'phd', 'ph.d', 'ph.d.', 'md', 'm.d', 'm.d.', 'dds', 'd.d.s', 'dmd', 'do', 'd.o',
  'jd', 'j.d', 'llb', 'll.b', 'llm', 'll.m', 'mba', 'm.b.a', 'ma', 'm.a', 'ms', 'm.s',
  'msc', 'm.sc', 'ba', 'b.a', 'bs', 'b.s', 'bsc', 'b.sc', 'bed', 'b.ed', 'med', 'm.ed',
  'edd', 'ed.d', 'psyd', 'psy.d', 'dba', 'd.b.a', 'dmin', 'd.min', 'thd', 'th.d',
  // Professional certifications
  'cpa', 'c.p.a', 'cfa', 'c.f.a', 'cfp', 'c.f.p', 'pmp', 'p.m.p', 'rn', 'r.n',
  'lpn', 'l.p.n', 'np', 'n.p', 'pa', 'p.a', 'pe', 'p.e', 'esq', 'esq.',
  'cissp', 'ccna', 'ccnp', 'mcse', 'aws', 'phr', 'sphr', 'shrm-cp', 'shrm-scp',
  // Other
  'ret', 'ret.', 'retired', 'faia', 'aia', 'leed', 'ap', 'asla', 'ase', 'cse',
];

// Unicode emoji ranges to remove (simplified for broader compatibility)
const EMOJI_REGEX = /[\u2600-\u27BF\uE000-\uF8FF]/g;

// Brackets regex to remove content within brackets
const BRACKETS_REGEX = /[\(\[\{<][^)\]}>]*[\)\]}>]/g;

/**
 * Clean a full name by removing titles, degrees, emojis, brackets, etc.
 * Returns properly formatted name for email search.
 */
export function cleanFullName(name: string): string {
  if (!name || typeof name !== 'string') return '';

  let cleaned = name.trim();

  // Remove emojis
  cleaned = cleaned.replace(EMOJI_REGEX, '');

  // Remove bracketed content (CEO), [NYC], {Sales}, <Manager>
  cleaned = cleaned.replace(BRACKETS_REGEX, '');

  // Split into words for prefix/suffix removal
  let words = cleaned.split(/\s+/).filter(w => w.length > 0);

  // Remove prefixes from the beginning
  while (words.length > 0) {
    const firstWord = words[0].toLowerCase().replace(/[.,]/g, '');
    if (NAME_PREFIXES.includes(firstWord) || NAME_PREFIXES.includes(firstWord + '.')) {
      words.shift();
    } else {
      break;
    }
  }

  // Remove suffixes from the end
  while (words.length > 0) {
    const lastWord = words[words.length - 1].toLowerCase().replace(/[.,]/g, '');
    if (NAME_SUFFIXES.includes(lastWord) || NAME_SUFFIXES.includes(lastWord + '.')) {
      words.pop();
    } else {
      break;
    }
  }

  // Remove any remaining punctuation except hyphens and apostrophes
  cleaned = words.join(' ')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Title case the result
  cleaned = cleaned
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return cleaned;
}

/**
 * Combine first and last name, cleaning each
 */
export function combineNames(firstName: string, lastName: string): string {
  const cleanFirst = cleanFullName(firstName);
  const cleanLast = cleanFullName(lastName);

  if (cleanFirst && cleanLast) {
    return `${cleanFirst} ${cleanLast}`;
  }
  return cleanFirst || cleanLast || '';
}

/**
 * Clean a domain by removing protocol, www, path, query, and port.
 * Validates that the result is a valid domain.
 */
export function cleanDomain(domain: string): string {
  if (!domain || typeof domain !== 'string') return '';

  let cleaned = domain.trim().toLowerCase();

  // Remove protocol
  cleaned = cleaned.replace(/^https?:\/\//, '');

  // Remove www.
  cleaned = cleaned.replace(/^www\./, '');

  // Remove path, query, fragment
  cleaned = cleaned.split('/')[0].split('?')[0].split('#')[0];

  // Remove port
  cleaned = cleaned.split(':')[0];

  // Validate: must have a dot and be at least 3 chars
  if (!cleaned.includes('.') || cleaned.length < 3) {
    return '';
  }

  // Basic domain validation
  const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  if (!domainRegex.test(cleaned)) {
    return '';
  }

  return cleaned;
}

/**
 * Get verification token - for backwards compatibility, just returns the API key
 * The API now supports direct key access, so no token exchange needed
 */
export async function getVerificationToken(apiKey: string): Promise<string> {
  // Direct key access - just return the API key itself
  return apiKey;
}

/**
 * Find an email using the MailTester Ninja API
 *
 * @param name - Full name of the person (will be cleaned)
 * @param domain - Company domain (will be cleaned)
 * @param token - API token from getVerificationToken
 * @returns NinjaEmailResult with found email or error
 */
export async function findEmail(
  name: string,
  domain: string,
  token: string
): Promise<NinjaEmailResult> {
  const cleanedName = cleanFullName(name);
  const cleanedDomain = cleanDomain(domain);

  if (!cleanedName) {
    return { success: false, error: 'Invalid or empty name' };
  }

  if (!cleanedDomain) {
    return { success: false, error: 'Invalid or empty domain' };
  }

  try {
    // Generate email variations to test
    const nameParts = cleanedName.toLowerCase().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts[nameParts.length - 1] || '';
    const firstInitial = firstName.charAt(0);
    const lastInitial = lastName.charAt(0);

    // Common email formats to try
    const emailVariations = [
      `${firstName}.${lastName}@${cleanedDomain}`,
      `${firstName}${lastName}@${cleanedDomain}`,
      `${firstInitial}${lastName}@${cleanedDomain}`,
      `${firstName}@${cleanedDomain}`,
      `${firstName}${lastInitial}@${cleanedDomain}`,
      `${firstInitial}.${lastName}@${cleanedDomain}`,
    ].filter(e => e && !e.startsWith('.') && !e.startsWith('@'));

    const results: VerificationResult[] = [];

    // Test each email variation
    for (const email of emailVariations) {
      const response = await fetch(`https://happy.mailtester.ninja/ninja?email=${encodeURIComponent(email)}&key=${encodeURIComponent(token)}`, {
        method: 'GET',
      });

      if (!response.ok) {
        continue; // Skip failed requests
      }

      const data = await response.json();

      // Map API response to our format
      const status = mapApiStatus(data.code || data.message);
      results.push({
        email,
        status,
        isCatchAll: data.code === 'catch-all' || data.message?.toLowerCase().includes('catch'),
      });

      // If we found an accepted email, we can stop
      if (status === 'accepted') {
        break;
      }

      // Rate limit between requests
      await delay(RATE_LIMIT_DELAY);
    }

    // Select the best email based on priority
    const bestResult = selectBestEmail(results);

    if (bestResult.email) {
      return {
        success: true,
        email: bestResult.email,
        status: bestResult.status,
        confidence: getConfidence(bestResult.status),
        allTested: results,
      };
    }

    return {
      success: false,
      error: 'No valid email found',
      allTested: results,
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Map API response code/message to our status format
 */
function mapApiStatus(codeOrMessage: string): VerificationResult['status'] {
  const lower = (codeOrMessage || '').toLowerCase();

  if (lower === 'ok' || lower === 'accepted' || lower.includes('accepted')) {
    return 'accepted';
  }
  if (lower.includes('catch') || lower.includes('catch-all')) {
    return 'catch-all';
  }
  if (lower.includes('limited') || lower.includes('quota')) {
    return 'limited';
  }
  if (lower.includes('reject') || lower === 'rejected' || lower === 'invalid') {
    return 'rejected';
  }
  if (lower.includes('no mx') || lower.includes('no_mx')) {
    return 'no mx';
  }
  if (lower.includes('mx error') || lower.includes('mx_error')) {
    return 'mx error';
  }
  if (lower.includes('timeout')) {
    return 'timeout';
  }
  if (lower.includes('spam')) {
    return 'spam';
  }

  return 'rejected'; // Default to rejected for unknown statuses
}

/**
 * Select the best email from verification results based on priority:
 * 1. accepted (not catch-all) - Confirmed valid
 * 2. limited - Valid but quota issues
 * 3. catch-all - Domain accepts all
 * 4. rejected - Only if nothing else (indicates definitive negative)
 *
 * Skip: no mx, mx error, timeout, spam
 */
export function selectBestEmail(
  results: VerificationResult[]
): { email: string | undefined; status: string | undefined } {
  if (!results || results.length === 0) {
    return { email: undefined, status: undefined };
  }

  // Priority 1: accepted (not catch-all)
  const accepted = results.find(r => r.status === 'accepted' && !r.isCatchAll);
  if (accepted) {
    return { email: accepted.email, status: 'accepted' };
  }

  // Priority 2: limited
  const limited = results.find(r => r.status === 'limited');
  if (limited) {
    return { email: limited.email, status: 'limited' };
  }

  // Priority 3: catch-all (accepted with isCatchAll flag or explicit catch-all status)
  const catchAll = results.find(r => r.status === 'catch-all' || (r.status === 'accepted' && r.isCatchAll));
  if (catchAll) {
    return { email: catchAll.email, status: 'catch-all' };
  }

  // No valid email found
  return { email: undefined, status: undefined };
}

/**
 * Get confidence level based on verification status
 */
function getConfidence(status: string | undefined): 'high' | 'medium' | 'low' {
  switch (status) {
    case 'accepted':
      return 'high';
    case 'limited':
      return 'medium';
    case 'catch-all':
      return 'low';
    default:
      return 'low';
  }
}

/**
 * Rate limiter helper - delays to respect API rate limits
 * MailTester Ninja allows ~6 requests/second (170ms between requests)
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const RATE_LIMIT_DELAY = 170; // milliseconds between API calls
