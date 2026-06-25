import { foo } from './foo.js';
import bar from '../lib/bar';
import * as utils from 'utils';
const fs = require('fs');
const loadLazy = () => import('./lazy.js');

export function main() {
  helper();
  foo();
}

function helper() {
  return bar();
}
