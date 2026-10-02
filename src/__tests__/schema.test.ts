import { z } from 'zod';

import { jsonSchema, normalizeJSONSchema, ORDER_KEY, resolveSchema } from '../schema/normalize';
import { Channel } from '../internal/channel';

describe('normalizeJSONSchema', () => {
  it('records property order recursively and strips unsupported keys', () => {
    const normalized = normalizeJSONSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {
        zeta: { type: 'string' },
        alpha: { type: 'object', properties: { b: { type: 'integer' }, a: { type: 'integer' } } },
      },
      $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } },
    });
    expect(normalized.$schema).toBeUndefined();
    expect(normalized.additionalProperties).toBeUndefined();
    expect(normalized[ORDER_KEY]).toEqual(['zeta', 'alpha']);
    expect((normalized.properties!.alpha as any)[ORDER_KEY]).toEqual(['b', 'a']);
    expect((normalized.$defs!.Node as any)[ORDER_KEY]).toEqual(['next']);
  });

  it('drops the safe-integer bounds Zod adds', () => {
    const { jsonSchema: schema } = resolveSchema(z.object({ n: z.number().int() }));
    expect(schema.properties!.n).toEqual({ type: 'integer' });
  });
});

describe('resolveSchema', () => {
  it('keeps real bounds, enums, optionals and descriptions from Zod', () => {
    const { jsonSchema: schema } = resolveSchema(
      z.object({
        age: z.number().int().min(0).max(120).describe('Age in years'),
        mood: z.enum(['happy', 'sad']),
        nickname: z.string().optional(),
      }),
    );
    expect(schema.properties!.age).toMatchObject({ type: 'integer', minimum: 0, maximum: 120, description: 'Age in years' });
    expect(schema.properties!.mood).toMatchObject({ enum: ['happy', 'sad'] });
    expect(schema.required).toEqual(['age', 'mood']);
  });

  it('supports typed JSON schemas with custom validators', async () => {
    const schema = jsonSchema<{ ok: boolean }>(
      { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      { validate: (value) => ({ ok: Boolean((value as { ok: unknown }).ok) }) },
    );
    const resolved = resolveSchema(schema);
    await expect(resolved.validate!({ ok: 1 })).resolves.toEqual({ ok: true });
  });

  it('rejects non-objects', () => {
    expect(() => resolveSchema(42 as never)).toThrow(expect.objectContaining({ code: 'INVALID_SCHEMA' }));
  });
});

describe('Channel', () => {
  it('delivers buffered values, then completes', async () => {
    const channel = new Channel<number>();
    channel.push(1);
    channel.push(2);
    channel.close();
    const values: number[] = [];
    for await (const value of channel) values.push(value);
    expect(values).toEqual([1, 2]);
  });

  it('propagates failures to waiting consumers', async () => {
    const channel = new Channel<number>();
    const consumed = (async () => {
      for await (const _ of channel) {
        /* wait */
      }
    })();
    channel.fail(new Error('boom'));
    await expect(consumed).rejects.toThrow('boom');
  });

  it('calls onReturn when the consumer breaks early', async () => {
    const onReturn = jest.fn();
    const channel = new Channel<number>(onReturn);
    channel.push(1);
    for await (const _ of channel) break;
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
