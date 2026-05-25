# ADR 002 — Integer Paise for All Monetary Values

**Date:** 2024  
**Status:** Accepted

## Context

We need to store and compute monetary values for delivery fees, cart totals,
order amounts, settlements, and wallet balances.

## Decision

All monetary values are stored and computed as **integer paise (×100)**.
₹150 = 15000 (integer). Never rupees as a floating-point number.

## Rationale

IEEE 754 floating-point arithmetic is not exact:
`0.1 + 0.2 = 0.30000000000000004`

Financial bugs from float arithmetic are invisible until an audit finds them.
A ₹0.01 error per order at 500 orders/day = ₹5/day = ₹1,825/year — and
that's the optimistic case where errors average out.

## Enforcement

- `Paise` branded type in `@chirawa/types`
- Pricing module unit tests verify no floating-point operations exist
- PostgreSQL stores all monetary columns as `INTEGER` (paise), never `DECIMAL`
- ESLint rule flags any arithmetic on variables named `*price*`, `*fee*`,
  `*amount*`, `*total*` that isn't using integer operations

## Consequences

All display formatting divides by 100 at the presentation layer only.
`formatRupees(paise: Paise): string` handles this in one place.