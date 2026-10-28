import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { pool } from '../db/pool.js';
import { positiveCentsSchema } from '../http/validation.js';

const settings = z.object({ theme: z.enum(['light', 'dark', 'system']), hideAmounts: z.boolean(), quickAmountsCents: z.array(positiveCentsSchema).min(1).max(8) });

export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/settings', { preHandler: requireAuth }, async (request) => {
    const result = await pool.query(`SELECT currency,locale,theme,hide_amounts AS "hideAmounts",quick_amounts_cents::text[] AS "quickAmountsCents" FROM user_settings WHERE user_id=$1`, [request.userId]);
    return { settings: result.rows[0] };
  });
  app.put('/api/settings', { preHandler: requireAuth }, async (request) => {
    const input = settings.parse(request.body);
    await pool.query(`UPDATE user_settings SET theme=$1,hide_amounts=$2,quick_amounts_cents=$3::bigint[],updated_at=now() WHERE user_id=$4`, [input.theme, input.hideAmounts, input.quickAmountsCents, request.userId]);
    return { settings: input };
  });
}
