import { Router } from 'express';
import { listVendors } from '../services/store';
import { getScope, ok } from './_helpers';

const router = Router();

router.get('/vendors', (req, res) => {
  ok(res, listVendors(getScope(req)));
});

export default router;
