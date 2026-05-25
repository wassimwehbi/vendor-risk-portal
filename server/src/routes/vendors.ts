import { Router } from 'express';
import { listVendors } from '../services/store';
import { ok } from './_helpers';

const router = Router();

router.get('/vendors', (_req, res) => {
  ok(res, listVendors());
});

export default router;
