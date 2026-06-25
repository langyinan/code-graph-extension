import type { Thing } from './types';
import { service } from '@app/service';
import express from 'express';

export function start(): void {
  configure();
}

function configure(): Thing | null {
  service();
  return null;
}
