import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { pool } from '../db/pool.js';
import { positiveCentsSchema } from '../http/validation.js';

const itemSchema = z.object({
  bucketId: z.string().uuid(),
  amountCents: positiveCentsSchema.optional(),
  percentageBasisPoints: z.number().int().min(1).max(10000).optional(),
});
const inputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  mode: z.enum(['fixed', 'percentage']).default('fixed'),
  items: z.array(itemSchema).min(1).max(200),
}).superRefine((input, context) => {
  if (new Set(input.items.map((item) => item.bucketId)).size !== input.items.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate bucket' });
  const isFixed = input.mode === 'fixed';
  if (input.items.some((item) => isFixed ? !item.amountCents || item.percentageBasisPoints : !item.percentageBasisPoints || item.amountCents)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid template items' });
  if (!isFixed && input.items.reduce((sum, item) => sum + (item.percentageBasisPoints ?? 0), 0) !== 10000) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Percentages must total 100%' });
});

export function registerTemplateRoutes(app: FastifyInstance): void {
  app.get('/api/templates', { preHandler: requireAuth }, async (request) => {
    const result = await pool.query(
      `SELECT t.id,t.name,t.allocation_mode AS "mode",t.created_at AS "createdAt", COALESCE(json_agg(json_build_object(
        'bucketId',i.bucket_id,'bucketName',b.name,'amountCents',i.amount_cents::text,'percentageBasisPoints',i.percentage_basis_points,'sortOrder',i.sort_order
      ) ORDER BY i.sort_order) FILTER (WHERE i.id IS NOT NULL),'[]') AS items
      FROM templates t LEFT JOIN template_items i ON i.template_id=t.id LEFT JOIN buckets b ON b.id=i.bucket_id
      WHERE t.user_id=$1 GROUP BY t.id ORDER BY t.created_at`, [request.userId],
    );
    return { templates: result.rows };
  });
  app.post('/api/templates', { preHandler: requireAuth }, async (request, reply) => {
    const input = inputSchema.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const template = await client.query<{ id: string }>('INSERT INTO templates(user_id,name,allocation_mode) VALUES($1,$2,$3) RETURNING id', [request.userId, input.name, input.mode]);
      for (const [index, item] of input.items.entries()) await client.query(
        `INSERT INTO template_items(template_id,bucket_id,amount_cents,percentage_basis_points,sort_order)
         SELECT $1,id,$3,$4,$5 FROM buckets WHERE id=$2 AND user_id=$6 AND archived_at IS NULL`,
        [template.rows[0]!.id, item.bucketId, item.amountCents ?? null, item.percentageBasisPoints ?? null, index, request.userId],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ id: template.rows[0]!.id });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
  app.put('/api/templates/:id', { preHandler: requireAuth }, async (request, reply) => {
    const templateId = z.string().uuid().parse((request.params as { id: string }).id);
    const input = inputSchema.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<{ id: string }>(
        'UPDATE templates SET name=$1,allocation_mode=$2 WHERE id=$3 AND user_id=$4 RETURNING id',
        [input.name, input.mode, templateId, request.userId],
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'TEMPLATE_NOT_FOUND' });
      }
      await client.query('DELETE FROM template_items WHERE template_id=$1', [templateId]);
      for (const [index, item] of input.items.entries()) await client.query(
        `INSERT INTO template_items(template_id,bucket_id,amount_cents,percentage_basis_points,sort_order)
         SELECT $1,id,$3,$4,$5 FROM buckets WHERE id=$2 AND user_id=$6 AND archived_at IS NULL`,
        [templateId, item.bucketId, item.amountCents ?? null, item.percentageBasisPoints ?? null, index, request.userId],
      );
      await client.query('COMMIT');
      return { id: templateId };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
  app.delete('/api/templates/:id', { preHandler: requireAuth }, async (request, reply) => {
    const templateId = z.string().uuid().parse((request.params as { id: string }).id);
    const result = await pool.query('DELETE FROM templates WHERE id=$1 AND user_id=$2', [templateId, request.userId]);
    return result.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'TEMPLATE_NOT_FOUND' });
  });
}
