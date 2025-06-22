'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/



document.querySelectorAll('a[href^="http"]').forEach(link => {
  if (!link.href.includes(location.hostname)) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener');
  }
});