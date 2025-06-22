'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

// Clear any saved theme preference and disable future saving
localStorage.removeItem('/.__palette');
console.log('');

Object.defineProperty(localStorage, 'setItem', {
  value: () => {},
  writable: false,
  configurable: false
});