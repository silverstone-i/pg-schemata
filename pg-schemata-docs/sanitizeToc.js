'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

import fs from 'fs';
import path from 'path';

const inputFolder = './pg-schemata-docs/documentation';
const outputFolder = './pg-schemata-docs/docs';

if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder, { recursive: true });
}

const files = fs.readdirSync(inputFolder).filter(f => f.endsWith('.md'));

for (const file of files) {
  const inputPath = path.join(inputFolder, file);
  const outputPath = path.join(outputFolder, file);

  const lines = fs.readFileSync(inputPath, 'utf-8').split('\n');
  const sanitized = [];
  let inToc = false;

  for (const line of lines) {
    const isTocHeader = /^#{2,3}\s+Table of Contents/i.test(line.trim());
    const isHeader = /^#{1,6}\s+/.test(line.trim());

    if (isTocHeader) {
      inToc = true;
      continue;
    }

    if (inToc && isHeader) {
      inToc = false;
    }

    if (!inToc) {
      sanitized.push(line);
    }
  }

  fs.writeFileSync(outputPath, sanitized.join('\n'), 'utf-8');
  console.log(`Sanitized TOC: ${file}`);
}
