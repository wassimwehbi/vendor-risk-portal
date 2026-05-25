import type { Request, Response } from 'express';
import type { Role } from '../types';

export function getContext(req: Request): { actor: string; role: Role } {
  const actor = (req.header('X-Analyst') || 'Analyst').toString().slice(0, 120);
  const roleHeader = (req.header('X-Role') || 'Analyst').toString();
  const role: Role = (['Analyst', 'Admin', 'Viewer'] as const).includes(roleHeader as Role)
    ? (roleHeader as Role)
    : 'Analyst';
  return { actor, role };
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}

export function parseId(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
