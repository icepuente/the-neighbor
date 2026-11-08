// The privacy policy (privacy.html): shows the parts that depend on a feature only while it is on.
// <p data-if="addressSuggest" hidden> appears when CONFIG.addressSuggest is true, so the policy
// always matches the site, wherever it is hosted.
import { CONFIG } from './booking-rules.js';

// A paragraph the owner deleted (data-deleted, empty) stays hidden.
for (const el of document.querySelectorAll('[data-if]')) {
  if (CONFIG[el.dataset.if] === true && !el.hasAttribute('data-deleted')) el.hidden = false;
}
