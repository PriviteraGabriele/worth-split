import { z } from 'zod';

// Amounts are bounded well below the PostgreSQL bigint range (19 digits), so
// a crafted value is rejected as invalid input instead of overflowing a
// balance or a sum inside the database. 15 digits are 10 trillion euros.
export const centsSchema = z.string().regex(/^\d{1,15}$/);
export const positiveCentsSchema = z.string().regex(/^[1-9]\d{0,14}$/);
export const signedCentsSchema = z.string().regex(/^-?[1-9]\d{0,14}$/);

// RFC 5321 caps an address at 254 characters; the cap also keeps the e-mail
// regular expression from running on arbitrarily large inputs.
export const emailSchema = z.string().trim().max(254).email();

// Years outside this range are not meaningful for personal finance and some
// (such as year 0) are rejected by PostgreSQL with an internal error.
export const monthSchema = z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/);
